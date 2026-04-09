import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { ArrowUpDown, ArrowUp, ArrowDown, Search, Plus, X, TrendingUp, Upload, Wand2 } from "lucide-react";
import { cloudGet as idbGet, cloudSet as idbSet } from "@/lib/cloudStorage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getInflowFactor, parseOvernightVolumes } from "@/lib/inflowEstimation";
import { useTimeLeft } from "@/hooks/useTimeLeft";
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
  onInflowCsvParsed?: (overnightVolumes: Record<string, number>) => void;
  availableHeadcount?: number;
}

type SortKey = "merchant_name" | "order_volume" | "planned_backlog" | "waiting_for_picking" | "picking_hours" | "packing_hours" | "ideal_sph";

export function FlowManagementTable({ data, pickingRates = {}, packingRates = {}, onBacklogChange, externalBacklog, extraMerchants = [], onExtraMerchantsChange, inflowEnabled = false, onInflowToggle, onInflowCsvParsed, availableHeadcount = 0 }: FlowManagementTableProps) {
  const timeLeft = useTimeLeft();
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

      const key = row.merchant_name.toLowerCase();
      const pickRate = pickingRates[key];
      const packRate = packingRates[key];

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

  // Backlog suggestions when available HC is set and insufficient
  const suggestions = useMemo(() => {
    if (!availableHeadcount || availableHeadcount <= 0 || timeLeft <= 0) return null;

    const availableCapacity = availableHeadcount * timeLeft;
    const totalRequired = adjustedData.reduce((s, r) => s + r.picking_hours + r.packing_hours, 0);

    if (totalRequired <= availableCapacity) return null; // Enough HC, no suggestions needed

    // Sort by ideal_sph ascending: defer low-SPH merchants first (maximises SPH of remaining work,
    // and low-SPH merchants tend to have fewer orders so minimal merchant impact)
    const sorted = [...adjustedData]
      .filter((r) => r.order_volume > (backlog[r.merchant_name] || 0)) // only merchants with undeferred orders
      .sort((a, b) => a.ideal_sph - b.ideal_sph);

    const suggested: { merchant_name: string; suggestedBacklog: number; orders: number; hoursSaved: number }[] = [];
    let toFree = totalRequired - availableCapacity;

    for (const row of sorted) {
      if (toFree <= 0) break;
      const currentBacklog = backlog[row.merchant_name] || 0;
      const remainingOrders = row.order_volume - currentBacklog;
      const rowHours = row.picking_hours + row.packing_hours;

      if (rowHours <= 0) continue;

      if (rowHours <= toFree) {
        // Defer entire remaining workload for this merchant
        suggested.push({
          merchant_name: row.merchant_name,
          suggestedBacklog: row.order_volume, // full backlog
          orders: remainingOrders,
          hoursSaved: rowHours,
        });
        toFree -= rowHours;
      } else {
        // Partial deferral: defer just enough orders to free the required hours
        // hours per order = rowHours / remainingOrders
        const hoursPerOrder = rowHours / remainingOrders;
        const ordersToDefer = Math.ceil(toFree / hoursPerOrder);
        const actualDefer = Math.min(ordersToDefer, remainingOrders);
        suggested.push({
          merchant_name: row.merchant_name,
          suggestedBacklog: currentBacklog + actualDefer,
          orders: actualDefer,
          hoursSaved: actualDefer * hoursPerOrder,
        });
        toFree = 0;
      }
    }

    return suggested;
  }, [adjustedData, availableHeadcount, timeLeft, backlog]);

  const applySuggestions = useCallback(() => {
    if (!suggestions) return;
    const updated = { ...backlog };
    for (const s of suggestions) {
      updated[s.merchant_name] = s.suggestedBacklog;
    }
    saveBacklog(updated);
  }, [suggestions, backlog, saveBacklog]);

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

        {/* Estimate Inflow via CSV Upload */}
        <div className="flex items-center gap-3 pt-2 border-t border-border/50">
          {(() => {
            const { factor, label } = getInflowFactor();
            const fileInputRef = useRef<HTMLInputElement>(null);
            const handleInflowCsv = (e: React.ChangeEvent<HTMLInputElement>) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = (ev) => {
                const text = ev.target?.result as string;
                if (!text) return;
                const overnight = parseOvernightVolumes(text);
                onInflowCsvParsed?.(overnight);
                onInflowToggle?.(true);
              };
              reader.readAsText(file);
              e.target.value = "";
            };
            return (
              <>
                <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleInflowCsv} />
                {inflowEnabled ? (
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => { onInflowToggle?.(false); onInflowCsvParsed?.({}); }}
                    className="h-8 px-3 text-xs gap-1.5"
                  >
                    <TrendingUp size={12} />
                    Inflow Estimation On
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    className="h-8 px-3 text-xs gap-1.5"
                  >
                    <Upload size={12} />
                    Estimate Inflow (Upload CSV)
                  </Button>
                )}
                <span className="text-xs text-muted-foreground">
                  {label} {inflowEnabled && factor > 0 && `· +${Math.round(factor * 100)}% applied to overnight orders`}
                  {inflowEnabled && factor === 0 && "· No additional inflow at this time"}
                </span>
              </>
            );
          })()}
        </div>
      </div>

      {/* Headcount Optimizer */}
      {availableHeadcount > 0 && suggestions && suggestions.length > 0 && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wand2 size={14} className="text-destructive" />
              <h3 className="text-sm font-semibold text-destructive">Headcount Optimizer</h3>
              <span className="text-xs text-muted-foreground">— Available HC insufficient. Suggested backlogs to fit within {availableHeadcount} HC:</span>
            </div>
            <Button size="sm" variant="destructive" onClick={applySuggestions} className="h-7 px-3 text-xs gap-1.5">
              <Wand2 size={11} /> Apply Suggestions
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <div key={s.merchant_name} className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs bg-card border border-destructive/20">
                <span className="font-medium truncate max-w-[120px]">{s.merchant_name}</span>
                <span className="text-muted-foreground">→ backlog</span>
                <span className="font-semibold text-destructive">{s.orders.toLocaleString()} orders</span>
                <span className="text-muted-foreground">({s.hoursSaved.toFixed(1)}h saved)</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {availableHeadcount > 0 && !suggestions && (
        <div className="rounded-lg border border-success/30 bg-success/5 px-4 py-2 flex items-center gap-2 text-xs text-success">
          <Wand2 size={13} /> Available HC ({availableHeadcount}) is sufficient for all current work.
        </div>
      )}

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
