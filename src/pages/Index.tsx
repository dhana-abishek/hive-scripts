import { useMemo, useState, useCallback } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Package, BarChart3, Gauge, Activity, RefreshCw, Loader2, MapPin } from "lucide-react";
import { SummaryStats } from "@/components/SummaryStats";
import { FlowManagementTable } from "@/components/FlowManagementTable";
import { BenchmarkTable, type BenchmarkUpload } from "@/components/BenchmarkTable";
import { ZoneView } from "@/components/ZoneView";
import { pickingBenchmarks as defaultPickingBenchmarks, packingBenchmarks as defaultPackingBenchmarks } from "@/data/warehouseData";
import { useMetabaseData } from "@/hooks/useMetabaseData";
import type { BenchmarkEntry } from "@/types/warehouse";

const PICK_UPLOADS_KEY = "pickBenchmarkUploads";
const PICK_ACTIVE_KEY = "pickBenchmarkActiveId";
const PACK_UPLOADS_KEY = "packBenchmarkUploads";
const PACK_ACTIVE_KEY = "packBenchmarkActiveId";

function loadUploads(key: string): BenchmarkUpload[] {
  try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch { return []; }
}

const Index = () => {
  const [nonProdHeadcount, setNonProdHeadcount] = useState(() => {
    const saved = localStorage.getItem("nonProdHC_main");
    return saved !== null ? parseFloat(saved) : 12;
  });

  // Pick uploads
  const [pickUploads, setPickUploads] = useState<BenchmarkUpload[]>(() => loadUploads(PICK_UPLOADS_KEY));
  const [pickActiveId, setPickActiveId] = useState<string | null>(() => localStorage.getItem(PICK_ACTIVE_KEY));

  // Pack uploads
  const [packUploads, setPackUploads] = useState<BenchmarkUpload[]>(() => loadUploads(PACK_UPLOADS_KEY));
  const [packActiveId, setPackActiveId] = useState<string | null>(() => localStorage.getItem(PACK_ACTIVE_KEY));

  const activePick = pickUploads.find((u) => u.id === pickActiveId);
  const activePack = packUploads.find((u) => u.id === packActiveId);

  const pickingBenchmarks = activePick?.entries ?? defaultPickingBenchmarks;
  const packingBenchmarks = activePack?.entries ?? defaultPackingBenchmarks;

  const { flowData, isLoading, error, lastUpdated, refresh } = useMetabaseData(
    activePick?.entries ?? null,
    activePack?.entries ?? null
  );

  const handleNonProdChange = (val: number) => {
    setNonProdHeadcount(val);
    localStorage.setItem("nonProdHC_main", String(val));
  };

  // Pick handlers
  const handlePickNewUpload = useCallback((upload: BenchmarkUpload) => {
    setPickUploads((prev) => {
      const next = [...prev, upload];
      localStorage.setItem(PICK_UPLOADS_KEY, JSON.stringify(next));
      return next;
    });
    setPickActiveId(upload.id);
    localStorage.setItem(PICK_ACTIVE_KEY, upload.id);
  }, []);

  const handlePickSelect = useCallback((id: string) => {
    setPickActiveId(id);
    localStorage.setItem(PICK_ACTIVE_KEY, id);
  }, []);

  const handlePickRename = useCallback((id: string, newName: string) => {
    setPickUploads((prev) => {
      const next = prev.map((u) => u.id === id ? { ...u, name: newName } : u);
      localStorage.setItem(PICK_UPLOADS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  // Pack handlers
  const handlePackNewUpload = useCallback((upload: BenchmarkUpload) => {
    setPackUploads((prev) => {
      const next = [...prev, upload];
      localStorage.setItem(PACK_UPLOADS_KEY, JSON.stringify(next));
      return next;
    });
    setPackActiveId(upload.id);
    localStorage.setItem(PACK_ACTIVE_KEY, upload.id);
  }, []);

  const handlePackSelect = useCallback((id: string) => {
    setPackActiveId(id);
    localStorage.setItem(PACK_ACTIVE_KEY, id);
  }, []);

  const handlePackRename = useCallback((id: string, newName: string) => {
    setPackUploads((prev) => {
      const next = prev.map((u) => u.id === id ? { ...u, name: newName } : u);
      localStorage.setItem(PACK_UPLOADS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const stats = useMemo(() => {
    const totalOrders = flowData.reduce((s, r) => s + r.order_volume, 0);
    const totalPickingHours = flowData.reduce((s, r) => s + r.picking_hours, 0);
    const totalPackingHours = flowData.reduce((s, r) => s + r.packing_hours, 0);
    return { totalOrders, totalPickingHours, totalPackingHours, merchantCount: flowData.length };
  }, [flowData]);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-primary/10 flex items-center justify-center">
              <Package size={16} className="text-primary" />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight">Warehouse Flow Manager</h1>
              <p className="text-xs text-muted-foreground">Operations Dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={refresh}
              disabled={isLoading}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border border-border bg-secondary text-foreground hover:bg-accent transition-colors disabled:opacity-50"
            >
              {isLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Refresh
            </button>
            {lastUpdated && (
              <span className="text-xs text-muted-foreground hidden sm:inline">
                Updated {lastUpdated.toLocaleTimeString()}
              </span>
            )}
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
              <span className="text-xs text-muted-foreground">Live</span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {error && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            Failed to fetch live data: {error}. Showing cached data.
          </div>
        )}

        <SummaryStats {...stats} nonProdHeadcount={nonProdHeadcount} onNonProdHeadcountChange={handleNonProdChange} />

        <Tabs defaultValue="flow" className="space-y-4">
          <TabsList className="bg-secondary border border-border">
            <TabsTrigger value="flow" className="text-xs gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <Activity size={14} /> Flow Management
            </TabsTrigger>
            <TabsTrigger value="zoneA" className="text-xs gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <MapPin size={14} /> Zone A
            </TabsTrigger>
            <TabsTrigger value="zoneB" className="text-xs gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <MapPin size={14} /> Zone B
            </TabsTrigger>
            <TabsTrigger value="picking" className="text-xs gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <BarChart3 size={14} /> Pick Benchmark
            </TabsTrigger>
            <TabsTrigger value="packing" className="text-xs gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <Gauge size={14} /> Pack Benchmark
            </TabsTrigger>
          </TabsList>

          <TabsContent value="flow">
            {isLoading && flowData.length === 0 ? (
              <div className="rounded-md border bg-card p-12 flex items-center justify-center gap-2 text-muted-foreground">
                <Loader2 size={16} className="animate-spin" />
                <span className="text-sm">Loading live data from Metabase...</span>
              </div>
            ) : (
              <FlowManagementTable data={flowData} />
            )}
          </TabsContent>
          <TabsContent value="zoneA">
            <ZoneView zone="A" flowData={flowData} timeLeft={0} />
          </TabsContent>
          <TabsContent value="zoneB">
            <ZoneView zone="B" flowData={flowData} timeLeft={0} />
          </TabsContent>

          <TabsContent value="picking">
            <BenchmarkTable
              title="Picking Benchmark (SPH)"
              data={pickingBenchmarks}
              valueLabel="Pick SPH"
              uploads={pickUploads}
              activeUploadId={pickActiveId}
              onNewUpload={handlePickNewUpload}
              onSelectUpload={handlePickSelect}
              onRenameUpload={handlePickRename}
              liveFlowData={flowData}
            />
          </TabsContent>

          <TabsContent value="packing">
            <BenchmarkTable
              title="Packing Benchmark (SPH)"
              data={packingBenchmarks}
              valueLabel="Pack SPH"
              uploads={packUploads}
              activeUploadId={packActiveId}
              onNewUpload={handlePackNewUpload}
              onSelectUpload={handlePackSelect}
              onRenameUpload={handlePackRename}
              liveFlowData={flowData}
            />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default Index;
