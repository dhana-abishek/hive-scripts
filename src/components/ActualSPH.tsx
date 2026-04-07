import { useRef, useState, useCallback, useMemo, useEffect } from "react";
import { Upload, X, TrendingUp, TrendingDown, Minus, Info, Users } from "lucide-react";
import { calculateFlowManagement } from "@/lib/warehouseProcessing";
import { cloudGet, cloudSet, cloudRemove } from "@/lib/cloudStorage";

const MERCHANTS_KEY  = "actualSphMerchants";
const FILENAME_KEY   = "actualSphFileName";
const NON_PROD_KEY   = "actualSphNonProdHC";
const ACTUAL_SPH_KEY = "actualSphValue";

interface ActualSPHProps {
  pickingRates: Record<string, number>;
  packingRates: Record<string, number>;
}

type MerchantData = {
  merchant_name: string;
  order_volume: number;
  waiting_for_picking: number;
};

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

function findCol(headers: string[], ...candidates: string[]): number {
  const norm = (s: string) => s.toLowerCase().replace(/[\s_\-]/g, "");
  return headers.findIndex((h) =>
    candidates.some((c) => norm(h).includes(norm(c)))
  );
}

interface ParseResult {
  merchants: MerchantData[];
  strategy: string;
  headerRow: string[];
}

function parseShipmentsCSV(text: string): ParseResult {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim().split("\n");
  if (lines.length < 2) return { merchants: [], strategy: "empty", headerRow: [] };

  const headerRow = parseCSVRow(lines[0]);

  // ── Primary: merchant + count columns ─────────────────────────────────────
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
    if (merchants.length > 0) return { merchants, strategy: "merchant-count", headerRow };
  }

  // ── Fallback: aggregated status rows ──────────────────────────────────────
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
      if (status === "waiting_for_picking" || status === "needs_reshuffling") entry.waiting += shipmentCount;
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
    if (merchants.length > 0) return { merchants, strategy: "aggregated-status", headerRow };
  }

  return { merchants: [], strategy: merchantCol === -1 ? "no-merchant-column" : "failed", headerRow };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ActualSPH({ pickingRates, packingRates }: ActualSPHProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Raw merchant volumes — source of truth, persisted to Supabase
  const [merchants, setMerchants]         = useState<MerchantData[]>([]);
  const [fileName, setFileName]           = useState<string | null>(null);
  const [actualSph, setActualSph]         = useState<string>("");
  const [nonProdHC, setNonProdHC]         = useState<string>("12");
  const [parseError, setParseError]       = useState<string | null>(null);
  const [debugStrategy, setDebugStrategy] = useState<string | null>(null);
  const [isLoading, setIsLoading]         = useState(true);

  // ── Load all persisted values on mount ────────────────────────────────────
  useEffect(() => {
    (async () => {
      const [savedMerchants, savedFileName, savedNonProd, savedActualSph] = await Promise.all([
        cloudGet<MerchantData[]>(MERCHANTS_KEY),
        cloudGet<string>(FILENAME_KEY),
        cloudGet<string>(NON_PROD_KEY),
        cloudGet<string>(ACTUAL_SPH_KEY),
      ]);
      if (savedMerchants && savedMerchants.length > 0) setMerchants(savedMerchants);
      if (savedFileName)  setFileName(savedFileName);
      if (savedNonProd)   setNonProdHC(savedNonProd);
      if (savedActualSph) setActualSph(savedActualSph);
      setIsLoading(false);
    })();
  }, []);

  // ── Persist each input on change (skip initial render) ───────────────────
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    void cloudSet(NON_PROD_KEY, nonProdHC);
  }, [nonProdHC]);

  useEffect(() => {
    if (isFirstRender.current) return;
    void cloudSet(ACTUAL_SPH_KEY, actualSph);
  }, [actualSph]);

  // ── flowRows: recomputed from raw merchants + current benchmarks ──────────
  // Benchmark changes automatically refresh SPH on every device.
  const flowRows = useMemo(
    () => (merchants.length > 0 ? calculateFlowManagement(merchants, pickingRates, packingRates) : []),
    [merchants, pickingRates, packingRates]
  );

  // ── Derived stats — recalculate live when nonProdHC or flowRows change ────
  const { idealSph, totalVolume, totalPickHours, totalPackHours, nonProdHours, tableRows } =
    useMemo(() => {
      if (flowRows.length === 0) return {
        idealSph: null, totalVolume: 0,
        totalPickHours: 0, totalPackHours: 0, nonProdHours: 0, tableRows: [],
      };

      const hc             = Math.max(0, parseInt(nonProdHC, 10) || 0);
      const totalVolume    = flowRows.reduce((s, r) => s + r.order_volume, 0);
      const totalPickHours = flowRows.reduce((s, r) => s + r.picking_hours, 0);
      const totalPackHours = flowRows.reduce((s, r) => s + r.packing_hours, 0);
      const nonProdHours   = hc * 8;
      const denom          = totalPickHours + totalPackHours + nonProdHours;
      const idealSph       = denom > 0 ? Math.round((totalVolume / denom) * 100) / 100 : null;

      const tableRows = flowRows
        .slice()
        .sort((a, b) => b.order_volume - a.order_volume)
        .map((r) => ({
          ...r,
          weight_pct: totalVolume > 0 ? (r.order_volume / totalVolume) * 100 : 0,
        }));

      return { idealSph, totalVolume, totalPickHours, totalPackHours, nonProdHours, tableRows };
    }, [flowRows, nonProdHC]);

  // ── File handling ─────────────────────────────────────────────────────────
  const handleFile = useCallback(
    (file: File) => {
      setParseError(null);

      const reader = new FileReader();
      reader.onload = async (e) => {
        const text = e.target?.result as string;
        try {
          const { merchants: parsed, strategy, headerRow } = parseShipmentsCSV(text);
          setDebugStrategy(strategy);

          if (parsed.length === 0) {
            const hint = headerRow.length ? `Detected columns: ${headerRow.join(" | ")}` : "No header row found.";
            setParseError(
              strategy === "no-merchant-column"
                ? `No merchant column found. ${hint}`
                : `No rows could be parsed (strategy: ${strategy}). ${hint}`
            );
            return;
          }

          const calculated = calculateFlowManagement(parsed, pickingRates, packingRates);
          if (calculated.length === 0) {
            setParseError(
              `Parsed ${parsed.length} merchants but none matched the active benchmarks. ` +
              `Sample names: ${parsed.slice(0, 5).map((m) => m.merchant_name).join(", ")}`
            );
            return;
          }

          // Save raw merchants so benchmark changes refresh SPH on reload.
          setMerchants(parsed);
          setFileName(file.name);
          await Promise.all([
            cloudSet(MERCHANTS_KEY, parsed),
            cloudSet(FILENAME_KEY, file.name),
          ]);
        } catch (err) {
          setParseError(`Parse error: ${err instanceof Error ? err.message : String(err)}`);
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

  const handleClear = async () => {
    setFileName(null);
    setMerchants([]);
    setActualSph("");
    setParseError(null);
    setDebugStrategy(null);
    await Promise.all([
      cloudRemove(MERCHANTS_KEY),
      cloudRemove(FILENAME_KEY),
      cloudRemove(ACTUAL_SPH_KEY),
    ]);
  };

  const parsedActual = parseFloat(actualSph);
  const validActual  = !isNaN(parsedActual) && parsedActual > 0;
  const diff         = validActual && idealSph !== null ? parsedActual - idealSph : null;
  const diffPct      = diff !== null && idealSph !== null && idealSph > 0
    ? (diff / idealSph) * 100 : null;

  if (isLoading) {
    return (
      <div className="rounded-md border bg-card p-12 flex items-center justify-center text-xs text-muted-foreground">
        Loading saved data…
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* ── Upload + config card ──────────────────────────────────────────── */}
      <div className="rounded-md border bg-card p-4 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold">Actual SPH Comparison</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Upload the &quot;total orders shipped by merchant&quot; CSV. Ideal SPH is calculated as
              <code className="mx-1 font-mono text-[11px] bg-secondary px-1 py-0.5 rounded">
                total volume ÷ (pick hours + pack hours + non-prod hours)
              </code>
              — identical to the Flow Management formula. All inputs are saved across devices.
            </p>
          </div>
          {fileName && (
            <button
              onClick={handleClear}
              className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded text-xs border border-border bg-secondary text-muted-foreground hover:bg-accent transition-colors"
            >
              <X size={11} /> Clear
            </button>
          )}
        </div>

        {/* Non-prod headcount */}
        <div className="flex items-center gap-3 rounded-md bg-secondary/60 border border-border px-3 py-2.5">
          <Users size={14} className="text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium">Non-production headcount</p>
            <p className="text-[11px] text-muted-foreground">
              People not picking/packing · adds headcount × 8 h to the denominator
            </p>
          </div>
          <input
            type="number"
            min="0"
            step="1"
            value={nonProdHC}
            onChange={(e) => setNonProdHC(e.target.value)}
            className="w-16 text-right text-sm font-bold tabular-nums bg-transparent border-b border-border focus:outline-none focus:border-primary py-0.5"
          />
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
            {flowRows.length > 0 && <span>· {flowRows.length} merchants matched</span>}
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
      {idealSph !== null && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

            {/* Ideal SPH */}
            <div className="rounded-md border bg-card p-4 space-y-1">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Ideal SPH</p>
              <p className="text-3xl font-bold tabular-nums">{idealSph.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground">
                {totalVolume.toLocaleString()} vol ÷ ({totalPickHours.toFixed(1)}h pick
                + {totalPackHours.toFixed(1)}h pack
                + {nonProdHours}h non-prod)
              </p>
            </div>

            {/* Actual SPH */}
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
            <div className="px-4 py-3 border-b bg-secondary/50 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Merchant Breakdown
              </h3>
              <span className="text-xs text-muted-foreground">
                Non-prod: {parseInt(nonProdHC, 10) || 0} pax · {nonProdHours}h in denominator
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-secondary/30">
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">Merchant</th>
                    <th className="px-4 py-2 text-right font-medium text-muted-foreground">Volume</th>
                    <th className="px-4 py-2 text-right font-medium text-muted-foreground">Weight</th>
                    <th className="px-4 py-2 text-right font-medium text-muted-foreground">Pick hrs</th>
                    <th className="px-4 py-2 text-right font-medium text-muted-foreground">Pack hrs</th>
                    <th className="px-4 py-2 text-right font-medium text-muted-foreground">Merchant Ideal SPH</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((r, i) => (
                    <tr key={r.merchant_name} className={`border-b last:border-0 ${i % 2 === 0 ? "" : "bg-secondary/20"}`}>
                      <td className="px-4 py-2 font-medium text-foreground">{r.merchant_name}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.order_volume.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{r.weight_pct.toFixed(1)}%</td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{r.picking_hours.toFixed(2)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{r.packing_hours.toFixed(2)}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-medium">{r.ideal_sph.toFixed(2)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-border bg-secondary/40 font-semibold">
                    <td className="px-4 py-2 text-foreground">Total</td>
                    <td className="px-4 py-2 text-right tabular-nums">{totalVolume.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right tabular-nums">100%</td>
                    <td className="px-4 py-2 text-right tabular-nums">{totalPickHours.toFixed(2)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{totalPackHours.toFixed(2)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-primary">
                      {idealSph.toFixed(2)} <span className="font-normal text-muted-foreground">(incl. non-prod)</span>
                    </td>
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
