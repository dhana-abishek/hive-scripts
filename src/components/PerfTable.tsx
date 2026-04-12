import { useMemo } from "react";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";

export type SortKey = "merchant" | "benchmark" | "sph" | "shipments" | "performance";
export type SortDir = "asc" | "desc";

export interface MerchantPerf {
  merchant: string;
  avgBenchmark: number;
  avgSph: number;
  totalShipments: number;
  avgPerformance: number;
  workerCount: number;
}

interface PerfTableProps {
  data: MerchantPerf[];
  search: string;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  type: "picking" | "packing";
}

export function PerfTable({ data, search, sortKey, sortDir, onSort }: PerfTableProps) {
  const filtered = useMemo(() => {
    let d = data;
    if (search) d = d.filter((r) => r.merchant.toLowerCase().includes(search.toLowerCase()));
    d = [...d].sort((a, b) => {
      const map: Record<SortKey, (r: MerchantPerf) => number | string> = {
        merchant: (r) => r.merchant.toLowerCase(),
        benchmark: (r) => r.avgBenchmark,
        sph: (r) => r.avgSph,
        shipments: (r) => r.totalShipments,
        performance: (r) => r.avgPerformance,
      };
      const va = map[sortKey](a);
      const vb = map[sortKey](b);
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return d;
  }, [data, search, sortKey, sortDir]);

  const SortIcon = ({ k }: { k: SortKey }) => {
    if (sortKey !== k) return <ArrowUpDown size={12} className="text-muted-foreground" />;
    return sortDir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />;
  };

  const perfColor = (v: number) => v >= 100 ? "text-emerald-600" : v >= 85 ? "text-amber-600" : "text-red-600";

  return (
    <div className="rounded-md border bg-card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-xs text-muted-foreground">
            <th className="px-3 py-2 text-left cursor-pointer select-none" onClick={() => onSort("merchant")}>
              <span className="inline-flex items-center gap-1">Merchant <SortIcon k="merchant" /></span>
            </th>
            <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => onSort("shipments")}>
              <span className="inline-flex items-center gap-1 justify-end">Shipments <SortIcon k="shipments" /></span>
            </th>
            <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => onSort("benchmark")}>
              <span className="inline-flex items-center gap-1 justify-end">Benchmark <SortIcon k="benchmark" /></span>
            </th>
            <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => onSort("sph")}>
              <span className="inline-flex items-center gap-1 justify-end">Avg SPH <SortIcon k="sph" /></span>
            </th>
            <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => onSort("performance")}>
              <span className="inline-flex items-center gap-1 justify-end">Avg Performance <SortIcon k="performance" /></span>
            </th>
            <th className="px-3 py-2 text-right">Associates</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((r) => (
            <tr key={r.merchant} className="border-b last:border-0 hover:bg-muted/30">
              <td className="px-3 py-2 font-medium">{r.merchant}</td>
              <td className="px-3 py-2 text-right">{r.totalShipments.toLocaleString()}</td>
              <td className="px-3 py-2 text-right">{r.avgBenchmark.toFixed(1)}</td>
              <td className="px-3 py-2 text-right">{r.avgSph.toFixed(1)}</td>
              <td className={`px-3 py-2 text-right font-semibold ${perfColor(r.avgPerformance)}`}>{r.avgPerformance.toFixed(0)}%</td>
              <td className="px-3 py-2 text-right">{r.workerCount}</td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">No data</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
