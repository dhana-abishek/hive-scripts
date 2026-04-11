import { useState, useMemo, useCallback } from "react";
import { Upload, Search, ArrowUpDown, ArrowUp, ArrowDown, Calendar, Package, MapPin, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { format, parse, isWithinInterval, isSameDay } from "date-fns";
import { buildZoneLookup, type ZoneAssignment } from "@/data/zoneMappings";
import { StatCard } from "@/components/SummaryStats";

interface ForecastRow {
  date: Date;
  merchant_name: string;
  total_forecast: number;
}

type SortKey = "merchant_name" | "total_forecast";

const zoneLookup = buildZoneLookup();

function parseForecastCsv(text: string): ForecastRow[] {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, "").toLowerCase());
  const dateIdx = header.indexOf("date");
  const merchantIdx = header.indexOf("merchant_name");
  const forecastIdx = header.indexOf("total_forecast");
  if (merchantIdx === -1 || forecastIdx === -1) return [];

  const rows: ForecastRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].match(/(".*?"|[^,]*)/g)?.map((c) => c.trim().replace(/^"|"$/g, "")) || [];
    const merchant = cols[merchantIdx]?.trim();
    const forecast = parseInt(cols[forecastIdx], 10);
    if (!merchant || isNaN(forecast)) continue;

    let date = new Date();
    if (dateIdx !== -1 && cols[dateIdx]) {
      try {
        date = parse(cols[dateIdx], "MMMM d, yyyy", new Date());
        if (isNaN(date.getTime())) date = new Date(cols[dateIdx]);
      } catch {
        date = new Date();
      }
    }
    rows.push({ date, merchant_name: merchant, total_forecast: forecast });
  }
  return rows;
}

function ForecastTable({
  data,
  title,
}: {
  data: { merchant_name: string; total_forecast: number }[];
  title: string;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("total_forecast");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [search, setSearch] = useState("");

  const totalOrders = useMemo(() => data.reduce((s, r) => s + r.total_forecast, 0), [data]);

  const filtered = useMemo(() => {
    let result = data;
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
  }, [data, sortKey, sortDir, search]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowUpDown size={12} className="text-muted-foreground/50" />;
    return sortDir === "asc" ? <ArrowUp size={12} className="text-primary" /> : <ArrowDown size={12} className="text-primary" />;
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard label="Total Forecast" value={totalOrders.toLocaleString()} icon={<Package size={16} />} subtext={`${data.length} merchants`} />
        <StatCard label="Merchants" value={data.length.toString()} icon={<MapPin size={16} />} />
        <StatCard label="Avg per Merchant" value={data.length > 0 ? Math.round(totalOrders / data.length).toLocaleString() : "0"} icon={<Activity size={16} />} />
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
                <th className="table-header px-3 py-2 cursor-pointer hover:text-foreground transition-colors text-left" onClick={() => toggleSort("merchant_name")}>
                  <span className="inline-flex items-center gap-1">Merchant <SortIcon col="merchant_name" /></span>
                </th>
                <th className="table-header px-3 py-2 cursor-pointer hover:text-foreground transition-colors text-right" onClick={() => toggleSort("total_forecast")}>
                  <span className="inline-flex items-center gap-1">Forecast <SortIcon col="total_forecast" /></span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.merchant_name} className="border-b border-border/50 hover:bg-secondary/50 transition-colors">
                  <td className="px-3 py-2 text-sm font-medium truncate max-w-[200px]">{row.merchant_name}</td>
                  <td className="table-cell px-3 py-2 text-right">{row.total_forecast.toLocaleString()}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={2} className="px-3 py-8 text-center text-sm text-muted-foreground">No merchants found</td></tr>
              )}
            </tbody>
            {filtered.length > 0 && (
              <tfoot className="border-t-2 border-border bg-secondary/50">
                <tr>
                  <td className="px-3 py-2 text-sm font-bold">Total</td>
                  <td className="px-3 py-2 text-right text-sm font-bold">{filtered.reduce((s, r) => s + r.total_forecast, 0).toLocaleString()}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}

export function ForecastManagement() {
  const [rawData, setRawData] = useState<ForecastRow[]>([]);
  const [subTab, setSubTab] = useState("all");
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();

  const handleUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      if (!text) return;
      const rows = parseForecastCsv(text);
      setRawData(rows);
      // Auto-set date range from data
      if (rows.length > 0) {
        const dates = rows.map((r) => r.date.getTime()).filter((t) => !isNaN(t));
        if (dates.length > 0) {
          setDateFrom(new Date(Math.min(...dates)));
          setDateTo(new Date(Math.max(...dates)));
        }
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }, []);

  const availableDates = useMemo(() => {
    const set = new Set<string>();
    for (const r of rawData) {
      if (!isNaN(r.date.getTime())) set.add(format(r.date, "yyyy-MM-dd"));
    }
    return Array.from(set).sort();
  }, [rawData]);

  const filteredData = useMemo(() => {
    if (!dateFrom && !dateTo) return rawData;
    return rawData.filter((r) => {
      if (isNaN(r.date.getTime())) return true;
      if (dateFrom && dateTo) {
        return isWithinInterval(r.date, { start: dateFrom, end: dateTo }) || isSameDay(r.date, dateFrom) || isSameDay(r.date, dateTo);
      }
      if (dateFrom) return r.date >= dateFrom || isSameDay(r.date, dateFrom);
      if (dateTo) return r.date <= dateTo || isSameDay(r.date, dateTo);
      return true;
    });
  }, [rawData, dateFrom, dateTo]);

  // Aggregate by merchant_name (sum total_forecast)
  const aggregated = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of filteredData) {
      map[r.merchant_name] = (map[r.merchant_name] || 0) + r.total_forecast;
    }
    return Object.entries(map).map(([merchant_name, total_forecast]) => ({ merchant_name, total_forecast }));
  }, [filteredData]);

  const zoneData = useMemo(() => {
    const a: typeof aggregated = [];
    const b: typeof aggregated = [];
    const unassigned: typeof aggregated = [];
    for (const row of aggregated) {
      const assignment = zoneLookup[row.merchant_name];
      if (assignment?.zone === "A") a.push(row);
      else if (assignment?.zone === "B") b.push(row);
      else unassigned.push(row);
    }
    return { a, b, unassigned };
  }, [aggregated]);

  return (
    <div className="space-y-4">
      {/* Upload & Date Filter */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Upload Forecast CSV</label>
          <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium border border-border bg-secondary text-foreground hover:bg-accent transition-colors cursor-pointer">
            <Upload size={14} />
            {rawData.length > 0 ? `${rawData.length} rows loaded` : "Choose CSV"}
            <input type="file" accept=".csv" className="hidden" onChange={handleUpload} />
          </label>
        </div>

        {rawData.length > 0 && (
          <>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">From</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-[160px] justify-start text-left text-xs font-normal", !dateFrom && "text-muted-foreground")}>
                    <Calendar size={14} className="mr-1" />
                    {dateFrom ? format(dateFrom, "MMM d, yyyy") : "Start date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarPicker mode="single" selected={dateFrom} onSelect={setDateFrom} initialFocus className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">To</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-[160px] justify-start text-left text-xs font-normal", !dateTo && "text-muted-foreground")}>
                    <Calendar size={14} className="mr-1" />
                    {dateTo ? format(dateTo, "MMM d, yyyy") : "End date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarPicker mode="single" selected={dateTo} onSelect={setDateTo} initialFocus className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>
            <Button variant="ghost" size="sm" className="text-xs" onClick={() => { setDateFrom(undefined); setDateTo(undefined); }}>Clear dates</Button>
            {availableDates.length > 0 && (
              <span className="text-xs text-muted-foreground self-center">
                {availableDates.length} date(s) in data
              </span>
            )}
          </>
        )}
      </div>

      {rawData.length === 0 ? (
        <div className="rounded-md border bg-card p-12 flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <Upload size={32} />
          <p className="text-sm">Upload a forecast CSV to get started</p>
          <p className="text-xs">Expected columns: merchant_name, total_forecast, date</p>
        </div>
      ) : (
        <Tabs value={subTab} onValueChange={setSubTab}>
          <div className="sm:hidden">
            <select value={subTab} onChange={(e) => setSubTab(e.target.value)} className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground">
              <option value="all">All Merchants</option>
              <option value="zoneA">Zone A</option>
              <option value="zoneB">Zone B</option>
            </select>
          </div>
          <div className="hidden sm:block">
            <TabsList className="bg-secondary border border-border">
              <TabsTrigger value="all" className="text-xs gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                <Activity size={14} /> All Merchants
              </TabsTrigger>
              <TabsTrigger value="zoneA" className="text-xs gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                <MapPin size={14} /> Zone A
              </TabsTrigger>
              <TabsTrigger value="zoneB" className="text-xs gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                <MapPin size={14} /> Zone B
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="all">
            <ForecastTable data={aggregated} title="All Merchants" />
          </TabsContent>
          <TabsContent value="zoneA">
            <ForecastTable data={zoneData.a} title="Zone A" />
          </TabsContent>
          <TabsContent value="zoneB">
            <ForecastTable data={zoneData.b} title="Zone B" />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
