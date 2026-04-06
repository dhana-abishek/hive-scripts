import { useState, useMemo, useCallback, useEffect } from "react";
import { ArrowUpDown, ArrowUp, ArrowDown, Search, Plus, X, TrendingUp } from "lucide-react";
import { cloudGet as idbGet, cloudSet as idbSet } from "@/lib/cloudStorage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getInflowFactor } from "@/lib/inflowEstimation";
import type { ExtraMerchant } from "@/components/PerformanceTracker";

const MULTIPLIER = 1.125;
const BACKLOG_KEY = "plannedBacklog";
const EXTRA_MERCHANTS_KEY = "perfExtraMerchants";

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
  externalBacklog?: Record<string, number>;
  extraMerchants?: ExtraMerchant[];
  onExtraMerchantsChange?: (merchants: ExtraMerchant[]) => void;
  inflowEnabled?: boolean;
  onInflowToggle?: (enabled: boolean) => void;
}

type SortKey = "merchant_name" | "order_volume" | "planned_backlog" | "waiting_for_picking" | "picking_hours" | "packing_hours" | "ideal_sph";

export function FlowManagementTable({ data, pickingRates = {}, packingRates = {}, onBacklogChange, externalBacklog, extraMerchants = [], onExtraMerchantsChange, inflowEnabled = false, onInflowToggle }: FlowManagementTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("order_volume");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [search, setSearch] = useState("");
  const [backlog, setBacklog] = useState<Record<string, number>>({});
  const [editingMerchant, setEditingMerchant] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [newMerchantName, setNewMerchantName] = useState("");
  const [newMerchantVolume, setNewMerchantVolume] = useState("");

  useEffect(() => {
    idbGet<Record<string, number>>(BACKLOG_KEY).then((v) => { if (v) setBacklog(v); });
  }, []);

  useEffect(() => {
    if (externalBacklog !== undefined) {
      setBacklog(externalBacklog);
    }
  }, [externalBacklog]);

  const saveBacklog = useCallback((updated: Record<string, number>) => {
    setBacklog(updated);
    idbSet(BACKLOG_KEY, updated);
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

  const addExtraMerchant = useCallback(async () => {
    const name = newMerchantName.trim();
    const volume = parseInt(newMerchantVolume);
    if (!name || !volume || volume <= 0) return;
    const entry: ExtraMerchant = { id: crypto.randomUUID(), name, orderVolume: volume };
    const updated = [...extraMerchants, entry];
    await idbSet(EXTRA_MERCHANTS_KEY, updated);
    onExtraMerchantsChange?.(updated);
    setNewMerchantName("");
    setNewMerchantVolume("");
  }, [extraMerchants, newMerchantName, newMerchantVolume, onExtraMerchantsChange]);

  const removeExtraMerchant = useCallback(async (id: string) => {
    const updated = extraMerchants.filter((m) => m.id !== id);
    await idbSet(EXTRA_MERCHANTS_KEY, updated);
    onExtraMerchantsChange?.(updated);
  }, [extraMerchants, onExtraMerchantsChange]);

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
    <div className="space-y-4">
      {/* Additional Merchant Orders */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Plus size={14} className="text-primary" /> Order Inflow
        </h3>
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <label className="text-xs text-muted-foreground">Merchant Name</label>
            <Input placeholder="e.g. Merchant XYZ" value={newMerchantName} onChange={(e) => setNewMerchantName(e.target.value)} className="h-8 text-xs" />
          </div>
          <div className="w-32 space-y-1">
            <label className="text-xs text-muted-foreground">Order Volume</label>
            <Input type="number" placeholder="0" value={newMerchantVolume} onChange={(e) => setNewMerchantVolume(e.target.value)} className="h-8 text-xs"
              onKeyDown={(e) => { if (e.key === "Enter") addExtraMerchant(); }} />
          </div>
          <Button size="sm" onClick={addExtraMerchant} className="h-8 px-3 text-xs" disabled={!newMerchantName.trim() || !newMerchantVolume || parseInt(newMerchantVolume) <= 0}>
            <Plus size={12} className="mr-1" /> Add
          </Button>
        </div>
        {extraMerchants.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {extraMerchants.map((m) => (
              <span key={m.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-secondary border border-border">
                {m.name}: {m.orderVolume.toLocaleString()}
                <button onClick={() => removeExtraMerchant(m.id)} className="text-muted-foreground hover:text-destructive transition-colors">
                  <X size={12} />
                </button>
              </span>
            ))}
            <span className="text-xs text-muted-foreground self-center">Total: {extraMerchants.reduce((s, m) => s + m.orderVolume, 0).toLocaleString()}</span>
          </div>
        )}
      </div>

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
    </div>
  );
}
