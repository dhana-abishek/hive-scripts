import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Upload, Trash2, Search, ArrowUpDown, ArrowUp, ArrowDown, AlertTriangle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cloudGet as idbGet, cloudSet as idbSet, cloudRemove as idbRemove } from "@/lib/cloudStorage";
import { parseCSVLine, parseCSVHeaders } from "@/lib/csvParser";
import { buildZoneLookup } from "@/data/zoneMappings";

const zoneLookup = buildZoneLookup();
type ZoneFilter = "all" | "A" | "B";

const STORAGE_KEY_CSV = "issuesCsv";
const STORAGE_KEY_UPLOADED_AT = "issuesUploadedAt";
const STORAGE_KEY_THRESHOLD = "issuesThresholdHours";

interface IssueRow {
  shipment_id: string;
  order_id: string;
  created_at: string;
  ready_for_fulfillment_at: string;
  finished_picking_at: string;
  finished_picking_ts: number;
  finished_packing_at: string;
  merchant: string;
  internal_status_type: string;
  picking_basket: string;
}

type SortKey = "merchant" | "shipment_id" | "order_id" | "finished_picking_at" | "age_hours" | "internal_status_type";

/** Parse "April 22, 2026, 13:05" */
function parseDatetime(raw: string): number {
  const s = (raw || "").replace(/^"|"$/g, "").trim();
  if (!s) return NaN;
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

function parseCSV(text: string): IssueRow[] {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = parseCSVHeaders(lines[0]);
  const idx = (name: string) => headers.indexOf(name);
  const iShip = idx("shipment_id");
  const iOrder = idx("order_id");
  const iCreated = idx("created_at");
  const iRff = idx("ready_for_fulfillment_at");
  const iPick = idx("finished_picking_at");
  const iPack = idx("finished_packing_at");
  const iMerch = idx("merchant");
  const iStatus = idx("internal_status_type");
  const iBasket = idx("picking_basket");

  const rows: IssueRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const p = parseCSVLine(lines[i]).map(f => f.trim());
    const finishedPicking = iPick !== -1 ? (p[iPick] || "") : "";
    if (!finishedPicking) continue; // need finished_picking_at to compute age
    const ts = parseDatetime(finishedPicking);
    if (isNaN(ts)) continue;
    rows.push({
      shipment_id: iShip !== -1 ? p[iShip] || "" : "",
      order_id: iOrder !== -1 ? p[iOrder] || "" : "",
      created_at: iCreated !== -1 ? p[iCreated] || "" : "",
      ready_for_fulfillment_at: iRff !== -1 ? p[iRff] || "" : "",
      finished_picking_at: finishedPicking,
      finished_picking_ts: ts,
      finished_packing_at: iPack !== -1 ? p[iPack] || "" : "",
      merchant: iMerch !== -1 ? p[iMerch] || "" : "",
      internal_status_type: iStatus !== -1 ? p[iStatus] || "" : "",
      picking_basket: iBasket !== -1 ? p[iBasket] || "" : "",
    });
  }
  return rows;
}

export function Issues() {
  const [rawData, setRawData] = useState<IssueRow[]>([]);
  const [hasFile, setHasFile] = useState(false);
  const [uploadedAt, setUploadedAt] = useState<number>(0);
  const [thresholdHours, setThresholdHours] = useState<number>(24);
  const [search, setSearch] = useState("");
  const [zoneFilter, setZoneFilter] = useState<ZoneFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("age_hours");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const loadedRef = useRef(false);

  useEffect(() => {
    (async () => {
      const [csv, ts, th] = await Promise.all([
        idbGet<IssueRow[]>(STORAGE_KEY_CSV),
        idbGet<number>(STORAGE_KEY_UPLOADED_AT),
        idbGet<number>(STORAGE_KEY_THRESHOLD),
      ]);
      if (csv && Array.isArray(csv) && csv.length > 0) {
        setRawData(csv);
        setHasFile(true);
      }
      if (ts) setUploadedAt(ts);
      if (typeof th === "number" && th > 0) setThresholdHours(th);
      loadedRef.current = true;
    })();
  }, []);

  useEffect(() => {
    if (!loadedRef.current) return;
    idbSet(STORAGE_KEY_THRESHOLD, thresholdHours);
  }, [thresholdHours]);

  const handleUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const text = ev.target?.result as string;
      const parsed = parseCSV(text);
      const now = Date.now();
      await Promise.all([
        idbSet(STORAGE_KEY_CSV, parsed),
        idbSet(STORAGE_KEY_UPLOADED_AT, now),
      ]);
      setRawData(parsed);
      setUploadedAt(now);
      setHasFile(true);
    };
    reader.readAsText(file);
    e.target.value = "";
  }, []);

  const handleDelete = useCallback(async () => {
    await Promise.all([
      idbRemove(STORAGE_KEY_CSV),
      idbRemove(STORAGE_KEY_UPLOADED_AT),
    ]);
    setRawData([]);
    setUploadedAt(0);
    setHasFile(false);
  }, []);

  const filtered = useMemo(() => {
    if (!uploadedAt || rawData.length === 0) return [];
    const cutoff = uploadedAt - thresholdHours * 3600 * 1000;
    let result = rawData
      .filter(r => r.finished_picking_ts < cutoff)
      .map(r => ({
        ...r,
        age_hours: (uploadedAt - r.finished_picking_ts) / 3600000,
      }));
    if (zoneFilter !== "all") {
      result = result.filter(r => zoneLookup[r.merchant]?.zone === zoneFilter);
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(r =>
        r.merchant.toLowerCase().includes(q) ||
        r.shipment_id.toLowerCase().includes(q) ||
        r.order_id.toLowerCase().includes(q) ||
        r.picking_basket.toLowerCase().includes(q)
      );
    }
    return result.sort((a, b) => {
      const av = (a as any)[sortKey];
      const bv = (b as any)[sortKey];
      if (typeof av === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }, [rawData, uploadedAt, thresholdHours, search, sortKey, sortDir, zoneFilter]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowUpDown size={12} className="text-muted-foreground/50" />;
    return sortDir === "asc" ? <ArrowUp size={12} className="text-primary" /> : <ArrowDown size={12} className="text-primary" />;
  };

  const columns: { key: SortKey; label: string; align?: string }[] = [
    { key: "merchant", label: "Merchant" },
    { key: "shipment_id", label: "Shipment" },
    { key: "order_id", label: "Order" },
    { key: "finished_picking_at", label: "Finished Picking" },
    { key: "age_hours", label: "Age (h)", align: "right" },
    { key: "internal_status_type", label: "Status" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Upload CSV</label>
          <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium border border-border bg-secondary text-foreground hover:bg-accent transition-colors cursor-pointer">
            <Upload size={14} />
            {hasFile ? "Replace CSV" : "Choose file"}
            <input type="file" accept=".csv" onChange={handleUpload} className="hidden" />
          </label>
          {hasFile && (
            <Button variant="ghost" size="sm" className="h-8 px-2 text-xs text-muted-foreground hover:text-destructive ml-2" onClick={handleDelete}>
              <Trash2 size={14} className="mr-1" /> Delete
            </Button>
          )}
        </div>

        <div>
          <label className="text-xs text-muted-foreground block mb-1">Older than (hours)</label>
          <Input
            type="number"
            min={0}
            step={0.5}
            value={thresholdHours}
            onChange={(e) => setThresholdHours(Math.max(0, parseFloat(e.target.value) || 0))}
            className="h-9 w-32 text-xs"
          />
        </div>

        <div>
          <label className="text-xs text-muted-foreground block mb-1">Zone</label>
          <div className="inline-flex rounded-md border border-border bg-secondary p-0.5">
            {(["all", "A", "B"] as ZoneFilter[]).map((z) => (
              <button
                key={z}
                onClick={() => setZoneFilter(z)}
                className={`px-3 h-8 text-xs rounded ${zoneFilter === z ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-accent"}`}
              >
                {z === "all" ? "All" : `Zone ${z}`}
              </button>
            ))}
          </div>
        </div>

        {hasFile && (
          <div className="text-xs text-muted-foreground pb-2">
            <div className="flex items-center gap-1.5">
              <Clock size={12} />
              Uploaded: {new Date(uploadedAt).toLocaleString()}
            </div>
            <div className="mt-1">
              {rawData.length} rows in file · {filtered.length} flagged
            </div>
          </div>
        )}
      </div>

      {hasFile && (
        <div className="relative max-w-sm">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search merchant, shipment, order, basket..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 pl-8 text-xs"
          />
        </div>
      )}

      {!hasFile ? (
        <div className="rounded-md border bg-card p-12 flex flex-col items-center justify-center gap-2 text-muted-foreground">
          <AlertTriangle size={24} />
          <p className="text-sm">Upload a CSV to identify shipments stuck after picking.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-md border bg-card p-8 text-center text-sm text-muted-foreground">
          No shipments older than {thresholdHours} hour{thresholdHours === 1 ? "" : "s"} from upload time.
        </div>
      ) : (
        <div className="rounded-md border bg-card overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-secondary/50">
              <tr>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    onClick={() => toggleSort(c.key)}
                    className={`px-3 py-2 font-medium text-muted-foreground cursor-pointer select-none ${c.align === "right" ? "text-right" : "text-left"}`}
                  >
                    <span className="inline-flex items-center gap-1">
                      {c.label} <SortIcon col={c.key} />
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={`${r.shipment_id}-${i}`} className="border-t border-border hover:bg-accent/30">
                  <td className="px-3 py-2">{r.merchant}</td>
                  <td className="px-3 py-2 font-mono">{r.shipment_id}</td>
                  <td className="px-3 py-2 font-mono">{r.order_id}</td>
                  <td className="px-3 py-2">{r.finished_picking_at}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-warning font-medium">
                    {r.age_hours.toFixed(1)}
                  </td>
                  <td className="px-3 py-2">{r.internal_status_type || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
