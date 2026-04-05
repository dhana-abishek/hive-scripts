import { useMemo, useState } from "react";
import { Package, Clock, Timer, Users, UserPlus, TrendingUp, ArrowUpDown, ArrowUp, ArrowDown, Search } from "lucide-react";
import { StatCard } from "@/components/SummaryStats";
import { Input } from "@/components/ui/input";
import { buildZoneLookup, zoneAGroups, zoneBGroups } from "@/data/zoneMappings";

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
  picking_hours: number;
  packing_hours: number;
  headcount: number;
  isGroup?: boolean;
}

interface ZoneViewProps {
  zone: "A" | "B";
  flowData: FlowRow[];
  timeLeft: number;
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

type SortKey = "serial" | "name" | "order_volume" | "picking_hours" | "packing_hours" | "headcount";

export function ZoneView({ zone, flowData }: ZoneViewProps) {
  const [nonProdHC, setNonProdHC] = useState(() => {
    const saved = localStorage.getItem(`nonProdHC_zone${zone}`);
    return saved !== null ? parseFloat(saved) : 6;
  });

  const handleNonProdChange = (val: number) => {
    setNonProdHC(val);
    localStorage.setItem(`nonProdHC_zone${zone}`, String(val));
  };
  const [sortKey, setSortKey] = useState<SortKey>("serial");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [search, setSearch] = useState("");

  const timeLeft = calcTimeLeft();
  const groups = zone === "A" ? zoneAGroups : zoneBGroups;

  const zoneRows = useMemo(() => {
    const rows: ZoneRow[] = [];

    // Named merchants (not in any group)
    for (const row of flowData) {
      const assignment = zoneLookup[row.merchant_name];
      if (assignment && assignment.zone === zone && !assignment.group) {
        const hc = timeLeft > 0 ? (row.picking_hours + row.packing_hours) / timeLeft : 0;
        rows.push({
          name: row.merchant_name,
          order_volume: row.order_volume,
          picking_hours: row.picking_hours,
          packing_hours: row.packing_hours,
          headcount: Math.round(hc * 100) / 100,
        });
      }
    }

    // Grouped merchants
    for (const [groupName, members] of Object.entries(groups)) {
      let totalOrders = 0, totalPick = 0, totalPack = 0;
      for (const row of flowData) {
        if (members.includes(row.merchant_name)) {
          totalOrders += row.order_volume;
          totalPick += row.picking_hours;
          totalPack += row.packing_hours;
        }
      }
      const hc = timeLeft > 0 ? (totalPick + totalPack) / timeLeft : 0;
      rows.push({
        name: groupName,
        order_volume: totalOrders,
        picking_hours: Math.round(totalPick * 100) / 100,
        packing_hours: Math.round(totalPack * 100) / 100,
        headcount: Math.round(hc * 100) / 100,
        isGroup: true,
      });
    }

    return rows;
  }, [flowData, zone, groups, timeLeft]);

  const totals = useMemo(() => {
    const totalOrders = zoneRows.reduce((s, r) => s + r.order_volume, 0);
    const totalPick = zoneRows.reduce((s, r) => s + r.picking_hours, 0);
    const totalPack = zoneRows.reduce((s, r) => s + r.packing_hours, 0);
    const totalHC = zoneRows.reduce((s, r) => s + r.headcount, 0);
    const denom = totalPick + totalPack + (nonProdHC * timeLeft);
    const predictedSPH = denom > 0 ? totalOrders / denom : 0;
    return { totalOrders, totalPick, totalPack, totalHC, predictedSPH };
  }, [zoneRows, nonProdHC, timeLeft]);

  const filtered = useMemo(() => {
    const order = zoneSerialOrder[zone] || [];
    let result = zoneRows;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((r) => r.name.toLowerCase().includes(q));
    }
    if (!search && sortKey === "name" && sortDir === "desc") {
      // Default: use serial order
      return [...result].sort((a, b) => {
        const ai = order.indexOf(a.name);
        const bi = order.indexOf(b.name);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
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
    { key: "picking_hours", label: "Pick Hrs", align: "right" },
    { key: "packing_hours", label: "Pack Hrs", align: "right" },
    { key: "headcount", label: "HC", align: "right" },
  ];

  return (
    <div className="space-y-4">
      {/* Zone summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard
          label="Total Orders"
          value={totals.totalOrders.toLocaleString()}
          icon={<Package size={16} />}
        />
        <StatCard
          label="Picking Hours"
          value={totals.totalPick.toFixed(1)}
          icon={<Clock size={16} />}
          variant="warning"
        />
        <StatCard
          label="Packing Hours"
          value={totals.totalPack.toFixed(1)}
          icon={<Clock size={16} />}
          variant="warning"
        />
        <StatCard
          label="Time Left"
          value={`${timeLeft.toFixed(1)}h`}
          icon={<Timer size={16} />}
        />
        <StatCard
          label="Predicted SPH"
          value={totals.predictedSPH.toFixed(1)}
          icon={<TrendingUp size={16} />}
          variant="success"
        />
        <div className="rounded-md border bg-card p-4 border-primary/30">
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
                <th className="table-header px-3 py-2 text-center w-12">S.No</th>
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
                <tr key={row.name} className="border-b border-border/50 hover:bg-secondary/50 transition-colors">
                  <td className="px-3 py-2 text-sm text-center text-muted-foreground">{serialMap[row.name] ?? ""}</td>
                  <td className="px-3 py-2 text-sm font-medium truncate max-w-[200px]">
                    {row.isGroup && <span className="text-xs text-primary mr-1">●</span>}
                    {row.name}
                  </td>
                  <td className="table-cell px-3 py-2 text-right">{row.order_volume}</td>
                  <td className="table-cell px-3 py-2 text-right">{row.picking_hours.toFixed(2)}</td>
                  <td className="table-cell px-3 py-2 text-right">{row.packing_hours.toFixed(2)}</td>
                  <td className="table-cell px-3 py-2 text-right font-semibold">{row.headcount.toFixed(2)}</td>
                </tr>
              ))}
              {/* Total row */}
              <tr className="border-t-2 border-primary/30 bg-secondary/30 font-bold">
                <td className="px-3 py-2 text-sm text-center"></td>
                <td className="px-3 py-2 text-sm">Total</td>
                <td className="table-cell px-3 py-2 text-right">{totals.totalOrders}</td>
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
