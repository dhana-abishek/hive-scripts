import { useState, useMemo } from "react";
import { ArrowUpDown, ArrowUp, ArrowDown, Search } from "lucide-react";

interface FlowManagementTableProps {
  data: {
    merchant_name: string;
    order_volume: number;
    waiting_for_picking: number;
    picking_hours: number;
    packing_hours: number;
    ideal_sph: number;
  }[];
}

type SortKey = "merchant_name" | "order_volume" | "waiting_for_picking" | "picking_hours" | "packing_hours" | "ideal_sph";

export function FlowManagementTable({ data }: FlowManagementTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("order_volume");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [search, setSearch] = useState("");

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

  const getSphColor = (sph: number) => {
    if (sph >= 50) return "text-success";
    if (sph >= 25) return "text-foreground";
    return "text-warning";
  };

  const columns: { key: SortKey; label: string; align?: string }[] = [
    { key: "merchant_name", label: "Merchant" },
    { key: "order_volume", label: "Orders", align: "right" },
    { key: "waiting_for_picking", label: "Waiting", align: "right" },
    { key: "picking_hours", label: "Pick Hrs", align: "right" },
    { key: "packing_hours", label: "Pack Hrs", align: "right" },
    { key: "ideal_sph", label: "Ideal SPH", align: "right" },
  ];

  return (
    <div className="rounded-md border bg-card">
      <div className="p-3 border-b flex items-center gap-2">
        <Search size={14} className="text-muted-foreground" />
        <input
          type="text"
          placeholder="Search merchants..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none flex-1"
        />
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
                  <span className="inline-flex items-center gap-1">
                    {col.label} <SortIcon col={col.key} />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.merchant_name} className="border-b border-border/50 hover:bg-secondary/50 transition-colors">
                <td className="px-3 py-2 text-sm font-medium truncate max-w-[200px]">{row.merchant_name}</td>
                <td className="table-cell px-3 py-2 text-right">{row.order_volume}</td>
                <td className="table-cell px-3 py-2 text-right">{row.waiting_for_picking}</td>
                <td className="table-cell px-3 py-2 text-right">{row.picking_hours.toFixed(2)}</td>
                <td className="table-cell px-3 py-2 text-right">{row.packing_hours.toFixed(2)}</td>
                <td className={`table-cell px-3 py-2 text-right font-semibold ${getSphColor(row.ideal_sph)}`}>
                  {row.ideal_sph.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
