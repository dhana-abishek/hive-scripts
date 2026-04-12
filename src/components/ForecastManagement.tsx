import { useState, useMemo, useCallback, useEffect } from "react";
import { Upload, Search, ArrowUpDown, ArrowUp, ArrowDown, Calendar, Package, Users } from "lucide-react";
import { Button } from "@/components/ui/button";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { format, parse, isWithinInterval, isSameDay } from "date-fns";
import { buildZoneLookup } from "@/data/zoneMappings";
import { StatCard } from "@/components/SummaryStats";
import { cloudGet, cloudSet } from "@/lib/cloudStorage";

const FORECAST_DATA_KEY = "forecastData";

interface StoredForecastRow {
  date: string;
  merchant_name: string;
  total_forecast: number;
}

interface StoredForecastData {
  rows: StoredForecastRow[];
  dateFrom?: string;
  dateTo?: string;
}

const MULTIPLIER = 1.125;

interface ForecastRow {
  date: Date;
  merchant_name: string;
  total_forecast: number;
}

interface AggregatedRow {
  merchant_name: string;
  total_forecast: number;
  picking_hours: number;
  packing_hours: number;
  hc_needed: number;
  ideal_sph: number;
  is_unbenchmarked?: boolean;
}

type SortKey = "merchant_name" | "total_forecast" | "ideal_sph" | "hc_needed";

const zoneLookup = buildZoneLookup();

function getShiftHours(date: Date): number {
  const day = date.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  if (day === 6) return 6.5; // Saturday
  if (day === 0) return 0;   // Sunday
  return 8; // Monday - Friday
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') { inQuotes = false; } else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { result.push(current.trim()); current = ""; }
      else { current += ch; }
    }
  }
  result.push(current.trim());
  return result;
}

function parseForecastCsv(text: string): ForecastRow[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  const dateIdx = header.indexOf("date");
  const merchantIdx = header.indexOf("merchant_name");
  const forecastIdx = header.indexOf("total_forecast");
  if (merchantIdx === -1 || forecastIdx === -1) return [];

  const rows: ForecastRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = parseCsvLine(lines[i]);
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
  data: AggregatedRow[];
  title: string;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("total_forecast");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [search, setSearch] = useState("");

  const totalOrders = useMemo(() => data.reduce((s, r) => s + r.total_forecast, 0), [data]);
  const totalHC = useMemo(() => data.reduce((s, r) => s + r.hc_needed, 0), [data]);
  const unbenchmarked = useMemo(() => {
    const rows = data.filter((r) => r.is_unbenchmarked && r.total_forecast > 0);
    return { count: rows.length, volume: rows.reduce((s, r) => s + r.total_forecast, 0) };
  }, [data]);
  const weightedAvgIdealSph = useMemo(() => {
    const totalHrs = data.reduce((s, r) => s + r.picking_hours + r.packing_hours, 0);
    return totalHrs > 0 ? totalOrders / totalHrs : 0;
  }, [data, totalOrders]);

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

  const columns: { key: SortKey; label: string; align?: string }[] = [
    { key: "merchant_name", label: "Merchant" },
    { key: "total_forecast", label: "Forecast", align: "right" },
    { key: "ideal_sph", label: "Ideal SPH", align: "right" },
    { key: "hc_needed", label: "HC Needed", align: "right" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Forecast" value={totalOrders.toLocaleString()} icon={<Package size={16} />} subtext={`${data.length} merchants`} />
        <StatCard label="Unbenchmarked Orders" value={unbenchmarked.volume.toLocaleString()} icon={<Package size={16} />} subtext={`${unbenchmarked.count} unbenchmarked merchants`} />
        <StatCard label="Ideal SPH" value={weightedAvgIdealSph.toFixed(2)} icon={<Users size={16} />} />
        <StatCard label="Total HC Needed" value={totalHC.toFixed(1)} icon={<Users size={16} />} />
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
                  <th
                    key={col.key}
                    className={`table-header px-3 py-2 cursor-pointer hover:text-foreground transition-colors ${col.align === "right" ? "text-right" : "text-left"}`}
                    onClick={() => toggleSort(col.key)}
                  >
                    <span className="inline-flex items-center gap-1">{col.label} <SortIcon col={col.key} /></span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.merchant_name} className={cn("border-b border-border/50 hover:bg-secondary/50 transition-colors", row.is_unbenchmarked && row.total_forecast > 0 && "bg-red-500/10 hover:bg-red-500/15")}>
                  <td className="px-3 py-2 text-sm font-medium truncate max-w-[200px]">{row.merchant_name}</td>
                  <td className="table-cell px-3 py-2 text-right">{row.total_forecast.toLocaleString()}</td>
                  <td className="table-cell px-3 py-2 text-right">{row.ideal_sph.toFixed(2)}</td>
                  <td className="table-cell px-3 py-2 text-right font-semibold">{row.hc_needed.toFixed(2)}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-8 text-center text-sm text-muted-foreground">No merchants found</td></tr>
              )}
            </tbody>
            {filtered.length > 0 && (
              <tfoot className="border-t-2 border-border bg-secondary/50">
                <tr>
                  <td className="px-3 py-2 text-sm font-bold">Total</td>
                  <td className="px-3 py-2 text-right text-sm font-bold">{filtered.reduce((s, r) => s + r.total_forecast, 0).toLocaleString()}</td>
                  <td className="px-3 py-2 text-right text-sm font-bold">{(() => { const totalHrs = filtered.reduce((s, r) => s + r.picking_hours + r.packing_hours, 0); const totalForecast = filtered.reduce((s, r) => s + r.total_forecast, 0); return totalHrs > 0 ? (totalForecast / totalHrs).toFixed(2) : "—"; })()}</td>
                  <td className="px-3 py-2 text-right text-sm font-bold">{filtered.reduce((s, r) => s + r.hc_needed, 0).toFixed(2)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}

interface ForecastManagementProps {
  pickingRates?: Record<string, number>;
  packingRates?: Record<string, number>;
}

export function ForecastManagement({ pickingRates = {}, packingRates = {} }: ForecastManagementProps) {
  const [rawData, setRawData] = useState<ForecastRow[]>([]);
  
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();

  // Load persisted forecast data from cloud storage on mount
  useEffect(() => {
    (async () => {
      const stored = await cloudGet<StoredForecastData>(FORECAST_DATA_KEY);
      if (stored?.rows?.length) {
        const rows: ForecastRow[] = stored.rows.map((r) => ({
          date: new Date(r.date),
          merchant_name: r.merchant_name,
          total_forecast: r.total_forecast,
        }));
        setRawData(rows);
        if (stored.dateFrom) setDateFrom(new Date(stored.dateFrom));
        if (stored.dateTo) setDateTo(new Date(stored.dateTo));
      }
    })();
  }, []);

  // Persist forecast data to cloud storage whenever it changes
  useEffect(() => {
    const stored: StoredForecastData = {
      rows: rawData.map((r) => ({
        date: r.date.toISOString(),
        merchant_name: r.merchant_name,
        total_forecast: r.total_forecast,
      })),
      dateFrom: dateFrom?.toISOString(),
      dateTo: dateTo?.toISOString(),
    };
    void cloudSet(FORECAST_DATA_KEY, stored);
  }, [rawData, dateFrom, dateTo]);

  const handleUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      if (!text) return;
      const rows = parseForecastCsv(text);
      setRawData(rows);
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

  // Aggregate by merchant_name, compute picking/packing hours and HC needed
  const aggregated = useMemo<AggregatedRow[]>(() => {
    // Group forecast per merchant per date
    const map: Record<string, Map<string, { forecast: number; date: Date }>> = {};
    for (const r of filteredData) {
      if (!map[r.merchant_name]) map[r.merchant_name] = new Map();
      if (!isNaN(r.date.getTime())) {
        const dateStr = format(r.date, "yyyy-MM-dd");
        const entry = map[r.merchant_name].get(dateStr);
        if (entry) {
          entry.forecast += r.total_forecast;
        } else {
          map[r.merchant_name].set(dateStr, { forecast: r.total_forecast, date: r.date });
        }
      }
    }

    // First pass: compute benchmarked merchants
    const rows: AggregatedRow[] = [];
    for (const [merchant_name, dateMap] of Object.entries(map)) {
      const key = merchant_name.toLowerCase();
      const pickRate = pickingRates[key];
      const packRate = packingRates[key];
      const isBenchmarked = pickRate && pickRate > 0 && packRate && packRate > 0;

      let total_forecast = 0;
      let picking_hours = 0;
      let packing_hours = 0;
      let hc_needed = 0;

      for (const { forecast, date } of dateMap.values()) {
        total_forecast += forecast;
        if (isBenchmarked) {
          const pick_hrs = forecast / (pickRate * MULTIPLIER);
          const pack_hrs = forecast / (packRate * MULTIPLIER);
          picking_hours += pick_hrs;
          packing_hours += pack_hrs;
          const shiftHrs = getShiftHours(date);
          if (shiftHrs > 0) hc_needed += (pick_hrs + pack_hrs) / shiftHrs;
        }
      }

      const total_hours = picking_hours + packing_hours;
      rows.push({
        merchant_name,
        total_forecast,
        picking_hours: Math.round(picking_hours * 100) / 100,
        packing_hours: Math.round(packing_hours * 100) / 100,
        hc_needed: Math.round(hc_needed * 100) / 100,
        ideal_sph: total_hours > 0 ? Math.round((total_forecast / total_hours) * 100) / 100 : 0,
        is_unbenchmarked: !isBenchmarked,
      });
    }

    // Calculate weighted average ideal SPH from benchmarked merchants
    const benchmarkedRows = rows.filter((r) => r.ideal_sph > 0);
    const totalBenchmarkedForecast = benchmarkedRows.reduce((s, r) => s + r.total_forecast, 0);
    const totalBenchmarkedHours = benchmarkedRows.reduce((s, r) => s + r.picking_hours + r.packing_hours, 0);
    const weightedAvgSph = totalBenchmarkedHours > 0 ? totalBenchmarkedForecast / totalBenchmarkedHours : 0;

    // Second pass: apply weighted avg SPH to unbenchmarked merchants with forecast > 0
    for (const row of rows) {
      if (row.ideal_sph === 0 && row.total_forecast > 0 && weightedAvgSph > 0) {
        row.ideal_sph = Math.round(weightedAvgSph * 100) / 100;
        // Derive total hours from forecast / weightedAvgSph, then HC per day
        const dateMap = map[row.merchant_name];
        let hc = 0;
        for (const { forecast, date } of dateMap.values()) {
          const totalHrsForDay = forecast / weightedAvgSph;
          const shiftHrs = getShiftHours(date);
          if (shiftHrs > 0) hc += totalHrsForDay / shiftHrs;
        }
        const totalHrs = row.total_forecast / weightedAvgSph;
        row.picking_hours = Math.round(totalHrs * 0.5 * 100) / 100;
        row.packing_hours = Math.round(totalHrs * 0.5 * 100) / 100;
        row.hc_needed = Math.round(hc * 100) / 100;
      }
    }

    return rows;
  }, [filteredData, pickingRates, packingRates]);


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
                  <Button variant="outline" className={cn("w-[160px] justify-start text-left text-xs font-normal !bg-background hover:!bg-accent", !dateFrom && "text-muted-foreground")}>
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
                  <Button variant="outline" className={cn("w-[160px] justify-start text-left text-xs font-normal !bg-background hover:!bg-accent", !dateTo && "text-muted-foreground")}>
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
          <ForecastTable data={aggregated} title="All Merchants" />
      )}
    </div>
  );
}
