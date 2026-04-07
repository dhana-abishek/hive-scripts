import { useRef, useState, useCallback } from "react";
import { Upload, X, TrendingUp, TrendingDown, Minus, Info } from "lucide-react";
import { calculateFlowManagement } from "@/lib/warehouseProcessing";

interface ActualSPHProps {
  pickingRates: Record<string, number>;
  packingRates: Record<string, number>;
}

interface MerchantRow {
  merchant_name: string;
  order_volume: number;
  ideal_sph: number;
  weight_pct: number;
}

// ─── CSV helpers ──────────────────────────────────────────────────────────────

function parseCSVRow(row: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < row.length; i++) {
    const char = row[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

/** Case-insensitive column finder — normalises spaces, underscores, hyphens. */
function findCol(headers: string[], ...candidates: string[]): number {
  const norm = (s: string) => s.toLowerCase().replace(/[\s_\-]/g, "");
  return headers.findIndex((h) =>
    candidates.some((c) => norm(h).includes(norm(c)))
  );
}

interface ParseResult {
  merchants: { merchant_name: string; order_volume: number; waiting_for_picking: number }[];
  strategy: string;
  headerRow: string[];
}

/**
 * Parses the shipments CSV.
 *
 * Primary format (total_orders_shipped_by_merchant):
 *   merchant  | count
 *   Inkster   | 593
 *
 * Fallback — aggregated status format (internal Metabase feed):
 *   merchant | status               | shipment_count | … | totals
 */
function parseShipmentsCSV(text: string): ParseResult {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim().split("\n");
  if (lines.length < 2) return { merchants: [], strategy: "empty", headerRow: [] };

  const headerRow = parseCSVRow(lines[0]);

  // ── Primary: merchant + count/volume columns ──────────────────────────────
  const merchantCol = findCol(headerRow, "merchant_name", "merchant", "client", "seller", "store");
  const countCol    = findCol(headerRow, "count", "total_shipments", "order_volume", "shipment_count",
                                         "total_orders", "totals", "volume", "orders", "qty", "quantity");

  if (merchantCol !== -1 && countCol !== -1 && merchantCol !== countCol) {
    const merchantMap = new Map<string, number>();
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVRow(lines[i]);
      const merchant = cols[merchantCol]?.trim();
      if (!merchant) continue;
      const vol = parseInt(cols[countCol], 10) || 0;
      if (vol > 0) merchantMap.set(merchant, (merchantMap.get(merchant) ?? 0) + vol);
    }
    const merchants = Array.from(merchantMap.entries()).map(([n, v]) => ({
      merchant_name: n,
      order_volume: v,
      waiting_for_picking: v,
    }));
    if (merchants.length > 0) {
      return { merchants, strategy: "merchant-count", headerRow };
    }
  }

  // ── Fallback: aggregated status rows (col[1] contains status keywords) ────
  const statusKeywords = ["waiting_for_picking", "needs_reshuffling", "picked", "packed", "shipped"];
  const sampleStatuses = lines.slice(1, Math.min(20, lines.length))
    .map((l) => parseCSVRow(l)[1]?.toLowerCase() ?? "");
  const looksLikeStatusCol = sampleStatuses.some((s) => statusKeywords.some((k) => s.includes(k)));

  if (looksLikeStatusCol) {
    const merchantMap = new Map<string, { totals: number; waiting: number }>();
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVRow(lines[i]);
      if (cols.length < 3) continue;
      const merchant = cols[0].trim();
      if (!merchant) continue;
      const status = cols[1].trim();
      const shipmentCount = parseInt(cols[2], 10) || 0;
      const totals = cols[4] !== undefined ? parseInt(cols[4], 10) || 0 : 0;

      if (!merchantMap.has(merchant)) merchantMap.set(merchant, { totals: 0, waiting: 0 });
      const entry = merchantMap.get(merchant)!;
      if (totals > 0) entry.totals = totals;
      if (status === "waiting_for_picking" || status === "needs_reshuffling") {
        entry.waiting += shipmentCount;
      }
    }
    merchantMap.forEach((v, k) => {
      if (v.totals === 0) {
        let sum = 0;
        for (let i = 1; i < lines.length; i++) {
          const cols = parseCSVRow(lines[i]);
          if (cols[0]?.trim() === k) sum += parseInt(cols[2], 10) || 0;
        }
        v.totals = sum;
      }
    });
    const merchants = Array.from(merchantMap.entries())
      .map(([name, d]) => ({
        merchant_name: name,
        order_volume: d.totals,
        waiting_for_picking: d.waiting || d.totals,
      }))
      .filter((m) => m.order_volume > 0);
    if (merchants.length > 0) {
      return { merchants, strategy: "aggregated-status", headerRow };
    }
  }

  return { merchants: [], strategy: merchantCol === -1 ? "no-merchant-column" : "failed", headerRow };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ActualSPH({ pickingRates, packingRates }: ActualSPHProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName]                 = useState<string | null>(null);
  const [rows, setRows]                         = useState<MerchantRow[]>([]);
  const [weightedIdealSph, setWeightedIdealSph] = useState<number | null>(null);
  const [actualSph, setActualSph]               = useState<string>("");
  const [parseError, setParseError]             = useState<string | null>(null);
  const [debugStrategy, setDebugStrategy]       = useState<string | null>(null);

  const handleFile = useCallback(
    (file: File) => {
      setParseError(null);
      setFileName(file.name);

      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        try {
          const { merchants, strategy, headerRow } = parseShipmentsCSV(text);
          setDebugStrategy(strategy);

          if (merchants.length === 0) {
            const headerHint = headerRow.length
              ? `Detected columns: ${headerRow.join(" | ")}`
              : "No header row found.";
            setParseError(
              strategy === "no-merchant-column"
                ? `No merchant column found. ${headerHint}`
                : `No rows could be parsed (strategy: ${strategy}). ${headerHint}`
            );
            setRows([]);
            setWeightedIdealSph(null);
            return;
          }

          const flowRows = calculateFlowManagement(merchants, pickingRates, packingRates);

          if (flowRows.length === 0) {
            setParseError(
              `Parsed ${merchants.length} merchants from CSV but none matched the active benchmarks. ` +
              `Sample names: ${merchants.slice(0, 5).map((m) => m.merchant_name).join(", ")}`
            );
            setRows([]);
            setWeightedIdealSph(null);
            return;
          }

          const totalVolume = flowRows.reduce((s, r) => s + r.order_volume, 0);
          const weightedSum = flowRows.reduce((s, r) => s + r.order_volume * r.ideal_sph, 0);
          const weightedAvg = totalVolume > 0 ? weightedSum / totalVolume : 0;

          const merchantRows: MerchantRow[] = flowRows
            .sort((a, b) => b.order_volume - a.order_volume)
            .map((r) => ({
              merchant_name: r.merchant_name,
              order_volume:  r.order_volume,
              ideal_sph:     r.ideal_sph,
              weight_pct:    totalVolume > 0 ? (r.order_volume / totalVolume) * 100 : 0,
            }));

          setRows(merchantRows);
          setWeightedIdealSph(Math.round(weightedAvg * 100) / 100);
        } catch (err) {
          setParseError(`Parse error: ${err instanceof Error ? err.message : String(err)}`);
          setRows([]);
          setWeightedIdealSph(null);
        }
      };
      reader.readAsText(file);
    },
    [pickingRates, packingRates]
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.name.endsWith(".csv")) handleFile(file);
  };

  const handleClear = () => {
    setFileName(null);
    setRows([]);
    setWeightedIdealSph(null);
    setActualSph("");
    setParseError(null);
    setDebugStrategy(null);
  };

  const parsedActual = parseFloat(actualSph);
  const validActual  = !isNaN(parsedActual) && parsedActual > 0;
  const diff         = validActual && weightedIdealSph !== null ? parsedActual - weightedIdealSph : null;
  const diffPct      =
    diff !== null && weightedIdealSph !== null && weightedIdealSph > 0
      ? (diff / weightedIdealSph) * 100
      : null;

  return (
    <div className="space-y-4">

      {/* ── Upload card ───────────────────────────────────────────────────── */}
      <div className="rounded-md border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Actual SPH Comparison</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Upload the "total orders shipped by merchant" CSV to compute the weighted-average ideal SPH, then compare it to the actual SPH you observed.
            </p>
          </div>
          {fileName && (
            <button
              onClick={handleClear}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs border border-border bg-secondary text-muted-foreground hover:bg-accent transition-colors"
            >
              <X size={11} /> Clear
            </button>
          )}
        </div>

        {!fileName ? (
          <div
            className="border-2 border-dashed border-border rounded-md p-8 flex flex-col items-center justify-center gap-3 cursor-pointer hover:bg-accent/50 transition-colors"
            onClick={() => fileInputRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
          >
            <Upload size={20} className="text-muted-foreground" />
            <div className="text-center">
              <p className="text-sm font-medium">Upload shipments CSV</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Drag &amp; drop or click — expects <code className="font-mono">merchant, count</code> columns
              </p>
            </div>
            <button
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
            >
              <Upload size={12} /> Choose file
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-md bg-secondary px-3 py-2 text-xs text-muted-foreground border border-border">
            <Upload size={12} />
            <span className="font-medium text-foreground truncate max-w-xs">{fileName}</span>
            {rows.length > 0 && <span>· {rows.length} merchants matched</span>}
            {debugStrategy && <span className="ml-auto opacity-50">{debugStrategy}</span>}
          </div>
        )}

        <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFileChange} />

        {parseError && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive flex items-start gap-2">
            <Info size={12} className="mt-0.5 shrink-0" />
            <span>{parseError}</span>
          </div>
        )}
      </div>

      {/* ── Stats cards ───────────────────────────────────────────────────── */}
      {weightedIdealSph !== null && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

            {/* Weighted Ideal SPH */}
            <div className="rounded-md border bg-card p-4 space-y-1">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Weighted Ideal SPH</p>
              <p className="text-3xl font-bold tabular-nums">{weightedIdealSph.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground">
                {rows.reduce((s, r) => s + r.order_volume, 0).toLocaleString()} shipments · {rows.length} merchants
              </p>
            </div>

            {/* Actual SPH input */}
            <div className="rounded-md border bg-card p-4 space-y-1">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Actual SPH</p>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="e.g. 42.5"
                value={actualSph}
                onChange={(e) => setActualSph(e.target.value)}
                className="w-full text-2xl font-bold tabular-nums bg-transparent border-b border-border focus:outline-none focus:border-primary py-1 placeholder:text-muted-foreground/40 placeholder:text-base placeholder:font-normal"
              />
              <p className="text-xs text-muted-foreground">SPH you observed at the warehouse that day</p>
            </div>

            {/* Delta */}
            <div className="rounded-md border bg-card p-4 space-y-1">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Delta (Actual − Ideal)</p>
              {diff !== null ? (
                <>
                  <div className="flex items-center gap-2">
                    {diff > 0 ? (
                      <TrendingUp size={18} className="text-success shrink-0" />
                    ) : diff < 0 ? (
                      <TrendingDown size={18} className="text-destructive shrink-0" />
                    ) : (
                      <Minus size={18} className="text-muted-foreground shrink-0" />
                    )}
                    <span className={`text-3xl font-bold tabular-nums ${diff > 0 ? "text-success" : diff < 0 ? "text-destructive" : "text-foreground"}`}>
                      {diff > 0 ? "+" : ""}{diff.toFixed(2)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {diffPct !== null ? `${diffPct > 0 ? "+" : ""}${diffPct.toFixed(1)}% vs ideal · ` : ""}
                    {diff > 0 ? "Above ideal" : diff < 0 ? "Below ideal" : "On target"}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-2xl font-bold text-muted-foreground/40">—</p>
                  <p className="text-xs text-muted-foreground">Enter actual SPH to see the gap</p>
                </>
              )}
            </div>
          </div>

          {/* ── Breakdown table ─────────────────────────────────────────────── */}
          <div className="rounded-md border bg-card overflow-hidden">
            <div className="px-4 py-3 border-b bg-secondary/50">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Merchant Breakdown — Ideal SPH weighted by Volume
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-secondary/30">
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">Merchant</th>
                    <th className="px-4 py-2 text-right font-medium text-muted-foreground">Volume</th>
                    <th className="px-4 py-2 text-right font-medium text-muted-foreground">Weight</th>
                    <th className="px-4 py-2 text-right font-medium text-muted-foreground">Ideal SPH</th>
                    <th className="px-4 py-2 text-right font-medium text-muted-foreground">Weighted Contribution</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.merchant_name} className={`border-b last:border-0 ${i % 2 === 0 ? "" : "bg-secondary/20"}`}>
                      <td className="px-4 py-2 font-medium text-foreground">{r.merchant_name}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.order_volume.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{r.weight_pct.toFixed(1)}%</td>
                      <td className="px-4 py-2 text-right tabular-nums font-medium">{r.ideal_sph.toFixed(2)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                        {((r.weight_pct / 100) * r.ideal_sph).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-border bg-secondary/40 font-semibold">
                    <td className="px-4 py-2 text-foreground">Total / Weighted Avg</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {rows.reduce((s, r) => s + r.order_volume, 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">100%</td>
                    <td className="px-4 py-2 text-right tabular-nums text-primary">{weightedIdealSph.toFixed(2)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-primary">{weightedIdealSph.toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
