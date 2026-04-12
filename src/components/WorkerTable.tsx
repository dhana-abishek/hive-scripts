import { useState, useMemo } from "react";
import { ArrowUpDown, ArrowUp, ArrowDown, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

type SortDir = "asc" | "desc";

interface PickingRow {
  full_name: string;
  total_shipments_picked: number;
  according_to_picking_benchmark: string;
}

interface PackingRow {
  full_name: string;
  total_shipments_packed: number;
  according_to_packing_benchmark: string;
}

function parsePercent(s: string): number {
  return parseFloat(s.replace("%", "")) || 0;
}

export function WorkerTable({ pickData, packData }: { pickData: PickingRow[]; packData: PackingRow[] }) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<"name" | "pickPerf" | "packPerf" | "avgPerf">("avgPerf");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const workers = useMemo(() => {
    const map = new Map<string, { pickPerfs: number[]; packPerfs: number[]; pickShipments: number; packShipments: number }>();
    for (const r of pickData) {
      if (!map.has(r.full_name)) map.set(r.full_name, { pickPerfs: [], packPerfs: [], pickShipments: 0, packShipments: 0 });
      const w = map.get(r.full_name)!;
      w.pickPerfs.push(parsePercent(r.according_to_picking_benchmark));
      w.pickShipments += r.total_shipments_picked;
    }
    for (const r of packData) {
      if (!map.has(r.full_name)) map.set(r.full_name, { pickPerfs: [], packPerfs: [], pickShipments: 0, packShipments: 0 });
      const w = map.get(r.full_name)!;
      w.packPerfs.push(parsePercent(r.according_to_packing_benchmark));
      w.packShipments += r.total_shipments_packed;
    }
    return Array.from(map.entries()).map(([name, d]) => {
      const pickAvg = d.pickPerfs.length ? d.pickPerfs.reduce((a, b) => a + b, 0) / d.pickPerfs.length : null;
      const packAvg = d.packPerfs.length ? d.packPerfs.reduce((a, b) => a + b, 0) / d.packPerfs.length : null;
      const allPerfs = [...d.pickPerfs, ...d.packPerfs];
      const avg = allPerfs.length ? allPerfs.reduce((a, b) => a + b, 0) / allPerfs.length : 0;
      return { name, pickPerf: pickAvg, packPerf: packAvg, avgPerf: avg, pickShipments: d.pickShipments, packShipments: d.packShipments };
    });
  }, [pickData, packData]);

  const filtered = useMemo(() => {
    let d = workers;
    if (search) d = d.filter((r) => r.name.toLowerCase().includes(search.toLowerCase()));
    return [...d].sort((a, b) => {
      const map: Record<string, (r: typeof d[0]) => number | string> = {
        name: (r) => r.name.toLowerCase(),
        pickPerf: (r) => r.pickPerf ?? -1,
        packPerf: (r) => r.packPerf ?? -1,
        avgPerf: (r) => r.avgPerf,
      };
      const va = map[sortKey](a);
      const vb = map[sortKey](b);
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [workers, search, sortKey, sortDir]);

  const handleSort = (k: typeof sortKey) => {
    if (sortKey === k) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir("desc"); }
  };

  const SortIcon = ({ k }: { k: string }) => {
    if (sortKey !== k) return <ArrowUpDown size={12} className="text-muted-foreground" />;
    return sortDir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />;
  };

  const perfColor = (v: number | null) => v === null ? "" : v >= 100 ? "text-emerald-600" : v >= 85 ? "text-amber-600" : "text-red-600";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Search size={14} className="text-muted-foreground" />
        <Input placeholder="Search associate..." value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 text-xs max-w-xs" />
      </div>
      <div className="rounded-md border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-xs text-muted-foreground">
              <th className="px-3 py-2 text-left cursor-pointer select-none" onClick={() => handleSort("name")}>
                <span className="inline-flex items-center gap-1">Associate <SortIcon k="name" /></span>
              </th>
              <th className="px-3 py-2 text-right">Pick Ships</th>
              <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => handleSort("pickPerf")}>
                <span className="inline-flex items-center gap-1 justify-end">Pick Perf <SortIcon k="pickPerf" /></span>
              </th>
              <th className="px-3 py-2 text-right">Pack Ships</th>
              <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => handleSort("packPerf")}>
                <span className="inline-flex items-center gap-1 justify-end">Pack Perf <SortIcon k="packPerf" /></span>
              </th>
              <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => handleSort("avgPerf")}>
                <span className="inline-flex items-center gap-1 justify-end">Overall <SortIcon k="avgPerf" /></span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.name} className="border-b last:border-0 hover:bg-muted/30">
                <td className="px-3 py-2 font-medium">{r.name}</td>
                <td className="px-3 py-2 text-right">{r.pickShipments || "\u2014"}</td>
                <td className={`px-3 py-2 text-right font-semibold ${perfColor(r.pickPerf)}`}>{r.pickPerf !== null ? `${r.pickPerf.toFixed(0)}%` : "\u2014"}</td>
                <td className="px-3 py-2 text-right">{r.packShipments || "\u2014"}</td>
                <td className={`px-3 py-2 text-right font-semibold ${perfColor(r.packPerf)}`}>{r.packPerf !== null ? `${r.packPerf.toFixed(0)}%` : "\u2014"}</td>
                <td className={`px-3 py-2 text-right font-semibold ${perfColor(r.avgPerf)}`}>{r.avgPerf.toFixed(0)}%</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">No data</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
