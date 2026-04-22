import { useState, useMemo, useEffect } from "react";
import { useTimeLeft } from "@/hooks/useTimeLeft";
import { ArrowUpDown, ArrowUp, ArrowDown, Search, Package, Clock, Timer, UserPlus, PackageMinus, ArrowDownToLine, TrendingUp, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatCard } from "@/components/SummaryStats";
import { zoneAGroups, zoneBGroups } from "@/data/zoneMappings";
import { useZoneOverrides } from "@/hooks/useZoneOverrides";
import { cloudGet as idbGet, cloudSet as idbSet } from "@/lib/cloudStorage";

const MULTIPLIER = 1.125;

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

interface AgingZoneRow {
  name: string;
  order_volume: number;
  planned_backlog: number;
  picking_hours: number;
  packing_hours: number;
  headcount: number;
  isGroup?: boolean;
}

type ZoneSortKey = "serial" | "name" | "order_volume" | "planned_backlog" | "picking_hours" | "packing_hours" | "headcount";

interface AgingZoneViewProps {
  zone: "A" | "B";
  merchantOrders: Record<string, number>;
  backlog: Record<string, number>;
  pickingRates: Record<string, number>;
  packingRates: Record<string, number>;
  onBacklogChange: (merchant: string, val: number) => void;
  onResetZoneBacklog: () => void;
}

export function AgingZoneView({
  zone,
  merchantOrders,
  backlog,
  pickingRates,
  packingRates,
  onBacklogChange,
  onResetZoneBacklog,
}: AgingZoneViewProps) {
  const TIME_LEFT = useTimeLeft();
  const [nonProdHC, setNonProdHC] = useState(6);
  useEffect(() => {
    idbGet<number>(`agingNonProdHC_zone${zone}`).then((v) => { if (v !== null) setNonProdHC(v); });
  }, [zone]);
  const handleNonProdChange = (val: number) => {
    setNonProdHC(val);
    idbSet(`agingNonProdHC_zone${zone}`, val);
  };

  const [sortKey, setSortKey] = useState<ZoneSortKey>("serial");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [search, setSearch] = useState("");
  const [editingMerchant, setEditingMerchant] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const groups = zone === "A" ? zoneAGroups : zoneBGroups;

  const zoneRows = useMemo(() => {
    const rows: AgingZoneRow[] = [];

    for (const [merchant, orders] of Object.entries(merchantOrders)) {
      const assignment = zoneLookup[merchant];
      if (assignment && assignment.zone === zone && !assignment.group) {
        const bl = backlog[merchant] || 0;
        const effVol = Math.max(0, orders - bl);
        const key = merchant.toLowerCase();
        const pickRate = pickingRates[key] || 30;
        const packRate = packingRates[key] || 20;
        const pickHrs = effVol / (pickRate * MULTIPLIER);
        const packHrs = effVol / (packRate * MULTIPLIER);
        const hc = TIME_LEFT > 0 ? (pickHrs + packHrs) / TIME_LEFT : 0;
        rows.push({
          name: merchant,
          order_volume: orders,
          planned_backlog: bl,
          picking_hours: Math.round(pickHrs * 100) / 100,
          packing_hours: Math.round(packHrs * 100) / 100,
          headcount: Math.round(hc * 100) / 100,
        });
      }
    }

    for (const [groupName, members] of Object.entries(groups)) {
      let totalOrders = 0, totalBacklog = 0, totalPick = 0, totalPack = 0;
      for (const m of members) {
        const orders = merchantOrders[m] || 0;
        if (orders === 0) continue;
        const bl = backlog[m] || 0;
        const effVol = Math.max(0, orders - bl);
        const mKey = m.toLowerCase();
        const pickRate = pickingRates[mKey] || 30;
        const packRate = packingRates[mKey] || 20;
        totalOrders += orders;
        totalBacklog += bl;
        totalPick += effVol / (pickRate * MULTIPLIER);
        totalPack += effVol / (packRate * MULTIPLIER);
      }
      if (totalOrders > 0) {
        const hc = TIME_LEFT > 0 ? (totalPick + totalPack) / TIME_LEFT : 0;
        rows.push({
          name: groupName,
          order_volume: totalOrders,
          planned_backlog: totalBacklog,
          picking_hours: Math.round(totalPick * 100) / 100,
          packing_hours: Math.round(totalPack * 100) / 100,
          headcount: Math.round(hc * 100) / 100,
          isGroup: true,
        });
      }
    }

    return rows;
  }, [merchantOrders, zone, groups, backlog, pickingRates, packingRates]);

  const totals = useMemo(() => {
    const totalOrders = zoneRows.reduce((s, r) => s + r.order_volume, 0);
    const totalBacklog = zoneRows.reduce((s, r) => s + r.planned_backlog, 0);
    const effectiveOrders = Math.max(0, totalOrders - totalBacklog);
    const totalPick = zoneRows.reduce((s, r) => s + r.picking_hours, 0);
    const totalPack = zoneRows.reduce((s, r) => s + r.packing_hours, 0);
    const pickHC = TIME_LEFT > 0 ? Math.ceil(totalPick / TIME_LEFT) : 0;
    const packHC = TIME_LEFT > 0 ? Math.ceil(totalPack / TIME_LEFT) : 0;
    const denom = totalPick + totalPack + (nonProdHC * TIME_LEFT);
    const predictedSPH = denom > 0 ? effectiveOrders / denom : 0;
    return { totalOrders, totalBacklog, effectiveOrders, totalPick, totalPack, pickHC, packHC, predictedSPH };
  }, [zoneRows, nonProdHC]);

  const serialMap = useMemo(() => {
    const order = zoneSerialOrder[zone] || [];
    const map: Record<string, number> = {};
    order.forEach((name, i) => { map[name] = i + 1; });
    return map;
  }, [zone]);

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
        return sortDir === "asc" ? (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi) : (bi === -1 ? 999 : bi) - (ai === -1 ? 999 : ai);
      });
    }
    return [...result].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [zoneRows, sortKey, sortDir, search, zone]);

  const toggleSort = (key: ZoneSortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  const SortIcon = ({ col }: { col: ZoneSortKey }) => {
    if (sortKey !== col) return <ArrowUpDown size={12} className="text-muted-foreground/50" />;
    return sortDir === "asc" ? <ArrowUp size={12} className="text-primary" /> : <ArrowDown size={12} className="text-primary" />;
  };

  const columns: { key: ZoneSortKey; label: string; align?: string }[] = [
    { key: "name", label: "Merchant" },
    { key: "order_volume", label: "Orders", align: "right" },
    { key: "planned_backlog", label: "Backlog", align: "right" },
    { key: "picking_hours", label: "Pick Hrs", align: "right" },
    { key: "packing_hours", label: "Pack Hrs", align: "right" },
    { key: "headcount", label: "HC", align: "right" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Orders" value={totals.totalOrders.toLocaleString()} icon={<Package size={16} />} />
        <StatCard label="Effective Orders" value={totals.effectiveOrders.toLocaleString()} icon={<PackageMinus size={16} />} subtext={`After ${totals.totalBacklog} backlog`} variant="success" />
        <StatCard label="Picking Hours" value={totals.totalPick.toFixed(1)} icon={<Clock size={16} />} subtext={`HC needed: ${totals.pickHC}`} variant="warning" />
        <StatCard label="Packing Hours" value={totals.totalPack.toFixed(1)} icon={<Clock size={16} />} subtext={`HC needed: ${totals.packHC}`} variant="warning" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Time Left" value={`${TIME_LEFT.toFixed(1)}h`} icon={<Timer size={16} />} />
        <div className="relative h-full">
          <StatCard label="Planned Backlog" value={totals.totalBacklog.toLocaleString()} icon={<ArrowDownToLine size={16} />} subtext="Orders deferred" />
          {totals.totalBacklog > 0 && (
            <Button variant="ghost" size="sm" className="absolute top-8 right-2 h-6 px-2 text-xs text-muted-foreground hover:text-destructive" onClick={onResetZoneBacklog} title="Reset zone backlog">
              <RotateCcw size={12} className="mr-1" /> Reset
            </Button>
          )}
        </div>
        <StatCard label="Predicted SPH" value={totals.predictedSPH.toFixed(1)} icon={<TrendingUp size={16} />} variant="success" />
        <div className="rounded-md border bg-card p-4 h-full border-primary/30">
          <div className="flex items-center justify-between mb-2">
            <span className="stat-label">Non-Prod HC</span>
            <span className="text-primary"><UserPlus size={16} /></span>
          </div>
          <Input type="number" min={0} value={nonProdHC} onChange={(e) => { const v = parseFloat(e.target.value); handleNonProdChange(isNaN(v) || v < 0 ? 0 : v); }} className="h-8 text-lg font-bold w-20 bg-secondary border-border" />
        </div>
      </div>

      <div className="rounded-md border bg-card">
        <div className="p-3 border-b flex items-center gap-2">
          <Search size={14} className="text-muted-foreground" />
          <input type="text" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none flex-1" />
          <span className="text-xs text-muted-foreground">{filtered.length} rows</span>
        </div>
        <div className="overflow-auto max-h-[500px]">
          <table className="w-full">
            <thead className="sticky top-0 bg-card z-10">
              <tr className="border-b">
                <th className="table-header px-3 py-2 text-center w-12 cursor-pointer hover:text-foreground transition-colors" onClick={() => toggleSort("serial")}>
                  <span className="inline-flex items-center gap-1">S.No <SortIcon col={"serial" as ZoneSortKey} /></span>
                </th>
                {columns.map((col) => (
                  <th key={col.key} className={`table-header px-3 py-2 cursor-pointer hover:text-foreground transition-colors ${col.align === "right" ? "text-right" : "text-left"}`} onClick={() => toggleSort(col.key)}>
                    <span className="inline-flex items-center gap-1">{col.label} <SortIcon col={col.key} /></span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(() => {
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
                            type="number" min={0} value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={() => {
                              const val = Math.max(0, parseInt(editValue, 10) || 0);
                              onBacklogChange(row.name, val);
                              setEditingMerchant(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") { const val = Math.max(0, parseInt(editValue, 10) || 0); onBacklogChange(row.name, val); setEditingMerchant(null); }
                              if (e.key === "Escape") setEditingMerchant(null);
                            }}
                            className="w-16 h-6 text-xs text-right bg-secondary border border-border rounded px-1"
                            autoFocus
                          />
                        ) : (
                          <span className="cursor-pointer hover:text-primary transition-colors border-b border-dashed border-muted-foreground/30" onClick={() => { setEditingMerchant(row.name); setEditValue(String(backlog[row.name] || 0)); }}>
                            {row.planned_backlog}
                          </span>
                        )}
                      </td>
                      <td className="table-cell px-3 py-2 text-right">{row.picking_hours.toFixed(2)}</td>
                      <td className="table-cell px-3 py-2 text-right">{row.packing_hours.toFixed(2)}</td>
                      {showHC && (
                        <td className="table-cell px-3 py-2 text-right font-semibold" rowSpan={hcRowSpan}>
                          {hcValue.toFixed(2)}
                        </td>
                      )}
                    </tr>
                  );
                });
              })()}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
