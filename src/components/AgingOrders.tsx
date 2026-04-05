import { useState, useMemo, useCallback, useEffect } from "react";
import { Upload, Calendar, ArrowUpDown, ArrowUp, ArrowDown, Search, Package, Clock, Gauge, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatCard } from "@/components/SummaryStats";

const MULTIPLIER = 1.125;
const STORAGE_KEY_CSV = "agingOrdersCsv";
const STORAGE_KEY_BACKLOG = "agingOrdersBacklog";

interface AgingRow {
  ready_for_fulfillment_at: string;
  merchant: string;
  count_orders: number;
}

interface AgingOrdersProps {
  pickingRates: Record<string, number>;
  packingRates: Record<string, number>;
}

type SortKey = "merchant" | "count_orders" | "picking_hours" | "packing_hours" | "ideal_sph";

function parseCSV(text: string): AgingRow[] {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const rows: AgingRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts: string[] = [];
    let current = "";
    let inQuotes = false;
    for (const ch of lines[i]) {
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === "," && !inQuotes) { parts.push(current.trim()); current = ""; continue; }
      current += ch;
    }
    parts.push(current.trim());
    if (parts.length >= 3) {
      rows.push({
        ready_for_fulfillment_at: parts[0],
        merchant: parts[1],
        count_orders: parseInt(parts[2], 10) || 0,
      });
    }
  }
  return rows;
}

function uniqueDates(data: AgingRow[]): string[] {
  const set = new Set(data.map((r) => r.ready_for_fulfillment_at));
  return Array.from(set).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
}

export function AgingOrders({ pickingRates, packingRates }: AgingOrdersProps) {
  const [rawData, setRawData] = useState<AgingRow[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_CSV);
    if (saved) {
      try { return JSON.parse(saved) as AgingRow[]; } catch { return []; }
    }
    return [];
  });
  const [hasFile, setHasFile] = useState(() => !!localStorage.getItem(STORAGE_KEY_CSV));
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [sortKey, setSortKey] = useState<SortKey>("count_orders");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [search, setSearch] = useState("");
  const [backlog, setBacklog] = useState<Record<string, number>>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_BACKLOG);
    if (saved) { try { return JSON.parse(saved); } catch { return {}; } }
    return {};
  });
  const [editingMerchant, setEditingMerchant] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  // Initialize date filters from loaded data
  useEffect(() => {
    if (rawData.length > 0 && !startDate && !endDate) {
      const d = uniqueDates(rawData);
      if (d.length > 0) { setStartDate(d[0]); setEndDate(d[d.length - 1]); }
    }
  }, [rawData, startDate, endDate]);

  // Persist backlog
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_BACKLOG, JSON.stringify(backlog));
  }, [backlog]);

  const handleUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const parsed = parseCSV(text);
      setRawData(parsed);
      setBacklog({});
      setHasFile(true);
      localStorage.setItem(STORAGE_KEY_CSV, JSON.stringify(parsed));
      localStorage.removeItem(STORAGE_KEY_BACKLOG);
      const dates = uniqueDates(parsed);
      if (dates.length > 0) {
        setStartDate(dates[0]);
        setEndDate(dates[dates.length - 1]);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }, []);

  const handleDeleteCsv = useCallback(() => {
    setRawData([]);
    setBacklog({});
    setHasFile(false);
    setStartDate("");
    setEndDate("");
    localStorage.removeItem(STORAGE_KEY_CSV);
    localStorage.removeItem(STORAGE_KEY_BACKLOG);
  }, []);

  const dates = useMemo(() => uniqueDates(rawData), [rawData]);

  const filteredByDate = useMemo(() => {
    if (!startDate && !endDate) return rawData;
    return rawData.filter((r) => {
      const d = new Date(r.ready_for_fulfillment_at).getTime();
      const s = startDate ? new Date(startDate).getTime() : -Infinity;
      const e = endDate ? new Date(endDate).getTime() : Infinity;
      return d >= s && d <= e;
    });
  }, [rawData, startDate, endDate]);

  // Aggregate by merchant
  const merchantData = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of filteredByDate) {
      map[r.merchant] = (map[r.merchant] || 0) + r.count_orders;
    }
    return Object.entries(map).map(([merchant, orders]) => {
      const bl = backlog[merchant] || 0;
      const effVol = Math.max(0, orders - bl);
      const pickRate = pickingRates[merchant];
      const packRate = packingRates[merchant];
      let pickHrs = 0;
      let packHrs = 0;
      let idealSph = 0;
      if (pickRate && packRate && pickRate > 0 && packRate > 0) {
        pickHrs = effVol / (pickRate * MULTIPLIER);
        packHrs = effVol / (packRate * MULTIPLIER);
        const totalHrs = pickHrs + packHrs;
        idealSph = totalHrs > 0 ? effVol / totalHrs : 0;
      }
      return {
        merchant,
        count_orders: orders,
        planned_backlog: bl,
        picking_hours: Math.round(pickHrs * 100) / 100,
        packing_hours: Math.round(packHrs * 100) / 100,
        ideal_sph: Math.round(idealSph * 100) / 100,
      };
    });
  }, [filteredByDate, backlog, pickingRates, packingRates]);

  const totalOrders = merchantData.reduce((s, r) => s + r.count_orders, 0);
  const totalBacklog = merchantData.reduce((s, r) => s + r.planned_backlog, 0);
  const totalPickHrs = merchantData.reduce((s, r) => s + r.picking_hours, 0);
  const totalPackHrs = merchantData.reduce((s, r) => s + r.packing_hours, 0);
  const effectiveOrders = Math.max(0, totalOrders - totalBacklog);
  const overallSph = (totalPickHrs + totalPackHrs) > 0 ? effectiveOrders / (totalPickHrs + totalPackHrs) : 0;

  const filtered = useMemo(() => {
    let result = merchantData;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((r) => r.merchant.toLowerCase().includes(q));
    }
    return [...result].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [merchantData, sortKey, sortDir, search]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowUpDown size={12} className="text-muted-foreground/50" />;
    return sortDir === "asc" ? <ArrowUp size={12} className="text-primary" /> : <ArrowDown size={12} className="text-primary" />;
  };

  const handleStartEdit = (merchant: string) => {
    setEditingMerchant(merchant);
    setEditValue(String(backlog[merchant] || 0));
  };

  const handleCommitEdit = () => {
    if (!editingMerchant) return;
    const val = Math.max(0, parseInt(editValue, 10) || 0);
    setBacklog((prev) => ({ ...prev, [editingMerchant]: val }));
    setEditingMerchant(null);
  };

  const handleResetBacklog = () => setBacklog({});

  const getSphColor = (sph: number) => {
    if (sph >= 50) return "text-success";
    if (sph >= 25) return "text-foreground";
    return "text-warning";
  };

  const columns: { key: SortKey; label: string; align?: string }[] = [
    { key: "merchant", label: "Merchant" },
    { key: "count_orders", label: "Orders", align: "right" },
    { key: "picking_hours", label: "Pick Hrs", align: "right" },
    { key: "packing_hours", label: "Pack Hrs", align: "right" },
    { key: "ideal_sph", label: "Ideal SPH", align: "right" },
  ];

  return (
    <div className="space-y-4">
      {/* Upload & Date Filter */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Upload CSV</label>
          <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium border border-border bg-secondary text-foreground hover:bg-accent transition-colors cursor-pointer">
            <Upload size={14} />
            {fileName ?? "Choose file"}
            <input type="file" accept=".csv" onChange={handleUpload} className="hidden" />
          </label>
        </div>
        {dates.length > 0 && (
          <>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">From</label>
              <select
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-9 rounded-md border border-border bg-secondary text-foreground text-xs px-2"
              >
                {dates.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">To</label>
              <select
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="h-9 rounded-md border border-border bg-secondary text-foreground text-xs px-2"
              >
                {dates.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </>
        )}
      </div>

      {rawData.length === 0 ? (
        <div className="rounded-md border bg-card p-12 flex flex-col items-center justify-center gap-2 text-muted-foreground">
          <Calendar size={32} />
          <span className="text-sm">Upload a CSV file to view aging orders</span>
        </div>
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Total Orders" value={totalOrders.toLocaleString()} icon={<Package size={16} />} subtext={`${merchantData.length} merchants`} />
            <StatCard label="Effective Orders" value={effectiveOrders.toLocaleString()} icon={<Package size={16} />} subtext={`After ${totalBacklog} backlog`} variant="success" />
            <StatCard label="Picking Hours" value={`${totalPickHrs.toFixed(1)}h`} icon={<Clock size={16} />} variant="warning" />
            <StatCard label="Packing Hours" value={`${totalPackHrs.toFixed(1)}h`} icon={<Clock size={16} />} variant="warning" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="relative h-full">
              <StatCard label="Planned Backlog" value={totalBacklog.toLocaleString()} icon={<Package size={16} />} subtext="Orders deferred" />
              {totalBacklog > 0 && (
                <Button variant="ghost" size="sm" className="absolute top-8 right-2 h-6 px-2 text-xs text-muted-foreground hover:text-destructive" onClick={handleResetBacklog} title="Reset all planned backlog to 0">
                  <RotateCcw size={12} className="mr-1" /> Reset
                </Button>
              )}
            </div>
            <StatCard label="Predicted SPH" value={overallSph.toFixed(1)} icon={<Gauge size={16} />} subtext="Based on date filter" variant="success" />
          </div>

          {/* Table */}
          <div className="rounded-md border bg-card">
            <div className="p-3 border-b flex items-center gap-2">
              <Search size={14} className="text-muted-foreground" />
              <input type="text" placeholder="Search merchants..." value={search} onChange={(e) => setSearch(e.target.value)} className="bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none flex-1" />
              <span className="text-xs text-muted-foreground">{filtered.length} merchants</span>
            </div>
            <div className="overflow-auto max-h-[600px]">
              <table className="w-full">
                <thead className="sticky top-0 bg-card z-10">
                  <tr className="border-b">
                    {columns.map((col) => (
                      <th key={col.key} className={`table-header px-3 py-2 cursor-pointer hover:text-foreground transition-colors ${col.align === "right" ? "text-right" : "text-left"}`} onClick={() => toggleSort(col.key)}>
                        <span className="inline-flex items-center gap-1">{col.label} <SortIcon col={col.key} /></span>
                      </th>
                    ))}
                    <th className="table-header px-3 py-2 text-right">Backlog</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr key={row.merchant} className="border-b border-border/50 hover:bg-secondary/50 transition-colors">
                      <td className="px-3 py-2 text-sm font-medium truncate max-w-[200px]">{row.merchant}</td>
                      <td className="table-cell px-3 py-2 text-right">{row.count_orders}</td>
                      <td className="table-cell px-3 py-2 text-right">{row.picking_hours.toFixed(2)}</td>
                      <td className="table-cell px-3 py-2 text-right">{row.packing_hours.toFixed(2)}</td>
                      <td className={`table-cell px-3 py-2 text-right font-semibold ${getSphColor(row.ideal_sph)}`}>{row.ideal_sph.toFixed(2)}</td>
                      <td className="table-cell px-3 py-2 text-right">
                        {editingMerchant === row.merchant ? (
                          <input type="number" min={0} value={editValue} onChange={(e) => setEditValue(e.target.value)} onBlur={handleCommitEdit} onKeyDown={(e) => { if (e.key === "Enter") handleCommitEdit(); if (e.key === "Escape") setEditingMerchant(null); }} autoFocus className="w-16 bg-secondary border border-border rounded px-1 py-0.5 text-xs text-right text-foreground outline-none focus:ring-1 focus:ring-primary" />
                        ) : (
                          <button onClick={() => handleStartEdit(row.merchant)} className="text-xs hover:text-primary transition-colors cursor-pointer tabular-nums" title="Click to edit planned backlog">{row.planned_backlog}</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
