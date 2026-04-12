import { useState, useCallback, useEffect, useRef } from "react";
import { Upload, Search, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cloudGet, cloudSet } from "@/lib/cloudStorage";

const RESHUFFLING_DATA_KEY = "reshufflingData";

interface ReshufflingRow {
  sku_name: string;
  merchant_name: string;
  shipments_affected: number;
  min_ready_for_fulfillment_at: string;
  reshuffle_from: string;
  max_reshuffling_amount_suggested: number;
}

type SortKey = keyof ReshufflingRow;

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') { inQuotes = false; } else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { result.push(current.trim()); current = ""; }
      else { current += ch; }
    }
  }
  result.push(current.trim());
  return result;
}

function parseReshufflingCsv(text: string): ReshufflingRow[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase().trim());

  const skuIdx = header.indexOf("sku_name");
  const merchantIdx = header.indexOf("merchant_name");
  const shipmentsIdx = header.indexOf("shipments_affected");
  const minReadyIdx = header.indexOf("min_ready_for_fulfillment_at");
  const reshuffleFromIdx = header.indexOf("reshuffle_from");
  const maxAmountIdx = header.indexOf("max_reshuffling_amount_suggested");

  if (skuIdx === -1 || merchantIdx === -1) return [];

  const rows: ReshufflingRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = parseCsvLine(lines[i]);
    const sku = cols[skuIdx]?.trim() ?? "";
    const merchant = cols[merchantIdx]?.trim() ?? "";
    if (!sku && !merchant) continue;

    rows.push({
      sku_name: sku,
      merchant_name: merchant,
      shipments_affected: shipmentsIdx !== -1 ? parseInt(cols[shipmentsIdx] ?? "0", 10) || 0 : 0,
      min_ready_for_fulfillment_at: minReadyIdx !== -1 ? (cols[minReadyIdx]?.trim() ?? "") : "",
      reshuffle_from: reshuffleFromIdx !== -1 ? (cols[reshuffleFromIdx]?.trim() ?? "") : "",
      max_reshuffling_amount_suggested: maxAmountIdx !== -1 ? parseFloat(cols[maxAmountIdx] ?? "0") || 0 : 0,
    });
  }
  return rows;
}

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: "asc" | "desc" }) {
  if (sortKey !== col) return <ArrowUpDown size={12} className="text-muted-foreground/50" />;
  return sortDir === "asc" ? <ArrowUp size={12} className="text-primary" /> : <ArrowDown size={12} className="text-primary" />;
}

export function Reshuffling() {
  const [rows, setRows] = useState<ReshufflingRow[]>([]);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("shipments_affected");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasLoadedRef = useRef(false);

  // Load persisted data on mount
  useEffect(() => {
    cloudGet<ReshufflingRow[]>(RESHUFFLING_DATA_KEY).then((stored) => {
      if (stored && Array.isArray(stored)) {
        setRows(stored);
      }
      hasLoadedRef.current = true;
    });
  }, []);

  // Persist data when rows change
  useEffect(() => {
    if (!hasLoadedRef.current) return;
    void cloudSet(RESHUFFLING_DATA_KEY, rows);
  }, [rows]);

  const handleUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      if (!text) return;
      const parsed = parseReshufflingCsv(text);
      setRows(parsed);
    };
    reader.readAsText(file);
    e.target.value = "";
  }, []);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  const filtered = (() => {
    let result = rows;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (r) =>
          r.sku_name.toLowerCase().includes(q) ||
          r.merchant_name.toLowerCase().includes(q) ||
          r.reshuffle_from.toLowerCase().includes(q)
      );
    }
    return [...result].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "string") {
        return sortDir === "asc" ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      }
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  })();

  const thClass =
    "px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide cursor-pointer select-none hover:text-foreground";
  const tdClass = "px-3 py-2 text-xs text-foreground";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Reshuffling</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Upload a reshuffling CSV to view proactive reshuffle suggestions.
          </p>
        </div>
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleUpload}
          />
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={13} />
            Upload CSV
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-md border bg-card overflow-hidden">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
            <Upload size={24} className="opacity-40" />
            <p className="text-sm">Upload a CSV to view reshuffling data.</p>
            <p className="text-xs opacity-70">
              Expected columns: sku_name, merchant_name, shipments_affected,
              min_ready_for_fulfillment_at, reshuffle_from, max_reshuffling_amount_suggested
            </p>
          </div>
        ) : (
          <>
            {/* Search */}
            <div className="p-3 border-b">
              <div className="relative max-w-xs">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search SKU, merchant, reshuffle from..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md border border-border bg-secondary text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            {/* Scrollable table */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px]">
                <thead className="border-b bg-secondary/50">
                  <tr>
                    <th className={thClass} onClick={() => toggleSort("sku_name")}>
                      <span className="flex items-center gap-1">
                        SKU Name <SortIcon col="sku_name" sortKey={sortKey} sortDir={sortDir} />
                      </span>
                    </th>
                    <th className={thClass} onClick={() => toggleSort("merchant_name")}>
                      <span className="flex items-center gap-1">
                        Merchant <SortIcon col="merchant_name" sortKey={sortKey} sortDir={sortDir} />
                      </span>
                    </th>
                    <th className={thClass} onClick={() => toggleSort("shipments_affected")}>
                      <span className="flex items-center gap-1">
                        Shipments Affected <SortIcon col="shipments_affected" sortKey={sortKey} sortDir={sortDir} />
                      </span>
                    </th>
                    <th className={thClass} onClick={() => toggleSort("min_ready_for_fulfillment_at")}>
                      <span className="flex items-center gap-1">
                        Min Ready for Fulfillment
                        <SortIcon col="min_ready_for_fulfillment_at" sortKey={sortKey} sortDir={sortDir} />
                      </span>
                    </th>
                    <th className={thClass} onClick={() => toggleSort("reshuffle_from")}>
                      <span className="flex items-center gap-1">
                        Reshuffle From <SortIcon col="reshuffle_from" sortKey={sortKey} sortDir={sortDir} />
                      </span>
                    </th>
                    <th className={thClass} onClick={() => toggleSort("max_reshuffling_amount_suggested")}>
                      <span className="flex items-center gap-1">
                        Max Reshuffle Amount
                        <SortIcon col="max_reshuffling_amount_suggested" sortKey={sortKey} sortDir={sortDir} />
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-8 text-center text-xs text-muted-foreground">
                        No rows match your search.
                      </td>
                    </tr>
                  ) : (
                    filtered.map((row, idx) => (
                      <tr key={idx} className="border-b last:border-0 hover:bg-secondary/30 transition-colors">
                        <td className={tdClass}>{row.sku_name}</td>
                        <td className={tdClass}>{row.merchant_name}</td>
                        <td className={`${tdClass} text-right tabular-nums`}>
                          {row.shipments_affected.toLocaleString()}
                        </td>
                        <td className={tdClass}>{row.min_ready_for_fulfillment_at}</td>
                        <td className={tdClass}>{row.reshuffle_from}</td>
                        <td className={`${tdClass} text-right tabular-nums`}>
                          {row.max_reshuffling_amount_suggested.toLocaleString(undefined, {
                            maximumFractionDigits: 2,
                          })}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {filtered.length > 0 && (
                  <tfoot>
                    <tr className="border-t bg-secondary/50 font-medium">
                      <td className={`${tdClass} font-semibold`} colSpan={2}>
                        Totals ({filtered.length} row{filtered.length !== 1 ? "s" : ""})
                      </td>
                      <td className={`${tdClass} text-right tabular-nums font-semibold`}>
                        {filtered.reduce((s, r) => s + r.shipments_affected, 0).toLocaleString()}
                      </td>
                      <td className={tdClass} />
                      <td className={tdClass} />
                      <td className={`${tdClass} text-right tabular-nums font-semibold`}>
                        {filtered
                          .reduce((s, r) => s + r.max_reshuffling_amount_suggested, 0)
                          .toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
