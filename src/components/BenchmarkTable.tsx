import { useState, useMemo, useRef } from "react";
import { ArrowUpDown, ArrowUp, ArrowDown, Search, Upload, ChevronDown, Pencil, Check, X } from "lucide-react";
import type { BenchmarkEntry } from "@/types/warehouse";

interface FlowRow {
  merchant_name: string;
  order_volume: number;
}

export interface BenchmarkUpload {
  id: string;
  name: string;
  entries: BenchmarkEntry[];
  uploadedAt: string;
}

interface BenchmarkTableProps {
  title: string;
  data: BenchmarkEntry[];
  valueLabel: string;
  uploads: BenchmarkUpload[];
  activeUploadId: string | null;
  onNewUpload?: (upload: BenchmarkUpload) => void;
  onSelectUpload?: (id: string) => void;
  onRenameUpload?: (id: string, newName: string) => void;
  liveFlowData?: FlowRow[];
}

export function BenchmarkTable({ title, data, valueLabel, uploads, activeUploadId, onNewUpload, onSelectUpload, onRenameUpload, liveFlowData }: BenchmarkTableProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onNewUpload) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.trim().split("\n");
      const entries: BenchmarkEntry[] = [];
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(",");
        if (parts.length < 2) continue;
        const merchant_name = parts.slice(0, -1).join(",").trim().replace(/^"|"$/g, "");
        const benchmark = parseFloat(parts[parts.length - 1].trim());
        if (merchant_name && !isNaN(benchmark)) {
          entries.push({ merchant_name, benchmark });
        }
      }
      if (entries.length > 0) {
        const upload: BenchmarkUpload = {
          id: Date.now().toString(),
          name: file.name.replace(/\.csv$/i, ""),
          entries,
          uploadedAt: new Date().toISOString(),
        };
        onNewUpload(upload);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const [sortKey, setSortKey] = useState<"merchant_name" | "benchmark">("benchmark");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    let result = data;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((r) => r.merchant_name.toLowerCase().includes(q));
    }
    return [...result].sort((a, b) => {
      if (sortKey === "merchant_name") return sortDir === "asc" ? a.merchant_name.localeCompare(b.merchant_name) : b.merchant_name.localeCompare(a.merchant_name);
      return sortDir === "asc" ? a.benchmark - b.benchmark : b.benchmark - a.benchmark;
    });
  }, [data, sortKey, sortDir, search]);

  const toggleSort = (key: "merchant_name" | "benchmark") => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  const max = Math.max(...data.map((d) => d.benchmark));

  const activeUpload = uploads.find((u) => u.id === activeUploadId);

  const unbenchmarkedStats = useMemo(() => {
    if (!liveFlowData || liveFlowData.length === 0) return null;
    const benchmarkNames = new Set(data.map((d) => d.merchant_name.toLowerCase()));
    const missing = liveFlowData.filter((m) => !benchmarkNames.has(m.merchant_name.toLowerCase()));
    return { count: missing.length, volume: missing.reduce((s, m) => s + m.order_volume, 0) };
  }, [liveFlowData, data]);

  const startRename = (id: string, currentName: string) => {
    setRenamingId(id);
    setRenameValue(currentName);
  };

  const confirmRename = () => {
    if (renamingId && renameValue.trim() && onRenameUpload) {
      onRenameUpload(renamingId, renameValue.trim());
    }
    setRenamingId(null);
  };

  return (
    <div className="space-y-3">
      {unbenchmarkedStats && (
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-md border bg-card p-3">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wider">Merchants Without Benchmark</p>
            <p className="text-xl font-bold text-destructive">{unbenchmarkedStats.count}</p>
          </div>
          <div className="rounded-md border bg-card p-3">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wider">Unbenchmarked Order Volume</p>
            <p className="text-xl font-bold text-destructive">{unbenchmarkedStats.volume.toLocaleString()}</p>
          </div>
        </div>
      )}
      <div className="rounded-md border bg-card">
        <div className="p-3 border-b flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{title}</h3>
            {activeUpload && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium truncate max-w-[120px]">
                {activeUpload.name}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {onNewUpload && (
              <>
                <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFileUpload} />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium border border-border bg-secondary text-foreground hover:bg-accent transition-colors"
                >
                  <Upload size={12} /> Upload CSV
                </button>
              </>
            )}
            {uploads.length > 1 && (
              <div className="relative">
                <button
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium border border-border bg-secondary text-foreground hover:bg-accent transition-colors"
                >
                  <ChevronDown size={12} /> Switch
                </button>
                {dropdownOpen && (
                  <div className="absolute right-0 top-full mt-1 w-64 rounded-md border bg-card shadow-lg z-30">
                    {uploads.map((u) => (
                      <div
                        key={u.id}
                        className={`flex items-center gap-2 px-3 py-2 text-xs hover:bg-secondary/50 cursor-pointer ${u.id === activeUploadId ? "bg-primary/10" : ""}`}
                      >
                        {renamingId === u.id ? (
                          <div className="flex items-center gap-1 flex-1" onClick={(e) => e.stopPropagation()}>
                            <input
                              autoFocus
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") confirmRename(); if (e.key === "Escape") setRenamingId(null); }}
                              className="flex-1 bg-transparent border-b border-primary text-foreground outline-none text-xs"
                            />
                            <button onClick={confirmRename} className="text-primary hover:text-primary/80"><Check size={12} /></button>
                            <button onClick={() => setRenamingId(null)} className="text-muted-foreground hover:text-foreground"><X size={12} /></button>
                          </div>
                        ) : (
                          <>
                            <span
                              className="flex-1 truncate"
                              onClick={() => { onSelectUpload?.(u.id); setDropdownOpen(false); }}
                            >
                              {u.name}
                              <span className="text-muted-foreground ml-1">({u.entries.length})</span>
                            </span>
                            <button
                              onClick={(e) => { e.stopPropagation(); startRename(u.id, u.name); }}
                              className="text-muted-foreground hover:text-foreground"
                            >
                              <Pencil size={10} />
                            </button>
                            {u.id === activeUploadId && <span className="text-primary font-bold">✓</span>}
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <Search size={14} className="text-muted-foreground" />
            <input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none w-32"
            />
          </div>
        </div>
        <div className="overflow-auto max-h-[500px]">
          <table className="w-full">
            <thead className="sticky top-0 bg-card z-10">
              <tr className="border-b">
                <th className="table-header px-3 py-2 text-left cursor-pointer hover:text-foreground" onClick={() => toggleSort("merchant_name")}>
                  <span className="inline-flex items-center gap-1">
                    Merchant
                    {sortKey === "merchant_name" ? (sortDir === "asc" ? <ArrowUp size={12} className="text-primary" /> : <ArrowDown size={12} className="text-primary" />) : <ArrowUpDown size={12} className="text-muted-foreground/50" />}
                  </span>
                </th>
                <th className="table-header px-3 py-2 text-right cursor-pointer hover:text-foreground" onClick={() => toggleSort("benchmark")}>
                  <span className="inline-flex items-center gap-1 justify-end">
                    {valueLabel}
                    {sortKey === "benchmark" ? (sortDir === "asc" ? <ArrowUp size={12} className="text-primary" /> : <ArrowDown size={12} className="text-primary" />) : <ArrowUpDown size={12} className="text-muted-foreground/50" />}
                  </span>
                </th>
                <th className="table-header px-3 py-2 w-32"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.merchant_name} className="border-b border-border/50 hover:bg-secondary/50 transition-colors">
                  <td className="px-3 py-1.5 text-sm truncate max-w-[200px]">{row.merchant_name}</td>
                  <td className="table-cell px-3 py-1.5 text-right">{row.benchmark.toFixed(2)}</td>
                  <td className="px-3 py-1.5">
                    <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary/70"
                        style={{ width: `${Math.min((row.benchmark / max) * 100, 100)}%` }}
                      />
                    </div>
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
