import { useMemo, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Package, BarChart3, Gauge, Activity, RefreshCw, Loader2, MapPin, CalendarClock, Users, TrendingUp, FileText, CalendarRange, Shuffle, type LucideIcon } from "lucide-react";
import { SummaryStats } from "@/components/SummaryStats";
import { FlowManagementTable } from "@/components/FlowManagementTable";
import { BenchmarkTable } from "@/components/BenchmarkTable";
import { ZoneView } from "@/components/ZoneView";
import { AgingOrders } from "@/components/AgingOrders";
import { PerformanceTracker } from "@/components/PerformanceTracker";
import { ActualSPH } from "@/components/ActualSPH";
import { Reports } from "@/components/Reports";
import { ForecastManagement, ForecastAccuracy } from "@/components/ForecastManagement";
import { Reshuffling } from "@/components/Reshuffling";
import { pickingBenchmarks as defaultPickingBenchmarks, packingBenchmarks as defaultPackingBenchmarks } from "@/data/warehouseData";
import { useMetabaseData } from "@/hooks/useMetabaseData";
import { getInflowFactor } from "@/lib/inflowEstimation";
import { DashboardProvider, useDashboard } from "@/contexts/DashboardContext";

const tabItems: { value: string; label: string; icon: LucideIcon }[] = [
  { value: "flow", label: "Flow Management", icon: Activity },
  { value: "aging", label: "Aging Orders", icon: CalendarClock },
  { value: "performance", label: "Performance", icon: Users },
  { value: "actualsph", label: "Actual SPH", icon: TrendingUp },
  { value: "reports", label: "Reports", icon: FileText },
  { value: "forecast", label: "Forecast Overview", icon: CalendarRange },
  { value: "reshuffling", label: "Reshuffling", icon: Shuffle },
];

function Dashboard() {
  const {
    nonProdHeadcount,
    nonProdHC_A, setNonProdHC_A,
    nonProdHC_B, setNonProdHC_B,
    availableHC_A, setAvailableHC_A,
    availableHC_B, setAvailableHC_B,
    availableHeadcount,
    extraMerchants, setExtraMerchants,
    inflowEnabled, setInflowEnabled,
    overnightVolumes, setOvernightVolumes,
    restockCandidates, setRestockCandidates,
    confirmRestockExclusion, dismissRestockCandidates,
    pickUploads, pickActiveId,
    handlePickNewUpload, handlePickSelect, handlePickRename, handlePickDelete,
    packUploads, packActiveId,
    handlePackNewUpload, handlePackSelect, handlePackRename, handlePackDelete,
    backlog, handleBacklogChange, handleResetBacklog, handleResetZoneBacklog,
  } = useDashboard();

  const activePick = pickUploads.find((u) => u.id === pickActiveId);
  const activePack = packUploads.find((u) => u.id === packActiveId);

  const pickingBenchmarks = activePick?.entries ?? defaultPickingBenchmarks;
  const packingBenchmarks = activePack?.entries ?? defaultPackingBenchmarks;

  const { flowData, rawMerchants, pickingRates, packingRates, isLoading, error, lastUpdated, refresh } = useMetabaseData(
    activePick?.entries ?? null,
    activePack?.entries ?? null
  );

  // Merge extra merchants into flowData as additional rows, with optional inflow estimation
  const mergedFlowData = useMemo(() => {
    const inflowFactor = inflowEnabled ? getInflowFactor().factor : 0;

    const existing = new Set(flowData.map(r => r.merchant_name));
    const extraRows = extraMerchants
      .filter(m => !existing.has(m.name))
      .map(m => {
        const key = m.name.toLowerCase();
        const pickRate = pickingRates[key];
        const packRate = packingRates[key];
        const MULT = 1.125;
        const pickHrs = pickRate && pickRate > 0 ? m.orderVolume / (pickRate * MULT) : 0;
        const packHrs = packRate && packRate > 0 ? m.orderVolume / (packRate * MULT) : 0;
        const totalHrs = pickHrs + packHrs;
        const idealSph = totalHrs > 0 ? m.orderVolume / totalHrs : 0;
        return {
          merchant_name: m.name,
          order_volume: m.orderVolume,
          waiting_for_picking: m.orderVolume,
          picking_hours: Math.round(pickHrs * 100) / 100,
          packing_hours: Math.round(packHrs * 100) / 100,
          ideal_sph: Math.round(idealSph * 100) / 100,
        };
      });
    const adjusted = flowData.map(r => {
      const extra = extraMerchants.find(m => m.name === r.merchant_name);
      const extraVol = extra ? extra.orderVolume : 0;

      // Apply inflow factor only to overnight portion (from CSV), not entire volume
      const overnightCount = overnightVolumes[r.merchant_name] || 0;
      const additionalInflow = inflowFactor > 0 ? Math.round(overnightCount * inflowFactor) : 0;
      const newVol = r.order_volume + additionalInflow + extraVol;
      const newWaiting = r.waiting_for_picking + additionalInflow + extraVol;

      if (newVol !== r.order_volume || newWaiting !== r.waiting_for_picking) {
        const key = r.merchant_name.toLowerCase();
        const pickRate = pickingRates[key];
        const packRate = packingRates[key];
        const MULT = 1.125;
        if (pickRate && packRate && pickRate > 0 && packRate > 0) {
          const pickHrs = newWaiting / (pickRate * MULT);
          const packHrs = newVol / (packRate * MULT);
          const totalHrs = pickHrs + packHrs;
          return {
            ...r,
            order_volume: newVol,
            waiting_for_picking: newWaiting,
            picking_hours: Math.round(pickHrs * 100) / 100,
            packing_hours: Math.round(packHrs * 100) / 100,
            ideal_sph: totalHrs > 0 ? Math.round((newVol / totalHrs) * 100) / 100 : r.ideal_sph,
          };
        }
        return { ...r, order_volume: newVol, waiting_for_picking: newWaiting };
      }
      return r;
    });
    return [...adjusted, ...extraRows];
  }, [flowData, extraMerchants, pickingRates, packingRates, inflowEnabled, overnightVolumes]);

  const [searchParams, setSearchParams] = useSearchParams();

  const activeTab     = searchParams.get("tab")         ?? "flow";
  const flowSubTab    = searchParams.get("flowSub")     ?? "all";
  const perfSubTab    = searchParams.get("perfSub")     ?? "picking";
  const forecastSubTab = searchParams.get("forecastSub") ?? "forecast";

  const setParam = useCallback((key: string, value: string) => {
    setSearchParams((prev) => { const next = new URLSearchParams(prev); next.set(key, value); return next; },
      { replace: true });
  }, [setSearchParams]);

  const setActiveTab      = (v: string) => setParam("tab", v);
  const setFlowSubTab     = (v: string) => setParam("flowSub", v);
  const setPerfSubTab     = (v: string) => setParam("perfSub", v);
  const setForecastSubTab = (v: string) => setParam("forecastSub", v);

  const stats = useMemo(() => {
    const MULTIPLIER = 1.125;
    let adjPickHrs = 0;
    let adjPackHrs = 0;
    let adjVolume = 0;
    let benchmarkedOrders = 0;
    let benchmarkedBacklog = 0;
    for (const r of mergedFlowData) {
      const bl = backlog[r.merchant_name] || 0;
      const effVol = Math.max(0, r.order_volume - bl);
      const effWait = Math.max(0, r.waiting_for_picking - bl);
      const key = r.merchant_name.toLowerCase();
      const pickRate = pickingRates[key];
      const packRate = packingRates[key];
      if (pickRate && packRate && pickRate > 0 && packRate > 0) {
        adjPickHrs += effWait / (pickRate * MULTIPLIER);
        adjPackHrs += effVol / (packRate * MULTIPLIER);
        adjVolume += effVol;
        benchmarkedOrders += r.order_volume;
        benchmarkedBacklog += bl;
      }
    }
    const adjDenom = adjPickHrs + adjPackHrs + (nonProdHeadcount * 8);
    const adjustedSph = adjDenom > 0 ? adjVolume / adjDenom : 0;

    return { totalOrders: benchmarkedOrders, totalPickingHours: adjPickHrs, totalPackingHours: adjPackHrs, merchantCount: mergedFlowData.length, totalPlannedBacklog: benchmarkedBacklog, adjustedSph };
  }, [mergedFlowData, backlog, pickingRates, packingRates, nonProdHeadcount]);

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

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          {/* Mobile navigation: select dropdown */}
          <div className="sm:hidden">
            <select
              value={activeTab}
              onChange={(e) => setActiveTab(e.target.value)}
              className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground"
            >
              {tabItems.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          {/* Tablet/Desktop navigation: scrollable tab list */}
          <div className="hidden sm:block overflow-x-auto">
            <TabsList className="bg-secondary border border-border w-max">
              {tabItems.map(({ value, label, icon: Icon }) => (
                <TabsTrigger key={value} value={value} className="text-xs gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                  <Icon size={14} /> {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <TabsContent value="flow" className="space-y-4">
            <Tabs value={flowSubTab} onValueChange={setFlowSubTab}>
              <div className="sm:hidden">
                <select
                  value={flowSubTab}
                  onChange={(e) => setFlowSubTab(e.target.value)}
                  className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground"
                >
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

              <TabsContent value="all" className="space-y-4">
                <SummaryStats {...stats} nonProdHeadcount={nonProdHeadcount} onResetBacklog={handleResetBacklog} availableHeadcount={availableHeadcount} />
                {isLoading && mergedFlowData.length === 0 ? (
                  <div className="rounded-md border bg-card p-12 flex items-center justify-center gap-2 text-muted-foreground">
                    <Loader2 size={16} className="animate-spin" />
                    <span className="text-sm">Loading live data from Metabase...</span>
                  </div>
                ) : (
                  <FlowManagementTable data={mergedFlowData} pickingRates={pickingRates} packingRates={packingRates} onBacklogChange={handleBacklogChange} externalBacklog={backlog} extraMerchants={extraMerchants} onExtraMerchantsChange={setExtraMerchants} inflowEnabled={inflowEnabled} onInflowToggle={setInflowEnabled} onInflowCsvParsed={setOvernightVolumes} restockCandidates={restockCandidates} onRestockCandidatesDetected={setRestockCandidates} onRestockConfirm={confirmRestockExclusion} onRestockDismiss={dismissRestockCandidates} availableHeadcount={availableHeadcount} />
                )}
              </TabsContent>
              <TabsContent value="zoneA">
                <ZoneView zone="A" flowData={mergedFlowData} timeLeft={0} backlog={backlog} pickingRates={pickingRates} packingRates={packingRates} onBacklogChange={handleBacklogChange} onResetZoneBacklog={handleResetZoneBacklog} availableHeadcount={availableHC_A} onAvailableHeadcountChange={setAvailableHC_A} nonProdHC={nonProdHC_A} onNonProdHCChange={setNonProdHC_A} />
              </TabsContent>
              <TabsContent value="zoneB">
                <ZoneView zone="B" flowData={mergedFlowData} timeLeft={0} backlog={backlog} pickingRates={pickingRates} packingRates={packingRates} onBacklogChange={handleBacklogChange} onResetZoneBacklog={handleResetZoneBacklog} availableHeadcount={availableHC_B} onAvailableHeadcountChange={setAvailableHC_B} nonProdHC={nonProdHC_B} onNonProdHCChange={setNonProdHC_B} />
              </TabsContent>
            </Tabs>
          </TabsContent>

          <TabsContent value="aging">
            <AgingOrders pickingRates={pickingRates} packingRates={packingRates} />
          </TabsContent>

          <TabsContent value="performance" className="space-y-4">
            <Tabs value={perfSubTab} onValueChange={setPerfSubTab}>
              <div className="sm:hidden">
                <select
                  value={perfSubTab}
                  onChange={(e) => setPerfSubTab(e.target.value)}
                  className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground"
                >
                  <option value="picking">Picking Benchmark</option>
                  <option value="packing">Packing Benchmark</option>
                  <option value="tracker">Performance Tracker</option>
                </select>
              </div>
              <div className="hidden sm:block">
                <TabsList className="bg-secondary border border-border">
                  <TabsTrigger value="picking" className="text-xs gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                    <BarChart3 size={14} /> Picking Benchmark
                  </TabsTrigger>
                  <TabsTrigger value="packing" className="text-xs gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                    <Gauge size={14} /> Packing Benchmark
                  </TabsTrigger>
                  <TabsTrigger value="tracker" className="text-xs gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                    <Users size={14} /> Performance Tracker
                  </TabsTrigger>
                </TabsList>
              </div>

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
                  onDeleteUpload={handlePickDelete}
                  liveFlowData={rawMerchants}
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
                  onDeleteUpload={handlePackDelete}
                  liveFlowData={rawMerchants}
                />
              </TabsContent>

              <TabsContent value="tracker">
                <PerformanceTracker />
              </TabsContent>
            </Tabs>
          </TabsContent>

          <TabsContent value="actualsph">
            <ActualSPH pickingRates={pickingRates} packingRates={packingRates} />
          </TabsContent>

          <TabsContent value="reports">
            <Reports
              mergedFlowData={mergedFlowData}
              backlog={backlog}
              pickingRates={pickingRates}
              packingRates={packingRates}
              overallTotalOrders={stats.totalOrders}
              overallTotalBacklog={stats.totalPlannedBacklog}
              overallAdjustedSph={stats.adjustedSph}
              availableHeadcount={availableHeadcount}
              nonProdHeadcount={nonProdHeadcount}
              zoneAHC={availableHC_A}
              zoneBHC={availableHC_B}
              onZoneAHCChange={setAvailableHC_A}
              onZoneBHCChange={setAvailableHC_B}
            />
          </TabsContent>

          <TabsContent value="forecast" className="space-y-4">
            <Tabs value={forecastSubTab} onValueChange={setForecastSubTab}>
              <div className="sm:hidden">
                <select
                  value={forecastSubTab}
                  onChange={(e) => setForecastSubTab(e.target.value)}
                  className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground"
                >
                  <option value="forecast">Forecast</option>
                  <option value="accuracy">Forecast Accuracy</option>
                </select>
              </div>
              <div className="hidden sm:block">
                <TabsList className="bg-secondary border border-border">
                  <TabsTrigger value="forecast" className="text-xs gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                    <CalendarRange size={14} /> Forecast
                  </TabsTrigger>
                  <TabsTrigger value="accuracy" className="text-xs gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                    <TrendingUp size={14} /> Forecast Accuracy
                  </TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="forecast">
                <ForecastManagement pickingRates={pickingRates} packingRates={packingRates} />
              </TabsContent>
              <TabsContent value="accuracy">
                <ForecastAccuracy pickingRates={pickingRates} packingRates={packingRates} />
              </TabsContent>
            </Tabs>
          </TabsContent>
          <TabsContent value="reshuffling">
            <Reshuffling />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

const Index = () => (
  <DashboardProvider>
    <Dashboard />
  </DashboardProvider>
);

export default Index;
