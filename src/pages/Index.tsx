import { useMemo, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Package, BarChart3, Gauge, Activity } from "lucide-react";
import { SummaryStats } from "@/components/SummaryStats";
import { FlowManagementTable } from "@/components/FlowManagementTable";
import { BenchmarkTable } from "@/components/BenchmarkTable";
import { flowManagementData, pickingBenchmarks, packingBenchmarks } from "@/data/warehouseData";

const Index = () => {
  const stats = useMemo(() => {
    const totalOrders = flowManagementData.reduce((s, r) => s + r.order_volume, 0);
    const totalPickingHours = flowManagementData.reduce((s, r) => s + r.picking_hours, 0);
    const totalPackingHours = flowManagementData.reduce((s, r) => s + r.packing_hours, 0);
    const activeMerchants = flowManagementData.filter((r) => r.order_volume > 0);
    const avgSph = activeMerchants.length > 0
      ? activeMerchants.reduce((s, r) => s + r.ideal_sph, 0) / activeMerchants.length
      : 0;
    return { totalOrders, totalPickingHours, totalPackingHours, avgSph, merchantCount: flowManagementData.length };
  }, []);

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
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
            <span className="text-xs text-muted-foreground">Live</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        <SummaryStats {...stats} />

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
            <FlowManagementTable data={flowManagementData} />
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
