import { useEffect, useMemo, useState } from "react";
import { Upload, Copy, Check, Wand2, Loader2 } from "lucide-react";
import { parseCSVRows, parseCSVHeaders } from "@/lib/csvParser";
import { useToast } from "@/hooks/use-toast";
import { cloudGet, cloudSet } from "@/lib/cloudStorage";

const STORAGE_KEY = "hacksData";

interface StoredHacks {
  fileName: string | null;
  rows: HackRow[];
  uploadedAt: string;
}

interface HackRow {
  pairs: string;            // canonical (sorted) SKU key
  pairsDisplay: string;     // original-style "a_b_c" for display
  merchant_name: string;
  times_occured: number;
  merchants_total_shipments: number;
  percentage: number;
  shipments: string[];
}

function canonicalize(pairs: string): string {
  return pairs
    .split("_")
    .map((s) => s.trim())
    .filter(Boolean)
    .sort()
    .join("_");
}

function parseHacksCsv(text: string): HackRow[] {
  const rows = parseCSVRows(text);
  if (rows.length < 2) return [];
  const headers = parseCSVHeaders(rows[0].join(","));
  // Find columns by name
  const idx = (name: string) => headers.indexOf(name);
  const iPairs = idx("pairs");
  const iMerchant = idx("merchant_name");
  const iTimes = idx("times_occured");
  const iTotal = idx("merchants_total_shipments");
  const iPct = idx("percentage");
  const iList = idx("list_input");

  // Group by canonical pairs + merchant
  const map = new Map<string, HackRow>();

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length === 0 || (row.length === 1 && row[0] === "")) continue;
    const pairsRaw = (row[iPairs] ?? "").replace(/^"|"$/g, "");
    const merchant = (row[iMerchant] ?? "").replace(/^"|"$/g, "");
    if (!pairsRaw || !merchant) continue;

    const canonical = canonicalize(pairsRaw);
    const key = `${canonical}__${merchant.toLowerCase()}`;
    const times = Number(row[iTimes]) || 0;
    const total = Number(row[iTotal]) || 0;
    const pct = Number(row[iPct]) || 0;
    const listRaw = (row[iList] ?? "").replace(/^"|"$/g, "");
    const shipments = listRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const existing = map.get(key);
    if (existing) {
      // Merge: union shipments, take max of times/total/pct (they should match across permutations)
      const set = new Set(existing.shipments);
      shipments.forEach((s) => set.add(s));
      existing.shipments = Array.from(set);
      existing.times_occured = Math.max(existing.times_occured, times);
      existing.merchants_total_shipments = Math.max(existing.merchants_total_shipments, total);
      existing.percentage = Math.max(existing.percentage, pct);
    } else {
      map.set(key, {
        pairs: canonical,
        pairsDisplay: canonical,
        merchant_name: merchant,
        times_occured: times,
        merchants_total_shipments: total,
        percentage: pct,
        shipments,
      });
    }
  }

  // Recalculate times_occured from unique shipment count (more reliable after dedup)
  const result = Array.from(map.values()).map((r) => ({
    ...r,
    times_occured: r.shipments.length,
    percentage: r.merchants_total_shipments > 0
      ? r.shipments.length / r.merchants_total_shipments
      : r.percentage,
  }));

  // Sort by times_occured desc
  result.sort((a, b) => b.times_occured - a.times_occured);
  return result;
}

export function Hacks() {
  const [rows, setRows] = useState<HackRow[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [uploadedAt, setUploadedAt] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  // Load persisted data on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await cloudGet<StoredHacks>(STORAGE_KEY);
      if (cancelled) return;
      if (stored && Array.isArray(stored.rows)) {
        setRows(stored.rows);
        setFileName(stored.fileName ?? null);
        setUploadedAt(stored.uploadedAt ?? null);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleUpload = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = parseHacksCsv(text);
      const now = new Date().toISOString();
      setRows(parsed);
      setFileName(file.name);
      setUploadedAt(now);
      setSaving(true);
      await cloudSet(STORAGE_KEY, {
        fileName: file.name,
        rows: parsed,
        uploadedAt: now,
      } satisfies StoredHacks);
      setSaving(false);
      toast({ title: "CSV saved", description: `${parsed.length} unique SKU combinations synced` });
    } catch (e) {
      setSaving(false);
      toast({ title: "Failed to parse CSV", description: String(e), variant: "destructive" });
    }
  };

  const handleCopy = async (key: string, shipments: string[]) => {
    try {
      await navigator.clipboard.writeText(shipments.join(","));
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  const totalShipments = useMemo(
    () => rows.reduce((s, r) => s + r.shipments.length, 0),
    [rows]
  );

  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-primary/10 flex items-center justify-center">
              <Wand2 size={16} className="text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-bold">SKU Pair Hacks</h2>
              <p className="text-xs text-muted-foreground">
                Upload the SKU pairs CSV to combine permutations and copy shipment lists.
              </p>
            </div>
          </div>
          <label className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-border bg-secondary text-foreground hover:bg-accent transition-colors cursor-pointer">
            <Upload size={12} />
            Upload CSV
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUpload(f);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {fileName && (
          <div className="mt-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{fileName}</span>
            {" — "}
            {rows.length} combinations · {totalShipments.toLocaleString()} total shipments
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-md border bg-card p-12 text-center text-sm text-muted-foreground">
          Upload a CSV to view combined SKU pair data.
        </div>
      ) : (
        <div className="rounded-md border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-secondary text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">SKU Combination</th>
                  <th className="text-left px-3 py-2 font-medium">Merchant</th>
                  <th className="text-right px-3 py-2 font-medium">Times</th>
                  <th className="text-right px-3 py-2 font-medium">Total Shipments</th>
                  <th className="text-right px-3 py-2 font-medium">%</th>
                  <th className="text-left px-3 py-2 font-medium">Shipment List</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const key = `${r.pairs}__${r.merchant_name}`;
                  const list = r.shipments.join(",");
                  const copied = copiedKey === key;
                  return (
                    <tr key={key} className="border-t border-border align-top">
                      <td className="px-3 py-2 font-mono text-[11px] max-w-[140px]">
                        <div className="break-all leading-tight">{r.pairsDisplay}</div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.merchant_name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.times_occured}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.merchants_total_shipments}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {(r.percentage * 100).toFixed(1)}%
                      </td>
                      <td className="px-3 py-2 max-w-[420px]">
                        <div className="font-mono text-[11px] text-muted-foreground line-clamp-2 break-all">
                          {list}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => handleCopy(key, r.shipments)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border bg-secondary text-foreground hover:bg-accent transition-colors text-[11px]"
                        >
                          {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
                          {copied ? "Copied" : "Copy"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
