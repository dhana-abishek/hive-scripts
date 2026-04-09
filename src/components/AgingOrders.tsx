import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useTimeLeft } from "@/hooks/useTimeLeft";
import { Upload, Calendar, ArrowUpDown, ArrowUp, ArrowDown, Search, Package, Clock, Gauge, RotateCcw, Trash2, Timer, UserPlus, PackageMinus, ArrowDownToLine, TrendingUp, MapPin, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatCard } from "@/components/SummaryStats";
import { buildZoneLookup, zoneAGroups, zoneBGroups } from "@/data/zoneMappings";
import { cloudGet as idbGet, cloudSet as idbSet, cloudRemove as idbRemove } from "@/lib/cloudStorage";

const MULTIPLIER = 1.125;
const STORAGE_KEY_CSV = "agingOrdersCsv";
const STORAGE_KEY_BACKLOG = "agingOrdersBacklog";
const STORAGE_KEY_START_DATE = "agingStartDate";
const STORAGE_KEY_END_DATE = "agingEndDate";
const STORAGE_KEY_START_TIME = "agingStartTime";
const STORAGE_KEY_END_TIME = "agingEndTime";

interface ShipmentRow {
  ready_for_fulfillment_at: string; // raw datetime string e.g. "April 8, 2026, 00:00"
  ready_ts: number; // parsed timestamp
  merchant: string;
  shipment_id?: string;
}

interface AgingOrdersProps {
  pickingRates: Record<string, number>;
  packingRates: Record<string, number>;
}

type SortKey = "merchant" | "count_orders" | "planned_backlog" | "picking_hours" | "packing_hours" | "ideal_sph";

/** Parse datetime strings like "April 8, 2026, 00:00" or "April 8, 2026, 14:30" */
function parseDatetime(raw: string): number {
  // Format: "Month Day, Year, HH:MM"
  // Remove surrounding quotes if any
  const s = raw.replace(/^"|"$/g, "").trim();
  // Split on last comma to separate time
  const lastComma = s.lastIndexOf(",");
  if (lastComma === -1) return new Date(s).getTime();
  const datePart = s.substring(0, lastComma).trim();
  const timePart = s.substring(lastComma + 1).trim();
  const [hours, minutes] = timePart.split(":").map(Number);
  const d = new Date(datePart);
  if (!isNaN(hours)) d.setHours(hours);
  if (!isNaN(minutes)) d.setMinutes(minutes);
  return d.getTime();
}

function parseCSV(text: string): ShipmentRow[] {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];

  // Parse header to find column indices
  const headerLine = lines[0];
  const headers: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of headerLine) {
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === "," && !inQuotes) { headers.push(current.trim().toLowerCase()); current = ""; continue; }
    current += ch;
  }
  headers.push(current.trim().toLowerCase());

  const rffIdx = headers.indexOf("ready_for_fulfillment_at");
  const merchantIdx = headers.indexOf("merchant");
  const shipmentIdx = headers.indexOf("shipment_id");

  if (rffIdx === -1 || merchantIdx === -1) return [];

  const rows: ShipmentRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts: string[] = [];
    let cur = "";
    let inQ = false;
    for (const ch of lines[i]) {
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === "," && !inQ) { parts.push(cur.trim()); cur = ""; continue; }
      cur += ch;
    }
    parts.push(cur.trim());

    const rawDate = parts[rffIdx] || "";
    const merchant = parts[merchantIdx] || "";
    if (!rawDate || !merchant) continue;

    const ts = parseDatetime(rawDate);
    if (isNaN(ts)) continue;

    rows.push({
      ready_for_fulfillment_at: rawDate,
      ready_ts: ts,
      merchant,
      shipment_id: shipmentIdx !== -1 ? (parts[shipmentIdx] || undefined) : undefined,
    });
  }
  return rows;
}

/** Extract unique dates (YYYY-MM-DD) sorted */
function uniqueDates(data: ShipmentRow[]): string[] {
  const set = new Set<string>();
  for (const r of data) {
    const d = new Date(r.ready_ts);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    set.add(key);
  }
  return Array.from(set).sort();
}

/** Extract unique times (HH:MM) sorted */
function uniqueTimes(data: ShipmentRow[]): string[] {
  const set = new Set<string>();
  for (const r of data) {
    const d = new Date(r.ready_ts);
    const key = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    set.add(key);
  }
  return Array.from(set).sort();
}

function formatDateLabel(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[parseInt(m, 10) - 1]} ${parseInt(d, 10)}, ${y}`;
}

const zoneLookup = buildZoneLookup();

// Zone A HC groups
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

// ─── Zone sub-view for aging orders ───
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

function AgingZoneView({
  zone,
  merchantOrders,
  backlog,
  pickingRates,
  packingRates,
  onBacklogChange,
  onResetZoneBacklog,
}: {
  zone: "A" | "B";
  merchantOrders: Record<string, number>;
  backlog: Record<string, number>;
  pickingRates: Record<string, number>;
  packingRates: Record<string, number>;
  onBacklogChange: (merchant: string, val: number) => void;
  onResetZoneBacklog: () => void;
}) {
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

// ─── Main AgingOrders component ───
export function AgingOrders({ pickingRates, packingRates }: AgingOrdersProps) {
  const TIME_LEFT = useTimeLeft();
  const [rawData, setRawData] = useState<ShipmentRow[]>([]);
  const [hasFile, setHasFile] = useState(false);
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [startTime, setStartTime] = useState<string>("");
  const [endTime, setEndTime] = useState<string>("");
  const [sortKey, setSortKey] = useState<SortKey>("count_orders");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [search, setSearch] = useState("");
  const [backlog, setBacklog] = useState<Record<string, number>>({});
  const [editingMerchant, setEditingMerchant] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [nonProdHC, setNonProdHC] = useState(12);
  const [copiedDate, setCopiedDate] = useState<string | null>(null);
  const idbLoaded = useRef(false);

  useEffect(() => {
    (async () => {
      const [csv, bl, sd, ed, st, et, hc] = await Promise.all([
        idbGet<ShipmentRow[]>(STORAGE_KEY_CSV),
        idbGet<Record<string, number>>(STORAGE_KEY_BACKLOG),
        idbGet<string>(STORAGE_KEY_START_DATE),
        idbGet<string>(STORAGE_KEY_END_DATE),
        idbGet<string>(STORAGE_KEY_START_TIME),
        idbGet<string>(STORAGE_KEY_END_TIME),
        idbGet<number>("agingNonProdHC_main"),
      ]);
      if (csv && Array.isArray(csv) && csv.length > 0) { setRawData(csv); setHasFile(true); }
      if (bl) setBacklog(bl);
      if (sd) setStartDate(sd);
      if (ed) setEndDate(ed);
      if (st) setStartTime(st);
      if (et) setEndTime(et);
      if (hc !== null) setNonProdHC(hc);
      idbLoaded.current = true;
    })();
  }, []);

  const handleNonProdChange = (val: number) => {
    setNonProdHC(val);
    idbSet("agingNonProdHC_main", val);
  };

  useEffect(() => {
    if (!idbLoaded.current) return;
    if (rawData.length > 0 && !startDate && !endDate) {
      const d = uniqueDates(rawData);
      const t = uniqueTimes(rawData);
      if (d.length > 0) {
        setStartDate(d[0]);
        setEndDate(d[d.length - 1]);
        idbSet(STORAGE_KEY_START_DATE, d[0]);
        idbSet(STORAGE_KEY_END_DATE, d[d.length - 1]);
      }
      if (t.length > 0) {
        setStartTime(t[0]);
        setEndTime(t[t.length - 1]);
        idbSet(STORAGE_KEY_START_TIME, t[0]);
        idbSet(STORAGE_KEY_END_TIME, t[t.length - 1]);
      }
    }
  }, [rawData, startDate, endDate]);

  useEffect(() => {
    if (!idbLoaded.current) return;
    idbSet(STORAGE_KEY_BACKLOG, backlog);
  }, [backlog]);

  const handleUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const text = ev.target?.result as string;
      const parsed = parseCSV(text);
      const dates = uniqueDates(parsed);
      const times = uniqueTimes(parsed);
      const nextStartDate = dates[0] ?? "";
      const nextEndDate = dates[dates.length - 1] ?? "";
      const nextStartTime = times[0] ?? "";
      const nextEndTime = times[times.length - 1] ?? "";

      await Promise.all([
        idbSet(STORAGE_KEY_CSV, parsed),
        idbRemove(STORAGE_KEY_BACKLOG),
        nextStartDate ? idbSet(STORAGE_KEY_START_DATE, nextStartDate) : idbRemove(STORAGE_KEY_START_DATE),
        nextEndDate ? idbSet(STORAGE_KEY_END_DATE, nextEndDate) : idbRemove(STORAGE_KEY_END_DATE),
        nextStartTime ? idbSet(STORAGE_KEY_START_TIME, nextStartTime) : idbRemove(STORAGE_KEY_START_TIME),
        nextEndTime ? idbSet(STORAGE_KEY_END_TIME, nextEndTime) : idbRemove(STORAGE_KEY_END_TIME),
      ]);

      setRawData(parsed);
      setBacklog({});
      setHasFile(true);
      setStartDate(nextStartDate);
      setEndDate(nextEndDate);
      setStartTime(nextStartTime);
      setEndTime(nextEndTime);
    };
    reader.readAsText(file);
    e.target.value = "";
  }, []);

  const handleDeleteCsv = useCallback(async () => {
    await Promise.all([
      idbRemove(STORAGE_KEY_CSV),
      idbRemove(STORAGE_KEY_BACKLOG),
      idbRemove(STORAGE_KEY_START_DATE),
      idbRemove(STORAGE_KEY_END_DATE),
      idbRemove(STORAGE_KEY_START_TIME),
      idbRemove(STORAGE_KEY_END_TIME),
    ]);
    setRawData([]);
    setBacklog({});
    setHasFile(false);
    setStartDate("");
    setEndDate("");
    setStartTime("");
    setEndTime("");
  }, []);

  const handleBacklogChange = useCallback((merchant: string, val: number) => {
    setBacklog((prev) => ({ ...prev, [merchant]: val }));
  }, []);

  const handleResetBacklog = useCallback(() => setBacklog({}), []);

  const handleResetZoneBacklog = useCallback((zone: "A" | "B") => {
    setBacklog((prev) => {
      const updated = { ...prev };
      for (const merchant of Object.keys(updated)) {
        if (zoneLookup[merchant]?.zone === zone) updated[merchant] = 0;
      }
      return updated;
    });
  }, []);

  const dates = useMemo(() => uniqueDates(rawData), [rawData]);
  const times = useMemo(() => uniqueTimes(rawData), [rawData]);

  const shipmentIdsByDate = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const r of rawData) {
      if (!r.shipment_id) continue;
      const d = new Date(r.ready_ts);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (!map[key]) map[key] = [];
      map[key].push(r.shipment_id);
    }
    return map;
  }, [rawData]);

  const filteredByDate = useMemo(() => {
    if (!startDate && !endDate) return rawData;

    // Build start and end timestamps combining date + time
    let startTs = -Infinity;
    let endTs = Infinity;

    if (startDate) {
      const sTime = startTime || "00:00";
      const [sh, sm] = sTime.split(":").map(Number);
      const sd = new Date(startDate);
      sd.setHours(sh, sm, 0, 0);
      startTs = sd.getTime();
    }

    if (endDate) {
      const eTime = endTime || "23:59";
      const [eh, em] = eTime.split(":").map(Number);
      const ed = new Date(endDate);
      ed.setHours(eh, em, 59, 999);
      endTs = ed.getTime();
    }

    return rawData.filter((r) => r.ready_ts >= startTs && r.ready_ts <= endTs);
  }, [rawData, startDate, endDate, startTime, endTime]);

  // Aggregate: count shipments per merchant
  const merchantOrdersMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of filteredByDate) {
      map[r.merchant] = (map[r.merchant] || 0) + 1;
    }
    return map;
  }, [filteredByDate]);

  const merchantData = useMemo(() => {
    return Object.entries(merchantOrdersMap).map(([merchant, orders]) => {
      const bl = backlog[merchant] || 0;
      const effVol = Math.max(0, orders - bl);
      const mKey = merchant.toLowerCase();
      const pickRate = pickingRates[mKey];
      const packRate = packingRates[mKey];
      let pickHrs = 0, packHrs = 0, idealSph = 0;
      if (pickRate && packRate && pickRate > 0 && packRate > 0) {
        pickHrs = effVol / (pickRate * MULTIPLIER);
        packHrs = effVol / (packRate * MULTIPLIER);
        const totalHrs = pickHrs + packHrs;
        idealSph = totalHrs > 0 ? effVol / totalHrs : 0;
      }
      return {
        merchant, count_orders: orders, planned_backlog: bl,
        picking_hours: Math.round(pickHrs * 100) / 100,
        packing_hours: Math.round(packHrs * 100) / 100,
        ideal_sph: Math.round(idealSph * 100) / 100,
      };
    });
  }, [merchantOrdersMap, backlog, pickingRates, packingRates]);

  const totalOrders = merchantData.reduce((s, r) => s + r.count_orders, 0);
  const totalBacklog = merchantData.reduce((s, r) => s + r.planned_backlog, 0);
  const totalPickHrs = merchantData.reduce((s, r) => s + r.picking_hours, 0);
  const totalPackHrs = merchantData.reduce((s, r) => s + r.packing_hours, 0);
  const effectiveOrders = Math.max(0, totalOrders - totalBacklog);
  const pickHCNeeded = TIME_LEFT > 0 ? Math.ceil(totalPickHrs / TIME_LEFT) : 0;
  const packHCNeeded = TIME_LEFT > 0 ? Math.ceil(totalPackHrs / TIME_LEFT) : 0;
  const overallDenom = totalPickHrs + totalPackHrs + (nonProdHC * TIME_LEFT);
  const overallSph = overallDenom > 0 ? effectiveOrders / overallDenom : 0;

  const filtered = useMemo(() => {
    let result = merchantData;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((r) => r.merchant.toLowerCase().includes(q));
    }
    return [...result].sort((a, b) => {
      const av = a[sortKey]; const bv = b[sortKey];
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

  const getSphColor = (sph: number) => {
    if (sph >= 50) return "text-success";
    if (sph >= 25) return "text-foreground";
    return "text-warning";
  };

  const columns: { key: SortKey; label: string; align?: string }[] = [
    { key: "merchant", label: "Merchant" },
    { key: "count_orders", label: "Orders", align: "right" },
    { key: "planned_backlog", label: "Backlog", align: "right" },
    { key: "picking_hours", label: "Pick Hrs", align: "right" },
    { key: "packing_hours", label: "Pack Hrs", align: "right" },
    { key: "ideal_sph", label: "Ideal SPH", align: "right" },
  ];

  const handleDateChange = (type: "start" | "end", value: string) => {
    if (type === "start") {
      setStartDate(value);
      idbSet(STORAGE_KEY_START_DATE, value);
    } else {
      setEndDate(value);
      idbSet(STORAGE_KEY_END_DATE, value);
    }
  };

  const handleTimeChange = (type: "start" | "end", value: string) => {
    if (type === "start") {
      setStartTime(value);
      idbSet(STORAGE_KEY_START_TIME, value);
    } else {
      setEndTime(value);
      idbSet(STORAGE_KEY_END_TIME, value);
    }
  };

  return (
    <div className="space-y-4">
      {/* Upload & Date/Time Filter */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Upload CSV</label>
          <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium border border-border bg-secondary text-foreground hover:bg-accent transition-colors cursor-pointer">
            <Upload size={14} />
            {hasFile ? "Aging Orders" : "Choose file"}
            <input type="file" accept=".csv" onChange={handleUpload} className="hidden" />
          </label>
          {hasFile && (
            <Button variant="ghost" size="sm" className="h-8 px-2 text-xs text-muted-foreground hover:text-destructive" onClick={handleDeleteCsv} title="Delete uploaded CSV">
              <Trash2 size={14} className="mr-1" /> Delete CSV
            </Button>
          )}
        </div>
        {dates.length > 0 && (
          <>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">From Date</label>
              <select value={startDate} onChange={(e) => handleDateChange("start", e.target.value)} className="h-9 rounded-md border border-border bg-secondary text-foreground text-xs px-2">
                {dates.map((d) => <option key={d} value={d}>{formatDateLabel(d)}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">From Time</label>
              <select value={startTime} onChange={(e) => handleTimeChange("start", e.target.value)} className="h-9 rounded-md border border-border bg-secondary text-foreground text-xs px-2">
                {times.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">To Date</label>
              <select value={endDate} onChange={(e) => handleDateChange("end", e.target.value)} className="h-9 rounded-md border border-border bg-secondary text-foreground text-xs px-2">
                {dates.map((d) => <option key={d} value={d}>{formatDateLabel(d)}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">To Time</label>
              <select value={endTime} onChange={(e) => handleTimeChange("end", e.target.value)} className="h-9 rounded-md border border-border bg-secondary text-foreground text-xs px-2">
                {times.map((t) => <option key={t} value={t}>{t}</option>)}
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
        <Tabs defaultValue="all" className="space-y-4">
          <TabsList className="bg-secondary border border-border">
            <TabsTrigger value="all" className="text-xs gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              All Merchants
            </TabsTrigger>
            <TabsTrigger value="zoneA" className="text-xs gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <MapPin size={14} /> Zone A
            </TabsTrigger>
            <TabsTrigger value="zoneB" className="text-xs gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <MapPin size={14} /> Zone B
            </TabsTrigger>
            <TabsTrigger value="shipmentIds" className="text-xs gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <Package size={14} /> Shipment IDs
            </TabsTrigger>
          </TabsList>

          <TabsContent value="all" className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="Total Orders" value={totalOrders.toLocaleString()} icon={<Package size={16} />} subtext={`${merchantData.length} merchants`} />
              <StatCard label="Effective Orders" value={effectiveOrders.toLocaleString()} icon={<PackageMinus size={16} />} subtext={`After ${totalBacklog} backlog`} variant="success" />
              <div className="rounded-md border bg-card p-4 border-warning/30">
                <div className="flex items-center justify-between mb-2">
                  <span className="stat-label">Picking Hours</span>
                  <span className="text-warning"><Clock size={16} /></span>
                </div>
                <div className="stat-value text-foreground">{totalPickHrs.toFixed(1)}h</div>
                <p className="text-xs text-muted-foreground mt-1">
                  <span className="font-semibold text-foreground">{pickHCNeeded} HC</span> needed ({totalPickHrs.toFixed(1)}h ÷ {TIME_LEFT.toFixed(1)}h)
                </p>
              </div>
              <div className="rounded-md border bg-card p-4 border-warning/30">
                <div className="flex items-center justify-between mb-2">
                  <span className="stat-label">Packing Hours</span>
                  <span className="text-warning"><Clock size={16} /></span>
                </div>
                <div className="stat-value text-foreground">{totalPackHrs.toFixed(1)}h</div>
                <p className="text-xs text-muted-foreground mt-1">
                  <span className="font-semibold text-foreground">{packHCNeeded} HC</span> needed ({totalPackHrs.toFixed(1)}h ÷ {TIME_LEFT.toFixed(1)}h)
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="Time Left" value={`${TIME_LEFT.toFixed(1)}h`} icon={<Timer size={16} />} subtext="Remaining shift hours" />
              <div className="relative h-full">
                <StatCard label="Planned Backlog" value={totalBacklog.toLocaleString()} icon={<ArrowDownToLine size={16} />} subtext="Orders deferred" />
                {totalBacklog > 0 && (
                  <Button variant="ghost" size="sm" className="absolute top-8 right-2 h-6 px-2 text-xs text-muted-foreground hover:text-destructive" onClick={handleResetBacklog} title="Reset all planned backlog to 0">
                    <RotateCcw size={12} className="mr-1" /> Reset
                  </Button>
                )}
              </div>
              <StatCard label="Predicted SPH" value={overallSph.toFixed(1)} icon={<Gauge size={16} />} subtext="After non-prod HC" variant="success" />
              <div className="rounded-md border bg-card p-4 h-full border-primary/30">
                <div className="flex items-center justify-between mb-2">
                  <span className="stat-label">Non-Prod Headcount</span>
                  <span className="text-primary"><UserPlus size={16} /></span>
                </div>
                <Input type="number" min={0} value={nonProdHC} onChange={(e) => { const v = parseFloat(e.target.value); handleNonProdChange(isNaN(v) || v < 0 ? 0 : v); }} className="h-8 text-lg font-bold w-20 bg-secondary border-border" />
                <p className="text-xs text-muted-foreground mt-1">Enter headcount</p>
              </div>
            </div>

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
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((row) => (
                      <tr key={row.merchant} className="border-b border-border/50 hover:bg-secondary/50 transition-colors">
                        <td className="px-3 py-2 text-sm font-medium truncate max-w-[200px]">{row.merchant}</td>
                        <td className="table-cell px-3 py-2 text-right">{row.count_orders}</td>
                        <td className="table-cell px-3 py-2 text-right">
                          {editingMerchant === row.merchant ? (
                            <input type="number" min={0} value={editValue} onChange={(e) => setEditValue(e.target.value)} onBlur={handleCommitEdit} onKeyDown={(e) => { if (e.key === "Enter") handleCommitEdit(); if (e.key === "Escape") setEditingMerchant(null); }} autoFocus className="w-16 bg-secondary border border-border rounded px-1 py-0.5 text-xs text-right text-foreground outline-none focus:ring-1 focus:ring-primary" />
                          ) : (
                            <button onClick={() => handleStartEdit(row.merchant)} className="text-xs hover:text-primary transition-colors cursor-pointer tabular-nums" title="Click to edit planned backlog">{row.planned_backlog}</button>
                          )}
                        </td>
                        <td className="table-cell px-3 py-2 text-right">{row.picking_hours.toFixed(2)}</td>
                        <td className="table-cell px-3 py-2 text-right">{row.packing_hours.toFixed(2)}</td>
                        <td className={`table-cell px-3 py-2 text-right font-semibold ${getSphColor(row.ideal_sph)}`}>{row.ideal_sph.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="zoneA">
            <AgingZoneView
              zone="A"
              merchantOrders={merchantOrdersMap}
              backlog={backlog}
              pickingRates={pickingRates}
              packingRates={packingRates}
              onBacklogChange={(m, v) => handleBacklogChange(m, v)}
              onResetZoneBacklog={() => handleResetZoneBacklog("A")}
            />
          </TabsContent>

          <TabsContent value="zoneB">
            <AgingZoneView
              zone="B"
              merchantOrders={merchantOrdersMap}
              backlog={backlog}
              pickingRates={pickingRates}
              packingRates={packingRates}
              onBacklogChange={(m, v) => handleBacklogChange(m, v)}
              onResetZoneBacklog={() => handleResetZoneBacklog("B")}
            />
          </TabsContent>

          <TabsContent value="shipmentIds" className="space-y-3">
            {Object.keys(shipmentIdsByDate).length === 0 ? (
              <div className="rounded-md border bg-card p-12 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                <Package size={32} />
                <span className="text-sm">No shipment_id column found in the uploaded CSV.</span>
              </div>
            ) : (
              Object.entries(shipmentIdsByDate)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([date, ids]) => (
                  <div key={date} className="rounded-md border bg-card p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold">{formatDateLabel(date)}</span>
                      <span className="text-xs text-muted-foreground">{ids.length} shipments</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <p className="text-xs text-muted-foreground font-mono flex-1 break-all">{ids.join(", ")}</p>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(ids.join(", "));
                          setCopiedDate(date);
                          setTimeout(() => setCopiedDate(null), 2000);
                        }}
                        className="shrink-0 p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                        title="Copy shipment IDs"
                      >
                        {copiedDate === date ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                      </button>
                    </div>
                  </div>
                ))
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
