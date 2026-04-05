import { useState, useMemo, useRef } from "react";
import { ArrowUpDown, ArrowUp, ArrowDown, Search, Upload, RotateCcw } from "lucide-react";
import type { BenchmarkEntry } from "@/types/warehouse";

interface BenchmarkTableProps {
  title: string;
  data: BenchmarkEntry[];
  valueLabel: string;
  onUpload?: (entries: BenchmarkEntry[]) => void;
  onReset?: () => void;
  isCustom?: boolean;
}

export function BenchmarkTable({ title, data, valueLabel, onUpload, onReset, isCustom }: BenchmarkTableProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onUpload) return;
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
      if (entries.length > 0) onUpload(entries);
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

  return (
    <div className="rounded-md border bg-card">
      <div className="p-3 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">{title}</h3>
          {isCustom && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">Custom</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onUpload && (
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
          {isCustom && onReset && (
            <button
              onClick={onReset}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium border border-border bg-secondary text-foreground hover:bg-accent transition-colors"
            >
              <RotateCcw size={12} /> Reset
            </button>
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
  );
}
