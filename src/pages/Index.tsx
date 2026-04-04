import { useMemo, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Package, BarChart3, Gauge, Activity, RefreshCw, Loader2, MapPin } from "lucide-react";
import { SummaryStats } from "@/components/SummaryStats";
import { FlowManagementTable } from "@/components/FlowManagementTable";
import { BenchmarkTable } from "@/components/BenchmarkTable";
import { ZoneView } from "@/components/ZoneView";
import { pickingBenchmarks, packingBenchmarks } from "@/data/warehouseData";
import { useMetabaseData } from "@/hooks/useMetabaseData";

const Index = () => {
  const { flowData, isLoading, error, lastUpdated, refresh } = useMetabaseData();
  const [nonProdHeadcount, setNonProdHeadcount] = useState(0);

  const stats = useMemo(() => {
    const totalOrders = flowData.reduce((s, r) => s + r.order_volume, 0);
    const totalPickingHours = flowData.reduce((s, r) => s + r.picking_hours, 0);
    const totalPackingHours = flowData.reduce((s, r) => s + r.packing_hours, 0);
    return { totalOrders, totalPickingHours, totalPackingHours, merchantCount: flowData.length };
  }, [flowData]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
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
            {/* Refresh button & status */}
            <button
              onClick={refresh}
              disabled={isLoading}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border border-border bg-secondary text-foreground hover:bg-accent transition-colors disabled:opacity-50"
            >
              {isLoading ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RefreshCw size={12} />
              )}
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

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {error && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            Failed to fetch live data: {error}. Showing cached data.
          </div>
        )}

        <SummaryStats {...stats} nonProdHeadcount={nonProdHeadcount} onNonProdHeadcountChange={setNonProdHeadcount} />

        <Tabs defaultValue="flow" className="space-y-4">
          <TabsList className="bg-secondary border border-border">
            <TabsTrigger value="flow" className="text-xs gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <Activity size={14} /> Flow Management
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

          <TabsContent value="picking">
            <BenchmarkTable
              title="Picking Benchmark (SPH)"
              data={pickingBenchmarks}
              valueLabel="Pick SPH"
            />
          </TabsContent>

          <TabsContent value="packing">
            <BenchmarkTable
              title="Packing Benchmark (SPH)"
              data={packingBenchmarks}
              valueLabel="Pack SPH"
            />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default Index;
