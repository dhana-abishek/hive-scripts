import { useState, useCallback, useEffect, useRef } from "react";
import { Upload, Search, GripVertical, Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { cloudGet, cloudSet } from "@/lib/cloudStorage";

const RESHUFFLING_DATA_KEY = "reshufflingData";

interface ReshufflingRow {
  sku_name: string;
  merchant_name: string;
  shipments_affected: number;
  min_ready_for_fulfillment_at: string;
  reshuffle_from: string;
  max_reshuffling_amount_suggested: number;
  _manual?: boolean;
}

const EMPTY_FORM: ReshufflingRow = {
  sku_name: "",
  merchant_name: "",
  shipments_affected: 0,
  min_ready_for_fulfillment_at: "",
  reshuffle_from: "",
  max_reshuffling_amount_suggested: 0,
};

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

function parseReshufflingCsv(text: string): ReshufflingRow[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase().trim());

  const skuIdx = header.indexOf("sku_name");
  const merchantIdx = header.indexOf("merchant_name");
  const shipmentsIdx = header.indexOf("shipments_affected");
  const minReadyIdx = header.indexOf("min_ready_for_fulfillment_at");
  const reshuffleFromIdx = header.indexOf("reshuffle_from");
  const maxAmountIdx = header.indexOf("max_reshuffling_amount_suggested");

  if (skuIdx === -1 || merchantIdx === -1) return [];

  const rows: ReshufflingRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = parseCsvLine(lines[i]);
    const sku = cols[skuIdx]?.trim() ?? "";
    const merchant = cols[merchantIdx]?.trim() ?? "";
    if (!sku && !merchant) continue;

    rows.push({
      sku_name: sku,
      merchant_name: merchant,
      shipments_affected: shipmentsIdx !== -1 ? parseInt(cols[shipmentsIdx] ?? "0", 10) || 0 : 0,
      min_ready_for_fulfillment_at: minReadyIdx !== -1 ? (cols[minReadyIdx]?.trim() ?? "") : "",
      reshuffle_from: reshuffleFromIdx !== -1 ? (cols[reshuffleFromIdx]?.trim() ?? "") : "",
      max_reshuffling_amount_suggested: maxAmountIdx !== -1 ? parseFloat(cols[maxAmountIdx] ?? "0") || 0 : 0,
    });
  }
  return rows;
}

export function Reshuffling() {
  const [rows, setRows] = useState<ReshufflingRow[]>([]);
  const [search, setSearch] = useState("");
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [form, setForm] = useState<ReshufflingRow>(EMPTY_FORM);
  const dragSrcIdx = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    cloudGet<ReshufflingRow[]>(RESHUFFLING_DATA_KEY).then((stored) => {
      if (stored && Array.isArray(stored)) setRows(stored);
      hasLoadedRef.current = true;
    });
  }, []);

  useEffect(() => {
    if (!hasLoadedRef.current) return;
    void cloudSet(RESHUFFLING_DATA_KEY, rows);
  }, [rows]);

  const handleUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      if (!text) return;
      setRows(parseReshufflingCsv(text));
    };
    reader.readAsText(file);
    e.target.value = "";
  }, []);

  const filtered = (() => {
    if (!search) return rows;
    const q = search.toLowerCase();
    return rows.filter(
      (r) =>
        r.sku_name.toLowerCase().includes(q) ||
        r.merchant_name.toLowerCase().includes(q) ||
        r.reshuffle_from.toLowerCase().includes(q)
    );
  })();

  const handleDragStart = (idx: number) => { dragSrcIdx.current = idx; };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDragOverIdx(idx);
  };

  const handleDrop = (dropFilteredIdx: number) => {
    const srcFilteredIdx = dragSrcIdx.current;
    if (srcFilteredIdx === null || srcFilteredIdx === dropFilteredIdx) {
      setDragOverIdx(null);
      dragSrcIdx.current = null;
      return;
    }
    const draggedRow = filtered[srcFilteredIdx];
    const targetRow = filtered[dropFilteredIdx];
    setRows((prev) => {
      const next = [...prev];
      const fromIdx = next.indexOf(draggedRow);
      const toIdx = next.indexOf(targetRow);
      if (fromIdx === -1 || toIdx === -1) return prev;
      next.splice(fromIdx, 1);
      next.splice(toIdx, 0, draggedRow);
      return next;
    });
    dragSrcIdx.current = null;
    setDragOverIdx(null);
  };

  const handleDragEnd = () => { dragSrcIdx.current = null; setDragOverIdx(null); };

  const openAdd = () => { setEditIdx(null); setForm(EMPTY_FORM); setAddDialogOpen(true); };

  const openEdit = (row: ReshufflingRow) => {
    setEditIdx(rows.indexOf(row));
    setForm({ ...row });
    setAddDialogOpen(true);
  };

  const handleSubmitDialog = () => {
    if (editIdx === null) {
      setRows((prev) => [{ ...form, _manual: true }, ...prev]);
    } else {
      setRows((prev) => prev.map((r, i) => (i === editIdx ? { ...form } : r)));
    }
    setForm(EMPTY_FORM);
    setEditIdx(null);
    setAddDialogOpen(false);
  };

  const handleDelete = (row: ReshufflingRow) => {
    setRows((prev) => prev.filter((r) => r !== row));
  };

  const setField = <K extends keyof ReshufflingRow>(key: K, value: ReshufflingRow[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const thClass = "px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide select-none";
  const tdClass = "px-3 py-2 text-xs text-foreground";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Reshuffling</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Upload a reshuffling CSV to view proactive reshuffle suggestions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleUpload} />
          <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={openAdd}>
            <Plus size={13} /> Add Row
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => fileInputRef.current?.click()}>
            <Upload size={13} /> Upload CSV
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-md border bg-card overflow-hidden">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
            <Upload size={24} className="opacity-40" />
            <p className="text-sm">Upload a CSV to view reshuffling data.</p>
            <p className="text-xs opacity-70">
              Expected columns: sku_name, merchant_name, shipments_affected,
              min_ready_for_fulfillment_at, reshuffle_from, max_reshuffling_amount_suggested
            </p>
          </div>
        ) : (
          <>
            {/* Search */}
            <div className="p-3 border-b">
              <div className="relative max-w-xs">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search SKU, merchant, reshuffle from..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md border border-border bg-secondary text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px]">
                <thead className="border-b bg-secondary/50">
                  <tr>
                    <th className={`${thClass} w-8`} />
                    <th className={thClass}>SKU Name</th>
                    <th className={thClass}>Merchant</th>
                    <th className={thClass}>Shipments Affected</th>
                    <th className={thClass}>Min Ready for Fulfillment</th>
                    <th className={thClass}>Reshuffle From</th>
                    <th className={thClass}>Max Reshuffle Amount</th>
                    <th className={`${thClass} w-16`} />
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-3 py-8 text-center text-xs text-muted-foreground">
                        No rows match your search.
                      </td>
                    </tr>
                  ) : (
                    filtered.map((row, idx) => (
                      <tr
                        key={idx}
                        draggable
                        onDragStart={() => handleDragStart(idx)}
                        onDragOver={(e) => handleDragOver(e, idx)}
                        onDrop={() => handleDrop(idx)}
                        onDragEnd={handleDragEnd}
                        className={[
                          "border-b last:border-0 transition-colors cursor-grab active:cursor-grabbing hover:bg-secondary/30",
                          dragOverIdx === idx ? "border-t-2 border-t-primary bg-primary/5" : "",
                        ].join(" ")}
                      >
                        <td className="px-2 py-2 text-muted-foreground/40 w-8">
                          <GripVertical size={14} />
                        </td>
                        <td className={tdClass}>{row.sku_name}</td>
                        <td className={tdClass}>{row.merchant_name}</td>
                        <td className={`${tdClass} text-right tabular-nums`}>
                          {row.shipments_affected.toLocaleString()}
                        </td>
                        <td className={tdClass}>{row.min_ready_for_fulfillment_at}</td>
                        <td className={tdClass}>{row.reshuffle_from}</td>
                        <td className={`${tdClass} text-right tabular-nums`}>
                          {row.max_reshuffling_amount_suggested.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </td>
                        <td className="px-2 py-1.5 text-right w-16">
                          {row._manual && (
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => openEdit(row)}
                                className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                                title="Edit row"
                              >
                                <Pencil size={12} />
                              </button>
                              <button
                                onClick={() => handleDelete(row)}
                                className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                                title="Delete row"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {filtered.length > 0 && (
                  <tfoot>
                    <tr className="border-t bg-secondary/50 font-medium">
                      <td className={`${tdClass} font-semibold`} colSpan={3}>
                        Totals ({filtered.length} row{filtered.length !== 1 ? "s" : ""})
                      </td>
                      <td className={`${tdClass} text-right tabular-nums font-semibold`}>
                        {filtered.reduce((s, r) => s + r.shipments_affected, 0).toLocaleString()}
                      </td>
                      <td className={tdClass} />
                      <td className={tdClass} />
                      <td className={`${tdClass} text-right tabular-nums font-semibold`}>
                        {filtered
                          .reduce((s, r) => s + r.max_reshuffling_amount_suggested, 0)
                          .toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </td>
                      <td className={tdClass} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </>
        )}
      </div>

      {/* Add / Edit dialog */}
      <Dialog open={addDialogOpen} onOpenChange={(open) => { setAddDialogOpen(open); if (!open) { setForm(EMPTY_FORM); setEditIdx(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">{editIdx === null ? "Add Row" : "Edit Row"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            {(
              [
                { key: "sku_name", label: "SKU Name", type: "text" },
                { key: "merchant_name", label: "Merchant Name", type: "text" },
                { key: "shipments_affected", label: "Shipments Affected", type: "number" },
                { key: "min_ready_for_fulfillment_at", label: "Min Ready for Fulfillment At", type: "text" },
                { key: "reshuffle_from", label: "Reshuffle From", type: "text" },
                { key: "max_reshuffling_amount_suggested", label: "Max Reshuffling Amount Suggested", type: "number" },
              ] as { key: keyof ReshufflingRow; label: string; type: string }[]
            ).map(({ key, label, type }) => (
              <div key={key} className="grid gap-1">
                <label className="text-xs font-medium text-muted-foreground">{label}</label>
                <input
                  type={type}
                  value={form[key] as string | number}
                  onChange={(e) =>
                    setField(
                      key,
                      type === "number"
                        ? (parseFloat(e.target.value) || 0) as ReshufflingRow[typeof key]
                        : e.target.value as ReshufflingRow[typeof key]
                    )
                  }
                  className="w-full px-3 py-1.5 text-xs rounded-md border border-border bg-secondary text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button size="sm" variant="outline" className="text-xs" onClick={() => setAddDialogOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" className="text-xs" onClick={handleSubmitDialog}>
              {editIdx === null ? "Add Row" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
