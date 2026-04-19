import { useEffect, useMemo, useState } from "react";
import { Upload, Copy, Check, Wand2, Loader2, Filter } from "lucide-react";
import { parseCSVRows, parseCSVHeaders } from "@/lib/csvParser";
import { useToast } from "@/hooks/use-toast";
import { cloudGet, cloudSet } from "@/lib/cloudStorage";
import { useZoneOverrides } from "@/hooks/useZoneOverrides";

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

  // Filters
  const { lookup: zoneLookup } = useZoneOverrides();
  const [zoneFilter, setZoneFilter] = useState<"all" | "A" | "B" | "unzoned">("all");
  const [merchantFilter, setMerchantFilter] = useState<string>("all");
  const [skuCountFilter, setSkuCountFilter] = useState<string>("all");
  const [mergeSubsets, setMergeSubsets] = useState(false);
  const [deduplicateShipments, setDeduplicateShipments] = useState(false);

  const merchantOptions = useMemo(() => {
    const set = new Set(rows.map((r) => r.merchant_name));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  // Optionally merge subsets: each combination absorbs shipments from every
  // smaller combination (same merchant) whose SKUs are a multiset-subset of it.
  // Subset rows are then dropped. When deduplicateShipments is also on, a final
  // pass ensures each shipment ID appears in exactly one output row (the
  // most-SKU row that contains it; ties broken by lex order of pairs).
  const effectiveRows = useMemo(() => {
    if (!mergeSubsets) return rows;
    const byMerchant = new Map<string, number[]>();
    rows.forEach((r, i) => {
      const arr = byMerchant.get(r.merchant_name) ?? [];
      arr.push(i);
      byMerchant.set(r.merchant_name, arr);
    });
    const skuBags = rows.map((r) => {
      const bag = new Map<string, number>();
      for (const s of r.pairs.split("_").filter(Boolean)) {
        bag.set(s, (bag.get(s) ?? 0) + 1);
      }
      return bag;
    });
    const bagSize = (b: Map<string, number>) => {
      let n = 0;
      for (const v of b.values()) n += v;
      return n;
    };
    const sizes = skuBags.map(bagSize);

    const absorbed = new Set<number>();
    rows.forEach((_, i) => {
      const myBag = skuBags[i];
      const mySize = sizes[i];
      const candidates = byMerchant.get(rows[i].merchant_name) ?? [];
      for (const j of candidates) {
        if (j === i) continue;
        if (sizes[j] <= mySize) continue;
        const other = skuBags[j];
        let isSubsetOfJ = true;
        for (const [sku, count] of myBag) {
          if ((other.get(sku) ?? 0) < count) { isSubsetOfJ = false; break; }
        }
        if (isSubsetOfJ) { absorbed.add(i); break; }
      }
    });

    // Build merged rows, keeping original index for the dedup pass.
    const merged = rows
      .map((r, i) => {
        const myBag = skuBags[i];
        const mySize = sizes[i];
        const shipSet = new Set(r.shipments);
        const candidates = byMerchant.get(r.merchant_name) ?? [];
        for (const j of candidates) {
          if (j === i) continue;
          if (sizes[j] >= mySize) continue;
          const other = skuBags[j];
          let isSubset = true;
          for (const [sku, count] of other) {
            if ((myBag.get(sku) ?? 0) < count) { isSubset = false; break; }
          }
          if (isSubset) rows[j].shipments.forEach((s) => shipSet.add(s));
        }
        return { row: r, shipments: Array.from(shipSet), _idx: i, _size: mySize };
      })
      .filter((r) => !absorbed.has(r._idx));

    if (deduplicateShipments) {
      // For each shipment ID, keep it only in the output row with the most SKUs.
      // Ties are broken by lex order of the pairs string (earlier = wins).
      const owner = new Map<string, number>(); // shipmentId -> index in merged[]
      merged.forEach(({ shipments, _size, row }, idx) => {
        for (const s of shipments) {
          const prev = owner.get(s);
          if (prev === undefined) { owner.set(s, idx); continue; }
          const prevSize = merged[prev]._size;
          const prevPairs = merged[prev].row.pairs;
          if (_size > prevSize || (_size === prevSize && row.pairs < prevPairs)) {
            owner.set(s, idx);
          }
        }
      });

      return merged
        .map(({ row, shipments, _idx }, idx) => {
          const deduped = shipments.filter((s) => owner.get(s) === idx);
          const total = row.merchants_total_shipments;
          return {
            ...row,
            shipments: deduped,
            times_occured: deduped.length,
            percentage: total > 0 ? deduped.length / total : row.percentage,
          };
        })
        .filter((r) => r.times_occured > 0)
        .sort((a, b) => b.times_occured - a.times_occured);
    }

    return merged
      .map(({ row, shipments }) => {
        const total = row.merchants_total_shipments;
        return {
          ...row,
          shipments,
          times_occured: shipments.length,
          percentage: total > 0 ? shipments.length / total : row.percentage,
        };
      })
      .sort((a, b) => b.times_occured - a.times_occured);
  }, [rows, mergeSubsets, deduplicateShipments]);

  const filteredRows = useMemo(() => {
    return effectiveRows.filter((r) => {
      if (merchantFilter !== "all" && r.merchant_name !== merchantFilter) return false;
      if (zoneFilter !== "all") {
        const zone = zoneLookup[r.merchant_name]?.zone;
        if (zoneFilter === "unzoned") {
          if (zone) return false;
        } else if (zone !== zoneFilter) {
          return false;
        }
      }
      if (skuCountFilter !== "all") {
        const n = r.pairs.split("_").filter(Boolean).length;
        if (skuCountFilter === "5+") {
          if (n < 5) return false;
        } else if (n !== Number(skuCountFilter)) {
          return false;
        }
      }
      return true;
    });
  }, [effectiveRows, merchantFilter, zoneFilter, skuCountFilter, zoneLookup]);

  const totalShipments = useMemo(
    () => filteredRows.reduce((s, r) => s + r.shipments.length, 0),
    [filteredRows]
  );

  const filtersActive =
    zoneFilter !== "all" || merchantFilter !== "all" || skuCountFilter !== "all";

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
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
            {saving ? "Saving…" : "Upload CSV"}
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              disabled={saving}
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
            {filtersActive ? `${filteredRows.length} of ${rows.length}` : rows.length} combinations
            {mergeSubsets && <span className="ml-1 text-primary">(subsets merged)</span>}
            {" · "}
            {totalShipments.toLocaleString()} shipments{filtersActive ? " (filtered)" : ""}
            {uploadedAt && (
              <span className="ml-2 opacity-70">
                · synced {new Date(uploadedAt).toLocaleString()}
              </span>
            )}
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <div className="rounded-md border bg-card p-3 flex flex-wrap items-center gap-2 text-xs">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Filter size={12} />
            <span className="font-medium">Filters</span>
          </div>

          <label className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Zone</span>
            <select
              value={zoneFilter}
              onChange={(e) => setZoneFilter(e.target.value as typeof zoneFilter)}
              className="px-2 py-1 rounded border border-border bg-background text-foreground"
            >
              <option value="all">All</option>
              <option value="A">Zone A</option>
              <option value="B">Zone B</option>
              <option value="unzoned">Unzoned</option>
            </select>
          </label>

          <label className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Merchant</span>
            <select
              value={merchantFilter}
              onChange={(e) => setMerchantFilter(e.target.value)}
              className="px-2 py-1 rounded border border-border bg-background text-foreground max-w-[180px]"
            >
              <option value="all">All ({merchantOptions.length})</option>
              {merchantOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1.5">
            <span className="text-muted-foreground"># SKUs</span>
            <select
              value={skuCountFilter}
              onChange={(e) => setSkuCountFilter(e.target.value)}
              className="px-2 py-1 rounded border border-border bg-background text-foreground"
            >
              <option value="all">All</option>
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="4">4</option>
              <option value="5+">5+</option>
            </select>
          </label>

          <button
            type="button"
            onClick={() => { setMergeSubsets((v) => { if (v) setDeduplicateShipments(false); return !v; }); }}
            className={`ml-auto inline-flex items-center gap-1.5 px-2 py-1 rounded border transition-colors ${
              mergeSubsets
                ? "bg-primary text-primary-foreground border-primary hover:bg-primary/90"
                : "bg-secondary text-foreground border-border hover:bg-accent"
            }`}
            title="When on, each combination's shipment list also includes shipments from larger combinations that contain all of its SKUs."
          >
            {mergeSubsets ? <Check size={12} /> : <Wand2 size={12} />}
            Merge subsets {mergeSubsets ? "ON" : "OFF"}
          </button>

          {mergeSubsets && (
            <button
              type="button"
              onClick={() => setDeduplicateShipments((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border transition-colors ${
                deduplicateShipments
                  ? "bg-primary text-primary-foreground border-primary hover:bg-primary/90"
                  : "bg-secondary text-foreground border-border hover:bg-accent"
              }`}
              title="When on, each shipment ID appears in exactly one row (the combination with the most SKUs)."
            >
              {deduplicateShipments ? <Check size={12} /> : <Filter size={12} />}
              Deduplicate IDs {deduplicateShipments ? "ON" : "OFF"}
            </button>
          )}

          {filtersActive && (
            <button
              onClick={() => {
                setZoneFilter("all");
                setMerchantFilter("all");
                setSkuCountFilter("all");
              }}
              className="px-2 py-1 rounded border border-border bg-secondary text-foreground hover:bg-accent transition-colors"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="rounded-md border bg-card p-12 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Loading saved data…
        </div>
      ) : rows.length === 0 ? (
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
                {filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                      No combinations match the current filters.
                    </td>
                  </tr>
                )}
                {filteredRows.map((r) => {
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
