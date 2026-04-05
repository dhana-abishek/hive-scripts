import { useMemo, useState, useCallback, useEffect } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Package, Clock, Timer, Users, UserPlus, TrendingUp, ArrowUpDown, ArrowUp, ArrowDown, Search, PackageMinus, ArrowDownToLine } from "lucide-react";
import { StatCard } from "@/components/SummaryStats";
import { Input } from "@/components/ui/input";
import { buildZoneLookup, zoneAGroups, zoneBGroups } from "@/data/zoneMappings";
import { idbGet, idbSet } from "@/lib/idbStorage";

const MULTIPLIER = 1.125;

// HC grouping for Zone A: merchants in the same group share a single combined HC value
const zoneAHCGroups: string[][] = [
  ["Horl", "ela mo", "MagicHolz", "Hydraid"],
  ["Dr. Emi", "Shyne"],
  ["Multi Small", "Multi Big", "SIOP"],
  ["HAFERLÖWE", "Matchday Nutrition"],
];

const zoneSerialOrder: Record<string, string[]> = {
  A: [
    "Horl", "ela mo", "MagicHolz", "Hydraid", "Beyond Drinks",
    "Dr. Emi", "Shyne", "Dr. Massing", "Yummyeats -Smarter Choices GmbH",
    "Multi Small", "Multi Big", "SIOP", "HAFERLÖWE",
    "Matchday Nutrition", "Inkster", "Lotuscrafts GmbH",
  ],
  B: [
    "AVA & MAY", "thebettercat", "Multi", "Multi Critical", "Multi Sizzlepak",
  ],
};

const zoneLookup = buildZoneLookup();

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
}

function calcTimeLeft(): number {
  const now = new Date();
  const day = now.getDay();
  const h = now.getHours(), m = now.getMinutes(), s = now.getSeconds();
  const nowFrac = (h * 3600 + m * 60 + s) / 86400;
  const t = (hh: number, mm: number, ss: number) => (hh * 3600 + mm * 60 + ss) / 86400;
  const start = t(8, 10, 0), lunchStart = t(12, 0, 0), lunchEnd = t(12, 30, 0), lunchDur = t(0, 30, 0);
  if (day === 0) return 8;
  if (nowFrac < start) return 8;
  const endTime = day === 6 ? t(15, 0, 0) : t(16, 40, 0);
  if (nowFrac >= endTime) return 8;
  const totalShift = (endTime - start - lunchDur) * 24;
  let elapsed: number;
  if (nowFrac < lunchStart) elapsed = (nowFrac - start) * 24;
  else if (nowFrac < lunchEnd) elapsed = (lunchStart - start) * 24;
  else elapsed = (lunchStart - start) * 24 + (nowFrac - lunchEnd) * 24;
  return Math.max(0, totalShift - elapsed);
}

type SortKey = "serial" | "name" | "order_volume" | "waiting_for_picking" | "planned_backlog" | "picking_hours" | "packing_hours" | "headcount";

export function ZoneView({ zone, flowData, backlog = {}, pickingRates = {}, packingRates = {}, onBacklogChange, onResetZoneBacklog }: ZoneViewProps) {
  const [nonProdHC, setNonProdHC] = useState(6);
  useEffect(() => {
    idbGet<number>(`nonProdHC_zone${zone}`).then((v) => { if (v !== null) setNonProdHC(v); });
  }, [zone]);

  const handleNonProdChange = (val: number) => {
    setNonProdHC(val);
    idbSet(`nonProdHC_zone${zone}`, val);
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

  const timeLeft = calcTimeLeft();
  const groups = zone === "A" ? zoneAGroups : zoneBGroups;

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
        const pickRate = pickingRates[row.merchant_name] || 30;
        const packRate = packingRates[row.merchant_name] || 20;
        const pickHrs = effectiveWaiting / (pickRate * MULTIPLIER);
        const packHrs = effectiveVol / (packRate * MULTIPLIER);
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
          const pickRate = pickingRates[row.merchant_name] || 30;
          const packRate = packingRates[row.merchant_name] || 20;
          const effectiveVol = Math.max(0, row.order_volume - bl);
          const effectiveWaiting = Math.max(0, row.waiting_for_picking - bl);
          totalOrders += row.order_volume;
          totalWaiting += row.waiting_for_picking;
          totalBacklog += bl;
          totalPick += effectiveWaiting / (pickRate * MULTIPLIER);
          totalPack += effectiveVol / (packRate * MULTIPLIER);
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Total Orders"
          value={totals.totalOrders.toLocaleString()}
          icon={<Package size={16} />}
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
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
      </div>

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
                <td className="table-cell px-3 py-2 text-right">{zoneRows.reduce((s, r) => s + r.waiting_for_picking, 0)}</td>
                <td className="table-cell px-3 py-2 text-right">{totals.totalBacklog}</td>
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
