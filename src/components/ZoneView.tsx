import { useMemo, useState, useCallback, useEffect } from "react";
import { useTimeLeft } from "@/hooks/useTimeLeft";
import { RotateCcw, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Package, Clock, Timer, Users, UserPlus, TrendingUp, ArrowUpDown, ArrowUp, ArrowDown, Search, PackageMinus, ArrowDownToLine, UserCheck } from "lucide-react";
import { StatCard } from "@/components/SummaryStats";
import { Input } from "@/components/ui/input";
import { zoneAGroups, zoneBGroups } from "@/data/zoneMappings";
import { useZoneOverrides } from "@/hooks/useZoneOverrides";
import { cloudGet as idbGet, cloudSet as idbSet } from "@/lib/cloudStorage";

const MULTIPLIER = 1.125;

// HC grouping for Zone A: merchants in the same group share a single combined HC value
const zoneAHCGroups: string[][] = [
  ["Horl", "ela mo", "MagicHolz", "Hydraid"],
  ["Dr. Emi", "SHYNE"],
  ["Multi Small", "Multi Big", "SIOP"],
  ["HAFERLÖWE", "Matchday Nutrition"],
];

const zoneSerialOrder: Record<string, string[]> = {
  A: [
    "Horl", "ela mo", "MagicHolz", "Hydraid", "Beyond Drinks",
    "Dr. Emi", "SHYNE", "Dr. Massing", "Yummyeats -Smarter Choices GmbH",
    "Multi Small", "Multi Big", "SIOP", "HAFERLÖWE",
    "Matchday Nutrition", "Inkster", "Lotuscrafts GmbH",
  ],
  B: [
    "AVA & MAY", "thebettercat", "Multi", "Multi Critical", "Multi Sizzlepak",
  ],
};



interface FlowRow {
  merchant_name: string;
  order_volume: number;
  waiting_for_picking: number;
  picking_hours: number;
  packing_hours: number;
  ideal_sph: number;
}

interface ZoneRow {
  name: string;
  order_volume: number;
  waiting_for_picking: number;
  planned_backlog: number;
  picking_hours: number;
  packing_hours: number;
  headcount: number;
  isGroup?: boolean;
}

interface ZoneViewProps {
  zone: "A" | "B";
  flowData: FlowRow[];
  timeLeft: number;
  backlog?: Record<string, number>;
  pickingRates?: Record<string, number>;
  packingRates?: Record<string, number>;
  onBacklogChange?: (backlog: Record<string, number>) => void;
  onResetZoneBacklog?: (zone: "A" | "B") => void;
  availableHeadcount?: number;
  onAvailableHeadcountChange?: (val: number) => void;
  nonProdHC: number;
  onNonProdHCChange: (val: number) => void;
}

type SortKey = "serial" | "name" | "order_volume" | "waiting_for_picking" | "planned_backlog" | "picking_hours" | "packing_hours" | "headcount";

export function ZoneView({ zone, flowData, backlog = {}, pickingRates = {}, packingRates = {}, onBacklogChange, onResetZoneBacklog, availableHeadcount = 0, onAvailableHeadcountChange, nonProdHC, onNonProdHCChange }: ZoneViewProps) {
  const { lookup: zoneLookup } = useZoneOverrides();
  const handleNonProdChange = (val: number) => {
    onNonProdHCChange(val);
  };
  const [sortKey, setSortKey] = useState<SortKey>("serial");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [search, setSearch] = useState("");
  const [editingMerchant, setEditingMerchant] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const BACKLOG_KEY = "plannedBacklog";

  const saveBacklog = useCallback((updated: Record<string, number>) => {
    idbSet(BACKLOG_KEY, updated);
    onBacklogChange?.(updated);
  }, [onBacklogChange]);

  const handleStartEdit = (merchant: string) => {
    setEditingMerchant(merchant);
    setEditValue(String(backlog[merchant] || 0));
  };

  const handleSaveEdit = () => {
    if (!editingMerchant) return;
    const val = parseInt(editValue, 10);
    const updated = { ...backlog, [editingMerchant]: isNaN(val) || val < 0 ? 0 : val };
    saveBacklog(updated);
    setEditingMerchant(null);
  };

  const timeLeft = useTimeLeft();

  // Build groups dynamically from the live zone lookup so that user overrides
  // (re-assigning a merchant to a different zone/group) are reflected here.
  const groups = useMemo(() => {
    const baseGroups = zone === "A" ? zoneAGroups : zoneBGroups;
    const result: Record<string, string[]> = {};
    // seed with all known group names for this zone so empty groups still render
    for (const g of Object.keys(baseGroups)) result[g] = [];
    for (const [merchant, assignment] of Object.entries(zoneLookup)) {
      if (assignment.zone === zone && assignment.group) {
        if (!result[assignment.group]) result[assignment.group] = [];
        result[assignment.group].push(merchant);
      }
    }
    return result;
  }, [zone, zoneLookup]);

  // Collect zone merchants' backlog by resolving group members
  const getBacklogForMerchant = (merchantName: string) => backlog[merchantName] || 0;

  const zoneRows = useMemo(() => {
    const rows: ZoneRow[] = [];

    // Named merchants (not in any group)
    for (const row of flowData) {
      const assignment = zoneLookup[row.merchant_name];
      if (assignment && assignment.zone === zone && !assignment.group) {
        const bl = getBacklogForMerchant(row.merchant_name);
        const effectiveVol = Math.max(0, row.order_volume - bl);
        const effectiveWaiting = Math.max(0, row.waiting_for_picking - bl);
        const key = row.merchant_name.toLowerCase();
        const pickRate = pickingRates[key];
        const packRate = packingRates[key];
        const hasRates = pickRate && packRate && pickRate > 0 && packRate > 0;
        let pickHrs: number;
        let packHrs: number;
        if (hasRates) {
          pickHrs = effectiveWaiting / (pickRate * MULTIPLIER);
          packHrs = effectiveVol / (packRate * MULTIPLIER);
        } else {
          // Unbenchmarked: use the precomputed hours from flow data
          // (derived in useMetabaseData via weighted-avg ideal SPH).
          // Scale proportionally if a planned backlog applies.
          const volRatio = row.order_volume > 0 ? effectiveVol / row.order_volume : 0;
          pickHrs = row.picking_hours * volRatio;
          packHrs = row.packing_hours * volRatio;
        }
        const hc = timeLeft > 0 ? (pickHrs + packHrs) / timeLeft : 0;
        rows.push({
          name: row.merchant_name,
          order_volume: row.order_volume,
          waiting_for_picking: row.waiting_for_picking,
          planned_backlog: bl,
          picking_hours: pickHrs,
          packing_hours: packHrs,
          headcount: Math.round(hc * 100) / 100,
        });
      }
    }

    // Grouped merchants
    for (const [groupName, members] of Object.entries(groups)) {
      let totalOrders = 0, totalWaiting = 0, totalBacklog = 0, totalPick = 0, totalPack = 0;
      for (const row of flowData) {
        if (members.includes(row.merchant_name)) {
          const bl = getBacklogForMerchant(row.merchant_name);
          const key = row.merchant_name.toLowerCase();
          const pickRate = pickingRates[key];
          const packRate = packingRates[key];
          const effectiveVol = Math.max(0, row.order_volume - bl);
          const effectiveWaiting = Math.max(0, row.waiting_for_picking - bl);
          totalOrders += row.order_volume;
          totalWaiting += row.waiting_for_picking;
          totalBacklog += bl;
          if (pickRate && packRate && pickRate > 0 && packRate > 0) {
            totalPick += effectiveWaiting / (pickRate * MULTIPLIER);
            totalPack += effectiveVol / (packRate * MULTIPLIER);
          } else {
            // Unbenchmarked: use precomputed hours (weighted-avg ideal SPH)
            const volRatio = row.order_volume > 0 ? effectiveVol / row.order_volume : 0;
            totalPick += row.picking_hours * volRatio;
            totalPack += row.packing_hours * volRatio;
          }
        }
      }
      const hc = timeLeft > 0 ? (totalPick + totalPack) / timeLeft : 0;
      rows.push({
        name: groupName,
        order_volume: totalOrders,
        waiting_for_picking: totalWaiting,
        planned_backlog: totalBacklog,
        picking_hours: Math.round(totalPick * 100) / 100,
        packing_hours: Math.round(totalPack * 100) / 100,
        headcount: Math.round(hc * 100) / 100,
        isGroup: true,
      });
    }

    return rows;
  }, [flowData, zone, groups, timeLeft, backlog, pickingRates, packingRates]);

  const merchantCount = useMemo(() => {
    return flowData.filter(row => {
      const assignment = zoneLookup[row.merchant_name];
      return assignment && assignment.zone === zone;
    }).length;
  }, [flowData, zone]);

  const totals = useMemo(() => {
    const totalOrders = zoneRows.reduce((s, r) => s + r.order_volume, 0);
    const totalBacklog = zoneRows.reduce((s, r) => s + r.planned_backlog, 0);
    const effectiveOrders = Math.max(0, totalOrders - totalBacklog);
    const totalPick = zoneRows.reduce((s, r) => s + r.picking_hours, 0);
    const totalPack = zoneRows.reduce((s, r) => s + r.packing_hours, 0);
    const totalHC = zoneRows.reduce((s, r) => s + r.headcount, 0);
    const pickHC = timeLeft > 0 ? Math.ceil(totalPick / timeLeft) : 0;
    const packHC = timeLeft > 0 ? Math.ceil(totalPack / timeLeft) : 0;
    const denom = totalPick + totalPack + (nonProdHC * timeLeft);
    const predictedSPH = denom > 0 ? effectiveOrders / denom : 0;
    return { totalOrders, totalBacklog, effectiveOrders, totalPick, totalPack, totalHC, pickHC, packHC, predictedSPH };
  }, [zoneRows, nonProdHC, timeLeft]);

  const hcGap = availableHeadcount > 0 ? availableHeadcount - (totals.pickHC + totals.packHC) : null;

  const suggestions = useMemo(() => {
    if (!availableHeadcount || availableHeadcount <= 0 || timeLeft <= 0) return null;

    const availableCapacity = availableHeadcount * timeLeft;
    const totalRequired = totals.totalPick + totals.totalPack;

    if (totalRequired <= availableCapacity) return null;

    // Get all individual merchants in this zone
    const zoneMerchants = flowData.filter(row => {
      const assignment = zoneLookup[row.merchant_name];
      return assignment && assignment.zone === zone;
    });

    const merchantData = zoneMerchants.map(row => {
      const bl = backlog[row.merchant_name] || 0;
      const effectiveVol = Math.max(0, row.order_volume - bl);
      const effectiveWaiting = Math.max(0, row.waiting_for_picking - bl);
      const key = row.merchant_name.toLowerCase();
      const pickRate = pickingRates[key] || 30;
      const packRate = packingRates[key] || 20;
      const pickHrs = effectiveWaiting / (pickRate * MULTIPLIER);
      const packHrs = effectiveVol / (packRate * MULTIPLIER);
      const totalHrs = pickHrs + packHrs;
      const idealSph = totalHrs > 0 ? effectiveVol / totalHrs : 0;
      return {
        merchant_name: row.merchant_name,
        order_volume: row.order_volume,
        picking_hours: pickHrs,
        packing_hours: packHrs,
        ideal_sph: idealSph,
      };
    });

    // Score each merchant by (hours / SPH): high hours = fewer merchants needed,
    // low SPH = inefficient merchant = better candidate to defer.
    // Sorting by this score descending minimises the number of merchants suggested
    // while still preferring the least-efficient ones when impact is equal.
    const sorted = [...merchantData]
      .filter(r => r.order_volume > (backlog[r.merchant_name] || 0))
      .sort((a, b) => {
        const aHrs = a.picking_hours + a.packing_hours;
        const bHrs = b.picking_hours + b.packing_hours;
        const aScore = a.ideal_sph > 0 ? aHrs / a.ideal_sph : aHrs;
        const bScore = b.ideal_sph > 0 ? bHrs / b.ideal_sph : bHrs;
        return bScore - aScore;
      });

    const suggested: { merchant_name: string; suggestedBacklog: number; orders: number; hoursSaved: number }[] = [];
    let toFree = totalRequired - availableCapacity;

    for (const row of sorted) {
      if (toFree <= 0) break;
      const currentBacklog = backlog[row.merchant_name] || 0;
      const remainingOrders = row.order_volume - currentBacklog;
      const rowHours = row.picking_hours + row.packing_hours;
      if (rowHours <= 0) continue;

      if (rowHours <= toFree) {
        suggested.push({ merchant_name: row.merchant_name, suggestedBacklog: row.order_volume, orders: remainingOrders, hoursSaved: rowHours });
        toFree -= rowHours;
      } else {
        const hoursPerOrder = rowHours / remainingOrders;
        const ordersToDefer = Math.ceil(toFree / hoursPerOrder);
        const actualDefer = Math.min(ordersToDefer, remainingOrders);
        suggested.push({ merchant_name: row.merchant_name, suggestedBacklog: currentBacklog + actualDefer, orders: actualDefer, hoursSaved: actualDefer * hoursPerOrder });
        toFree = 0;
      }
    }

    return suggested.length > 0 ? suggested : null;
  }, [flowData, zone, availableHeadcount, timeLeft, totals.totalPick, totals.totalPack, backlog, pickingRates, packingRates]);

  const applySuggestions = useCallback(() => {
    if (!suggestions) return;
    const updated = { ...backlog };
    for (const s of suggestions) {
      updated[s.merchant_name] = s.suggestedBacklog;
    }
    saveBacklog(updated);
  }, [suggestions, backlog, saveBacklog]);

  const filtered = useMemo(() => {
    const order = zoneSerialOrder[zone] || [];
    let result = zoneRows;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((r) => r.name.toLowerCase().includes(q));
    }
    if (sortKey === "serial") {
      return [...result].sort((a, b) => {
        const ai = order.indexOf(a.name);
        const bi = order.indexOf(b.name);
        const aIdx = ai === -1 ? 999 : ai;
        const bIdx = bi === -1 ? 999 : bi;
        return sortDir === "asc" ? aIdx - bIdx : bIdx - aIdx;
      });
    }
    return [...result].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [zoneRows, sortKey, sortDir, search, zone]);

  const serialMap = useMemo(() => {
    const order = zoneSerialOrder[zone] || [];
    const map: Record<string, number> = {};
    order.forEach((name, i) => { map[name] = i + 1; });
    return map;
  }, [zone]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowUpDown size={12} className="text-muted-foreground/50" />;
    return sortDir === "asc" ? <ArrowUp size={12} className="text-primary" /> : <ArrowDown size={12} className="text-primary" />;
  };

  const columns: { key: SortKey; label: string; align?: string }[] = [
    { key: "name", label: "Merchant" },
    { key: "order_volume", label: "Orders", align: "right" },
    { key: "planned_backlog", label: "Backlog", align: "right" },
    { key: "waiting_for_picking", label: "Waiting", align: "right" },
    { key: "picking_hours", label: "Pick Hrs", align: "right" },
    { key: "packing_hours", label: "Pack Hrs", align: "right" },
    { key: "headcount", label: "HC", align: "right" },
  ];

  return (
    <div className="space-y-4">
      {/* Zone summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard
          label="Total Orders"
          value={totals.totalOrders.toLocaleString()}
          icon={<Package size={16} />}
          subtext={`${merchantCount} merchants`}
        />
        <StatCard
          label="Effective Orders"
          value={totals.effectiveOrders.toLocaleString()}
          icon={<PackageMinus size={16} />}
          subtext={`After ${totals.totalBacklog} backlog`}
          variant="success"
        />
        <StatCard
          label="Picking Hours"
          value={totals.totalPick.toFixed(1)}
          icon={<Clock size={16} />}
          subtext={`HC needed: ${totals.pickHC}`}
          variant="warning"
        />
        <StatCard
          label="Packing Hours"
          value={totals.totalPack.toFixed(1)}
          icon={<Clock size={16} />}
          subtext={`HC needed: ${totals.packHC}`}
          variant="warning"
        />
        <div className="rounded-md border bg-card p-4 h-full border-primary/30">
          <div className="flex items-center justify-between mb-2">
            <span className="stat-label">OB Headcount</span>
            <span className="text-primary"><UserCheck size={16} /></span>
          </div>
          <div className="stat-value text-foreground">{nonProdHC + availableHeadcount}</div>
          <p className="text-xs text-muted-foreground mt-1">
            <span className="font-semibold text-foreground">{nonProdHC}</span> non-prod + <span className="font-semibold text-foreground">{availableHeadcount}</span> available
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard
          label="Time Left"
          value={`${timeLeft.toFixed(1)}h`}
          icon={<Timer size={16} />}
        />
        <div className="relative h-full">
          <StatCard
            label="Planned Backlog"
            value={totals.totalBacklog.toLocaleString()}
            icon={<ArrowDownToLine size={16} />}
            subtext="Orders deferred"
          />
          {totals.totalBacklog > 0 && onResetZoneBacklog && (
            <Button
              variant="ghost"
              size="sm"
              className="absolute top-8 right-2 h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
              onClick={() => onResetZoneBacklog(zone)}
              title="Reset zone planned backlog to 0"
            >
              <RotateCcw size={12} className="mr-1" /> Reset
            </Button>
          )}
        </div>
        <StatCard
          label="Predicted SPH"
          value={totals.predictedSPH.toFixed(1)}
          icon={<TrendingUp size={16} />}
          variant="success"
        />
        <div className="rounded-md border bg-card p-4 h-full border-primary/30">
          <div className="flex items-center justify-between mb-2">
            <span className="stat-label">Non-Prod HC</span>
            <span className="text-primary"><UserPlus size={16} /></span>
          </div>
          <Input
            type="number"
            min={0}
            value={nonProdHC}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              handleNonProdChange(isNaN(v) || v < 0 ? 0 : v);
            }}
            className="h-8 text-lg font-bold w-20 bg-secondary border-border"
          />
        </div>
        <div className={`rounded-md border bg-card p-4 h-full ${hcGap === null ? "border-border" : hcGap >= 0 ? "border-success/30" : "border-destructive/30"}`}>
          <div className="flex items-center justify-between mb-2">
            <span className="stat-label">Available HC</span>
            <span className={hcGap === null ? "text-muted-foreground" : hcGap >= 0 ? "text-success" : "text-destructive"}>
              <Users size={16} />
            </span>
          </div>
          <Input
            type="number"
            min={0}
            value={availableHeadcount || ""}
            placeholder="0"
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              onAvailableHeadcountChange?.(isNaN(v) || v < 0 ? 0 : v);
            }}
            className="h-8 text-lg font-bold w-20 bg-secondary border-border"
          />
          <p className="text-xs text-muted-foreground mt-1">
            {hcGap === null || availableHeadcount === 0
              ? `${totals.pickHC + totals.packHC} HC needed`
              : hcGap >= 0
              ? <span className="text-success font-medium">+{hcGap} surplus vs {totals.pickHC + totals.packHC} needed</span>
              : <span className="text-destructive font-medium">{Math.abs(hcGap)} short of {totals.pickHC + totals.packHC} needed</span>
            }
          </p>
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

      {/* Zone table */}
      <div className="rounded-md border bg-card">
        <div className="p-3 border-b flex items-center gap-2">
          <Search size={14} className="text-muted-foreground" />
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none flex-1"
          />
          <span className="text-xs text-muted-foreground">{filtered.length} rows</span>
        </div>
        <div className="overflow-auto max-h-[500px]">
          <table className="w-full">
            <thead className="sticky top-0 bg-card z-10">
              <tr className="border-b">
                <th className="table-header px-3 py-2 text-center w-12 cursor-pointer hover:text-foreground transition-colors" onClick={() => toggleSort("serial")}>
                  <span className="inline-flex items-center gap-1">S.No <SortIcon col={"serial" as SortKey} /></span>
                </th>
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
              {(() => {
                // Build HC group info for Zone A
                const hcGroupMap: Record<string, { groupHC: number; size: number; index: number }> = {};
                if (zone === "A") {
                  for (const group of zoneAHCGroups) {
                    const membersInFiltered = filtered.filter(r => group.includes(r.name));
                    const groupHC = membersInFiltered.reduce((s, r) => s + r.headcount, 0);
                    membersInFiltered.forEach((r, i) => {
                      hcGroupMap[r.name] = { groupHC, size: membersInFiltered.length, index: i };
                    });
                  }
                }
                return filtered.map((row) => {
                  const hcInfo = hcGroupMap[row.name];
                  const showHC = !hcInfo || hcInfo.index === 0;
                  const hcRowSpan = hcInfo && hcInfo.index === 0 ? hcInfo.size : 1;
                  const hcValue = hcInfo ? hcInfo.groupHC : row.headcount;
                  return (
                    <tr key={row.name} className="border-b border-border/50 hover:bg-secondary/50 transition-colors">
                      <td className="px-3 py-2 text-sm text-center text-muted-foreground">{serialMap[row.name] ?? ""}</td>
                      <td className="px-3 py-2 text-sm font-medium truncate max-w-[200px]">
                        {row.isGroup && <span className="text-xs text-primary mr-1">●</span>}
                        {row.name}
                      </td>
                      <td className="table-cell px-3 py-2 text-right">{row.order_volume}</td>
                      <td className="table-cell px-3 py-2 text-right">
                        {row.isGroup ? (
                          row.planned_backlog
                        ) : editingMerchant === row.name ? (
                          <input
                            type="number"
                            min={0}
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={handleSaveEdit}
                            onKeyDown={(e) => { if (e.key === "Enter") handleSaveEdit(); if (e.key === "Escape") setEditingMerchant(null); }}
                            className="w-16 h-6 text-xs text-right bg-secondary border border-border rounded px-1"
                            autoFocus
                          />
                        ) : (
                          <span
                            className="cursor-pointer hover:text-primary transition-colors border-b border-dashed border-muted-foreground/30"
                            onClick={() => handleStartEdit(row.name)}
                          >
                            {row.planned_backlog}
                          </span>
                        )}
                      </td>
                      <td className="table-cell px-3 py-2 text-right">{row.waiting_for_picking}</td>
                      <td className="table-cell px-3 py-2 text-right">{row.picking_hours.toFixed(2)}</td>
                      <td className="table-cell px-3 py-2 text-right">{row.packing_hours.toFixed(2)}</td>
                      {showHC && (
                        <td className={`table-cell px-3 py-2 text-right font-semibold ${hcInfo ? "bg-secondary/30 border-l border-border/50" : ""}`} rowSpan={hcRowSpan}>
                          {hcValue.toFixed(2)}
                        </td>
                      )}
                    </tr>
                  );
                });
              })()}
              {/* Total row */}
              <tr className="border-t-2 border-primary/30 bg-secondary/30 font-bold">
                <td className="px-3 py-2 text-sm text-center"></td>
                <td className="px-3 py-2 text-sm">Total</td>
                <td className="table-cell px-3 py-2 text-right">{totals.totalOrders}</td>
                <td className="table-cell px-3 py-2 text-right">{totals.totalBacklog}</td>
                <td className="table-cell px-3 py-2 text-right">{zoneRows.reduce((s, r) => s + r.waiting_for_picking, 0)}</td>
                <td className="table-cell px-3 py-2 text-right">{totals.totalPick.toFixed(2)}</td>
                <td className="table-cell px-3 py-2 text-right">{totals.totalPack.toFixed(2)}</td>
                <td className="table-cell px-3 py-2 text-right">{totals.totalHC.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
