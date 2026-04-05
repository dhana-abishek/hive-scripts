import { useState, useMemo, useCallback } from "react";
import { ArrowUpDown, ArrowUp, ArrowDown, Search } from "lucide-react";

const MULTIPLIER = 1.125;
const BACKLOG_KEY = "plannedBacklog";

function loadBacklog(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(BACKLOG_KEY) || "{}"); } catch { return {}; }
}

interface FlowManagementTableProps {
  data: {
    merchant_name: string;
    order_volume: number;
    waiting_for_picking: number;
    picking_hours: number;
    packing_hours: number;
    ideal_sph: number;
  }[];
  pickingRates?: Record<string, number>;
  packingRates?: Record<string, number>;
  onBacklogChange?: (backlog: Record<string, number>) => void;
}

type SortKey = "merchant_name" | "order_volume" | "planned_backlog" | "waiting_for_picking" | "picking_hours" | "packing_hours" | "ideal_sph";

export function FlowManagementTable({ data, pickingRates = {}, packingRates = {}, onBacklogChange }: FlowManagementTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("order_volume");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [search, setSearch] = useState("");
  const [backlog, setBacklog] = useState<Record<string, number>>(loadBacklog);
  const [editingMerchant, setEditingMerchant] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const saveBacklog = useCallback((updated: Record<string, number>) => {
    setBacklog(updated);
    localStorage.setItem(BACKLOG_KEY, JSON.stringify(updated));
    onBacklogChange?.(updated);
  }, [onBacklogChange]);

  const handleStartEdit = (merchant: string) => {
    setEditingMerchant(merchant);
    setEditValue(String(backlog[merchant] || 0));
  };

  const handleCommitEdit = () => {
    if (!editingMerchant) return;
    const val = Math.max(0, parseInt(editValue, 10) || 0);
    const updated = { ...backlog, [editingMerchant]: val };
    saveBacklog(updated);
    setEditingMerchant(null);
  };

  const adjustedData = useMemo(() => {
    return data.map((row) => {
      const bl = backlog[row.merchant_name] || 0;
      const effectiveVolume = Math.max(0, row.order_volume - bl);
      const effectiveWaiting = Math.max(0, row.waiting_for_picking - bl);

      const pickRate = pickingRates[row.merchant_name];
      const packRate = packingRates[row.merchant_name];

      let pickHrs = row.picking_hours;
      let packHrs = row.packing_hours;
      let idealSph = row.ideal_sph;

      if (bl > 0 && pickRate && packRate && pickRate > 0 && packRate > 0) {
        pickHrs = effectiveWaiting / (pickRate * MULTIPLIER);
        packHrs = effectiveVolume / (packRate * MULTIPLIER);
        const totalHrs = pickHrs + packHrs;
        idealSph = totalHrs > 0 ? effectiveVolume / totalHrs : 0;
        pickHrs = Math.round(pickHrs * 100) / 100;
        packHrs = Math.round(packHrs * 100) / 100;
        idealSph = Math.round(idealSph * 100) / 100;
      }

      return {
        ...row,
        planned_backlog: bl,
        picking_hours: pickHrs,
        packing_hours: packHrs,
        ideal_sph: idealSph,
      };
    });
  }, [data, backlog, pickingRates, packingRates]);

  const filtered = useMemo(() => {
    let result = adjustedData;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((r) => r.merchant_name.toLowerCase().includes(q));
    }
    return [...result].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [adjustedData, sortKey, sortDir, search]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowUpDown size={12} className="text-muted-foreground/50" />;
    return sortDir === "asc" ? <ArrowUp size={12} className="text-primary" /> : <ArrowDown size={12} className="text-primary" />;
  };

  const getSphColor = (sph: number) => {
    if (sph >= 50) return "text-success";
    if (sph >= 25) return "text-foreground";
    return "text-warning";
  };

  const columns: { key: SortKey; label: string; align?: string }[] = [
    { key: "merchant_name", label: "Merchant" },
    { key: "order_volume", label: "Orders", align: "right" },
    { key: "planned_backlog", label: "Planned Backlog", align: "right" },
    { key: "waiting_for_picking", label: "Waiting", align: "right" },
    { key: "picking_hours", label: "Pick Hrs", align: "right" },
    { key: "packing_hours", label: "Pack Hrs", align: "right" },
    { key: "ideal_sph", label: "Ideal SPH", align: "right" },
  ];

  return (
    <div className="rounded-md border bg-card">
      <div className="p-3 border-b flex items-center gap-2">
        <Search size={14} className="text-muted-foreground" />
        <input
          type="text"
          placeholder="Search merchants..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none flex-1"
        />
        <span className="text-xs text-muted-foreground">{filtered.length} merchants</span>
      </div>
      <div className="overflow-auto max-h-[600px]">
        <table className="w-full">
          <thead className="sticky top-0 bg-card z-10">
            <tr className="border-b">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`table-header px-3 py-2 cursor-pointer hover:text-foreground transition-colors ${col.align === "right" ? "text-right" : "text-left"}`}
                  onClick={() => toggleSort(col.key)}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label} <SortIcon col={col.key} />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.merchant_name} className="border-b border-border/50 hover:bg-secondary/50 transition-colors">
                <td className="px-3 py-2 text-sm font-medium truncate max-w-[200px]">{row.merchant_name}</td>
                <td className="table-cell px-3 py-2 text-right">{row.order_volume}</td>
                <td className="table-cell px-3 py-2 text-right">
                  {editingMerchant === row.merchant_name ? (
                    <input
                      type="number"
                      min={0}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={handleCommitEdit}
                      onKeyDown={(e) => { if (e.key === "Enter") handleCommitEdit(); if (e.key === "Escape") setEditingMerchant(null); }}
                      autoFocus
                      className="w-16 bg-secondary border border-border rounded px-1 py-0.5 text-xs text-right text-foreground outline-none focus:ring-1 focus:ring-primary"
                    />
                  ) : (
                    <button
                      onClick={() => handleStartEdit(row.merchant_name)}
                      className="text-xs hover:text-primary transition-colors cursor-pointer tabular-nums"
                      title="Click to edit planned backlog"
                    >
                      {row.planned_backlog}
                    </button>
                  )}
                </td>
                <td className="table-cell px-3 py-2 text-right">{row.waiting_for_picking}</td>
                <td className="table-cell px-3 py-2 text-right">{row.picking_hours.toFixed(2)}</td>
                <td className="table-cell px-3 py-2 text-right">{row.packing_hours.toFixed(2)}</td>
                <td className={`table-cell px-3 py-2 text-right font-semibold ${getSphColor(row.ideal_sph)}`}>
                  {row.ideal_sph.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
