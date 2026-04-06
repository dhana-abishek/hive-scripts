import { useState, useMemo, useCallback, useEffect } from "react";
import { Upload, Trash2, TrendingUp, TrendingDown, BarChart3, Gauge, ArrowUpDown, ArrowUp, ArrowDown, Search, Plus, X } from "lucide-react";
import { cloudGet as idbGet, cloudSet as idbSet, cloudRemove as idbRemove } from "@/lib/cloudStorage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const PICK_CSV_KEY = "perfPickingCsv";
const PACK_CSV_KEY = "perfPackingCsv";
const EXTRA_MERCHANTS_KEY = "perfExtraMerchants";

interface ExtraMerchant {
  id: string;
  name: string;
  orderVolume: number;
}
interface PickingRow {
  day_of_transaction: string;
  warehouse_name: string;
  merchant_name: string;
  picking_benchmark: number;
  full_name: string;
  total_shipments_picked: number;
  picking_sph: number;
  according_to_picking_benchmark: string;
  picking_type: string;
  total_performance: string;
  avg_total_performance: string;
}

interface PackingRow {
  day_of_transaction: string;
  warehouse_name: string;
  merchant_name: string;
  packing_benchmark: number;
  full_name: string;
  total_shipments_packed: number;
  packing_sph: number;
  according_to_packing_benchmark: string;
  total_performance: string;
}

function parsePercent(s: string): number {
  return parseFloat(s.replace("%", "")) || 0;
}

function parseCsv(text: string): string[][] {
  const lines = text.trim().split("\n");
  return lines.map((line) => {
    const parts: string[] = [];
    let current = "";
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === "," && !inQuotes) { parts.push(current.trim()); current = ""; continue; }
      current += ch;
    }
    parts.push(current.trim());
    return parts;
  });
}

function parsePickingCsv(text: string): PickingRow[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  return rows.slice(1).map((p) => ({
    day_of_transaction: p[0] || "",
    warehouse_name: p[1] || "",
    merchant_name: p[2] || "",
    picking_benchmark: parseFloat(p[3]) || 0,
    full_name: p[4] || "",
    total_shipments_picked: parseInt(p[5]) || 0,
    picking_sph: parseFloat(p[6]) || 0,
    according_to_picking_benchmark: p[7] || "",
    picking_type: p[8] || "",
    total_performance: p[9] || "",
    avg_total_performance: p[10] || "",
  }));
}

function parsePackingCsv(text: string): PackingRow[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  return rows.slice(1).map((p) => ({
    day_of_transaction: p[0] || "",
    warehouse_name: p[1] || "",
    merchant_name: p[2] || "",
    packing_benchmark: parseFloat(p[3]) || 0,
    full_name: p[4] || "",
    total_shipments_packed: parseInt(p[5]) || 0,
    packing_sph: parseFloat(p[6]) || 0,
    according_to_packing_benchmark: p[7] || "",
    total_performance: p[8] || "",
  }));
}

type SortKey = "merchant" | "benchmark" | "sph" | "shipments" | "performance";
type SortDir = "asc" | "desc";

interface MerchantPerf {
  merchant: string;
  avgBenchmark: number;
  avgSph: number;
  totalShipments: number;
  avgPerformance: number;
  workerCount: number;
}

function computeMerchantPerf(
  pickData: PickingRow[],
  packData: PackingRow[]
): { picking: MerchantPerf[]; packing: MerchantPerf[] } {
  // Picking: group by merchant
  const pickMap = new Map<string, { benchmarks: number[]; sphs: number[]; shipments: number; perfs: number[]; workers: Set<string> }>();
  for (const r of pickData) {
    if (!pickMap.has(r.merchant_name)) pickMap.set(r.merchant_name, { benchmarks: [], sphs: [], shipments: 0, perfs: [], workers: new Set() });
    const m = pickMap.get(r.merchant_name)!;
    m.benchmarks.push(r.picking_benchmark);
    m.sphs.push(r.picking_sph);
    m.shipments += r.total_shipments_picked;
    m.perfs.push(parsePercent(r.according_to_picking_benchmark));
    m.workers.add(r.full_name);
  }
  const picking: MerchantPerf[] = Array.from(pickMap.entries()).map(([merchant, d]) => ({
    merchant,
    avgBenchmark: d.benchmarks.reduce((a, b) => a + b, 0) / d.benchmarks.length,
    avgSph: d.sphs.reduce((a, b) => a + b, 0) / d.sphs.length,
    totalShipments: d.shipments,
    avgPerformance: d.perfs.reduce((a, b) => a + b, 0) / d.perfs.length,
    workerCount: d.workers.size,
  }));

  // Packing: group by merchant
  const packMap = new Map<string, { benchmarks: number[]; sphs: number[]; shipments: number; perfs: number[]; workers: Set<string> }>();
  for (const r of packData) {
    if (!packMap.has(r.merchant_name)) packMap.set(r.merchant_name, { benchmarks: [], sphs: [], shipments: 0, perfs: [], workers: new Set() });
    const m = packMap.get(r.merchant_name)!;
    m.benchmarks.push(r.packing_benchmark);
    m.sphs.push(r.packing_sph);
    m.shipments += r.total_shipments_packed;
    m.perfs.push(parsePercent(r.according_to_packing_benchmark));
    m.workers.add(r.full_name);
  }
  const packing: MerchantPerf[] = Array.from(packMap.entries()).map(([merchant, d]) => ({
    merchant,
    avgBenchmark: d.benchmarks.reduce((a, b) => a + b, 0) / d.benchmarks.length,
    avgSph: d.sphs.reduce((a, b) => a + b, 0) / d.sphs.length,
    totalShipments: d.shipments,
    avgPerformance: d.perfs.reduce((a, b) => a + b, 0) / d.perfs.length,
    workerCount: d.workers.size,
  }));

  return { picking, packing };
}

function StatCard({ title, value, subtitle, icon: Icon, color }: { title: string; value: string; subtitle?: string; icon: any; color: string }) {
  return (
    <div className="rounded-lg border bg-card p-4 space-y-1">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon size={14} className={color} />
        {title}
      </div>
      <p className="text-2xl font-bold tracking-tight">{value}</p>
      {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

function PerfTable({ data, search, sortKey, sortDir, onSort, type }: {
  data: MerchantPerf[];
  search: string;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  type: "picking" | "packing";
}) {
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
            <th className="px-3 py-2 text-right">Workers</th>
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

function WorkerTable({ pickData, packData }: { pickData: PickingRow[]; packData: PackingRow[] }) {
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
        <Input placeholder="Search worker..." value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 text-xs max-w-xs" />
      </div>
      <div className="rounded-md border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-xs text-muted-foreground">
              <th className="px-3 py-2 text-left cursor-pointer select-none" onClick={() => handleSort("name")}>
                <span className="inline-flex items-center gap-1">Worker <SortIcon k="name" /></span>
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
                <td className="px-3 py-2 text-right">{r.pickShipments || "—"}</td>
                <td className={`px-3 py-2 text-right font-semibold ${perfColor(r.pickPerf)}`}>{r.pickPerf !== null ? `${r.pickPerf.toFixed(0)}%` : "—"}</td>
                <td className="px-3 py-2 text-right">{r.packShipments || "—"}</td>
                <td className={`px-3 py-2 text-right font-semibold ${perfColor(r.packPerf)}`}>{r.packPerf !== null ? `${r.packPerf.toFixed(0)}%` : "—"}</td>
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

export function PerformanceTracker() {
  const [pickData, setPickData] = useState<PickingRow[]>([]);
  const [packData, setPackData] = useState<PackingRow[]>([]);

  useEffect(() => {
    (async () => {
      const [pickCsv, packCsv] = await Promise.all([
        idbGet<string>(PICK_CSV_KEY),
        idbGet<string>(PACK_CSV_KEY),
      ]);
      if (pickCsv) setPickData(parsePickingCsv(pickCsv));
      if (packCsv) setPackData(parsePackingCsv(packCsv));
    })();
  }, []);

  const [pickSearch, setPickSearch] = useState("");
  const [packSearch, setPackSearch] = useState("");
  const [pickSort, setPickSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "performance", dir: "desc" });
  const [packSort, setPackSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "performance", dir: "desc" });

  const handlePickUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const text = ev.target?.result as string;
      await idbSet(PICK_CSV_KEY, text);
      setPickData(parsePickingCsv(text));
    };
    reader.readAsText(file);
    e.target.value = "";
  }, []);

  const handlePackUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const text = ev.target?.result as string;
      await idbSet(PACK_CSV_KEY, text);
      setPackData(parsePackingCsv(text));
    };
    reader.readAsText(file);
    e.target.value = "";
  }, []);

  const handleDeletePick = useCallback(async () => {
    await idbRemove(PICK_CSV_KEY);
    setPickData([]);
  }, []);

  const handleDeletePack = useCallback(async () => {
    await idbRemove(PACK_CSV_KEY);
    setPackData([]);
  }, []);

  const { picking: pickMerchants, packing: packMerchants } = useMemo(() => computeMerchantPerf(pickData, packData), [pickData, packData]);

  const handlePickSort = useCallback((key: SortKey) => {
    setPickSort((prev) => prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" });
  }, []);
  const handlePackSort = useCallback((key: SortKey) => {
    setPackSort((prev) => prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" });
  }, []);

  // Overall stats
  const stats = useMemo(() => {
    const totalPickShipments = pickData.reduce((s, r) => s + r.total_shipments_picked, 0);
    const totalPackShipments = packData.reduce((s, r) => s + r.total_shipments_packed, 0);
    // Weighted average: weight = time spent = shipments / sph
    let pickWeightedSum = 0, pickWeightTotal = 0;
    for (const r of pickData) {
      if (r.picking_sph > 0) {
        const time = r.total_shipments_picked / r.picking_sph;
        pickWeightedSum += parsePercent(r.according_to_picking_benchmark) * time;
        pickWeightTotal += time;
      }
    }
    let packWeightedSum = 0, packWeightTotal = 0;
    for (const r of packData) {
      if (r.packing_sph > 0) {
        const time = r.total_shipments_packed / r.packing_sph;
        packWeightedSum += parsePercent(r.according_to_packing_benchmark) * time;
        packWeightTotal += time;
      }
    }
    const avgPickPerf = pickWeightTotal > 0 ? pickWeightedSum / pickWeightTotal : 0;
    const avgPackPerf = packWeightTotal > 0 ? packWeightedSum / packWeightTotal : 0;
    const pickWorkers = new Set(pickData.map((r) => r.full_name)).size;
    const packWorkers = new Set(packData.map((r) => r.full_name)).size;

    // Best & worst merchants
    const bestPick = pickMerchants.length ? [...pickMerchants].sort((a, b) => b.avgPerformance - a.avgPerformance)[0] : null;
    const worstPick = pickMerchants.length ? [...pickMerchants].sort((a, b) => a.avgPerformance - b.avgPerformance)[0] : null;
    const bestPack = packMerchants.length ? [...packMerchants].sort((a, b) => b.avgPerformance - a.avgPerformance)[0] : null;
    const worstPack = packMerchants.length ? [...packMerchants].sort((a, b) => a.avgPerformance - b.avgPerformance)[0] : null;

    // Real SPH: total packed shipments / (pick time + pack time)
    const totalTime = pickWeightTotal + packWeightTotal;
    const realSph = totalTime > 0 ? totalPackShipments / totalTime : 0;

    return { totalPickShipments, totalPackShipments, avgPickPerf, avgPackPerf, pickWorkers, packWorkers, bestPick, worstPick, bestPack, worstPack, realSph };
  }, [pickData, packData, pickMerchants, packMerchants]);

  const hasData = pickData.length > 0 || packData.length > 0;

  return (
    <div className="space-y-6">
      {/* Upload Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart3 size={16} className="text-primary" />
              <h3 className="text-sm font-semibold">Picking Performance</h3>
            </div>
            <div className="flex items-center gap-2">
              <label className="cursor-pointer">
                <input type="file" accept=".csv" onChange={handlePickUpload} className="hidden" />
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border border-border bg-secondary text-foreground hover:bg-accent transition-colors">
                  <Upload size={12} /> {pickData.length > 0 ? "Replace CSV" : "Upload CSV"}
                </span>
              </label>
              {pickData.length > 0 && (
                <Button variant="ghost" size="sm" onClick={handleDeletePick} className="h-7 px-2 text-xs text-destructive hover:text-destructive">
                  <Trash2 size={12} />
                </Button>
              )}
            </div>
          </div>
          {pickData.length > 0 ? (
            <p className="text-xs text-muted-foreground">{pickData.length} records loaded • {new Set(pickData.map((r) => r.full_name)).size} workers • {new Set(pickData.map((r) => r.merchant_name)).size} merchants</p>
          ) : (
            <p className="text-xs text-muted-foreground">No picking performance data uploaded</p>
          )}
        </div>

        <div className="rounded-lg border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Gauge size={16} className="text-primary" />
              <h3 className="text-sm font-semibold">Packing Performance</h3>
            </div>
            <div className="flex items-center gap-2">
              <label className="cursor-pointer">
                <input type="file" accept=".csv" onChange={handlePackUpload} className="hidden" />
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border border-border bg-secondary text-foreground hover:bg-accent transition-colors">
                  <Upload size={12} /> {packData.length > 0 ? "Replace CSV" : "Upload CSV"}
                </span>
              </label>
              {packData.length > 0 && (
                <Button variant="ghost" size="sm" onClick={handleDeletePack} className="h-7 px-2 text-xs text-destructive hover:text-destructive">
                  <Trash2 size={12} />
                </Button>
              )}
            </div>
          </div>
          {packData.length > 0 ? (
            <p className="text-xs text-muted-foreground">{packData.length} records loaded • {new Set(packData.map((r) => r.full_name)).size} workers • {new Set(packData.map((r) => r.merchant_name)).size} merchants</p>
          ) : (
            <p className="text-xs text-muted-foreground">No packing performance data uploaded</p>
          )}
        </div>
      </div>

      {hasData && (
        <>
          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <StatCard title="Avg Pick Performance" value={`${stats.avgPickPerf.toFixed(0)}%`} subtitle={`${stats.totalPickShipments.toLocaleString()} shipments • ${stats.pickWorkers} workers`} icon={BarChart3} color="text-primary" />
            <StatCard title="Avg Pack Performance" value={`${stats.avgPackPerf.toFixed(0)}%`} subtitle={`${stats.totalPackShipments.toLocaleString()} shipments • ${stats.packWorkers} workers`} icon={Gauge} color="text-primary" />
            <StatCard title="Real SPH" value={stats.realSph.toFixed(1)} subtitle={`${stats.totalPackShipments.toLocaleString()} packed shipments`} icon={TrendingUp} color="text-emerald-600" />
          </div>

          {/* Merchant tables */}
          {pickMerchants.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold flex items-center gap-2"><BarChart3 size={14} className="text-primary" /> Picking Performance by Merchant</h3>
                <div className="flex items-center gap-2">
                  <Search size={14} className="text-muted-foreground" />
                  <Input placeholder="Search merchant..." value={pickSearch} onChange={(e) => setPickSearch(e.target.value)} className="h-8 text-xs max-w-xs" />
                </div>
              </div>
              <PerfTable data={pickMerchants} search={pickSearch} sortKey={pickSort.key} sortDir={pickSort.dir} onSort={handlePickSort} type="picking" />
            </div>
          )}

          {packMerchants.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold flex items-center gap-2"><Gauge size={14} className="text-primary" /> Packing Performance by Merchant</h3>
                <div className="flex items-center gap-2">
                  <Search size={14} className="text-muted-foreground" />
                  <Input placeholder="Search merchant..." value={packSearch} onChange={(e) => setPackSearch(e.target.value)} className="h-8 text-xs max-w-xs" />
                </div>
              </div>
              <PerfTable data={packMerchants} search={packSearch} sortKey={packSort.key} sortDir={packSort.dir} onSort={handlePackSort} type="packing" />
            </div>
          )}

          {/* Worker performance table */}
          {(pickData.length > 0 || packData.length > 0) && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Worker Performance Overview</h3>
              <WorkerTable pickData={pickData} packData={packData} />
            </div>
          )}
        </>
      )}

      {!hasData && (
        <div className="rounded-md border bg-card p-12 flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <BarChart3 size={32} />
          <p className="text-sm">Upload picking and/or packing performance CSV files to view analytics</p>
        </div>
      )}
    </div>
  );
}
