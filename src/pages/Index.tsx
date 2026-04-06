import { useMemo, useState, useCallback, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Package, BarChart3, Gauge, Activity, RefreshCw, Loader2, MapPin, CalendarClock, Users } from "lucide-react";
import { SummaryStats } from "@/components/SummaryStats";
import { FlowManagementTable } from "@/components/FlowManagementTable";
import { BenchmarkTable, type BenchmarkUpload } from "@/components/BenchmarkTable";
import { ZoneView } from "@/components/ZoneView";
import { AgingOrders } from "@/components/AgingOrders";
import { PerformanceTracker } from "@/components/PerformanceTracker";
import { pickingBenchmarks as defaultPickingBenchmarks, packingBenchmarks as defaultPackingBenchmarks } from "@/data/warehouseData";
import { buildZoneLookup } from "@/data/zoneMappings";
import { useMetabaseData } from "@/hooks/useMetabaseData";
import type { BenchmarkEntry } from "@/types/warehouse";
import { cloudGet as idbGet, cloudSet as idbSet, cloudRemove as idbRemove } from "@/lib/cloudStorage";
import { getInflowFactor } from "@/lib/inflowEstimation";
import type { ExtraMerchant } from "@/components/PerformanceTracker";

const PICK_UPLOADS_KEY = "pickBenchmarkUploads";
const PICK_ACTIVE_KEY = "pickBenchmarkActiveId";
const PACK_UPLOADS_KEY = "packBenchmarkUploads";
const PACK_ACTIVE_KEY = "packBenchmarkActiveId";

const Index = () => {
  const [nonProdHeadcount, setNonProdHeadcount] = useState(12);
  const [extraMerchants, setExtraMerchants] = useState<ExtraMerchant[]>([]);
  const [inflowEnabled, setInflowEnabled] = useState(false);
  const [pickUploads, setPickUploads] = useState<BenchmarkUpload[]>([]);
  const [pickActiveId, setPickActiveId] = useState<string | null>(null);
  const [packUploads, setPackUploads] = useState<BenchmarkUpload[]>([]);
  const [packActiveId, setPackActiveId] = useState<string | null>(null);
  // Load all from IndexedDB on mount
  useEffect(() => {
    (async () => {
      const [pu, pa, pku, pka, hc, em] = await Promise.all([
        idbGet<BenchmarkUpload[]>(PICK_UPLOADS_KEY),
        idbGet<string>(PICK_ACTIVE_KEY),
        idbGet<BenchmarkUpload[]>(PACK_UPLOADS_KEY),
        idbGet<string>(PACK_ACTIVE_KEY),
        idbGet<number>("nonProdHC_main"),
        idbGet<ExtraMerchant[]>("perfExtraMerchants"),
      ]);
      if (pu) setPickUploads(pu);
      if (pa) setPickActiveId(pa);
      if (pku) setPackUploads(pku);
      if (pka) setPackActiveId(pka);
      if (hc !== null) setNonProdHeadcount(hc);
      if (em) setExtraMerchants(em);
    })();
  }, []);

  useEffect(() => {
    if (pickUploads.length === 0) {
      if (pickActiveId !== null) {
        setPickActiveId(null);
        void idbRemove(PICK_ACTIVE_KEY);
      }
      return;
    }

    if (!pickActiveId || !pickUploads.some((upload) => upload.id === pickActiveId)) {
      const fallbackId = pickUploads[pickUploads.length - 1].id;
      setPickActiveId(fallbackId);
      void idbSet(PICK_ACTIVE_KEY, fallbackId);
    }
  }, [pickUploads, pickActiveId]);

  useEffect(() => {
    if (packUploads.length === 0) {
      if (packActiveId !== null) {
        setPackActiveId(null);
        void idbRemove(PACK_ACTIVE_KEY);
      }
      return;
    }

    if (!packActiveId || !packUploads.some((upload) => upload.id === packActiveId)) {
      const fallbackId = packUploads[packUploads.length - 1].id;
      setPackActiveId(fallbackId);
      void idbSet(PACK_ACTIVE_KEY, fallbackId);
    }
  }, [packUploads, packActiveId]);

  const activePick = pickUploads.find((u) => u.id === pickActiveId);
  const activePack = packUploads.find((u) => u.id === packActiveId);

  const pickingBenchmarks = activePick?.entries ?? defaultPickingBenchmarks;
  const packingBenchmarks = activePack?.entries ?? defaultPackingBenchmarks;

  const { flowData, pickingRates, packingRates, isLoading, error, lastUpdated, refresh } = useMetabaseData(
    activePick?.entries ?? null,
    activePack?.entries ?? null
  );

  // Merge extra merchants into flowData as additional rows
  const mergedFlowData = useMemo(() => {
    const existing = new Set(flowData.map(r => r.merchant_name));
    const extraRows = extraMerchants
      .filter(m => !existing.has(m.name))
      .map(m => {
        const pickRate = pickingRates[m.name];
        const packRate = packingRates[m.name];
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
      if (!extra) return r;
      const newVol = r.order_volume + extra.orderVolume;
      const newWaiting = r.waiting_for_picking + extra.orderVolume;
      const pickRate = pickingRates[r.merchant_name];
      const packRate = packingRates[r.merchant_name];
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
    });
    return [...adjusted, ...extraRows];
  }, [flowData, extraMerchants, pickingRates, packingRates]);

  const handleNonProdChange = (val: number) => {
    setNonProdHeadcount(val);
    idbSet("nonProdHC_main", val);
  };

  // Pick handlers
  const handlePickNewUpload = useCallback(async (upload: BenchmarkUpload) => {
    const next = [...pickUploads, upload];
    await Promise.all([
      idbSet(PICK_UPLOADS_KEY, next),
      idbSet(PICK_ACTIVE_KEY, upload.id),
    ]);
    setPickUploads(next);
    setPickActiveId(upload.id);
  }, [pickUploads]);

  const handlePickSelect = useCallback(async (id: string) => {
    await idbSet(PICK_ACTIVE_KEY, id);
    setPickActiveId(id);
  }, []);

  const handlePickRename = useCallback(async (id: string, newName: string) => {
    const next = pickUploads.map((u) => u.id === id ? { ...u, name: newName } : u);
    await idbSet(PICK_UPLOADS_KEY, next);
    setPickUploads(next);
  }, [pickUploads]);

  const handlePickDelete = useCallback(async (id: string) => {
    const next = pickUploads.filter((u) => u.id !== id);
    const newActiveId = pickActiveId === id ? (next.length > 0 ? next[next.length - 1].id : null) : pickActiveId;

    await Promise.all([
      idbSet(PICK_UPLOADS_KEY, next),
      newActiveId ? idbSet(PICK_ACTIVE_KEY, newActiveId) : idbRemove(PICK_ACTIVE_KEY),
    ]);

    setPickUploads(next);
    setPickActiveId(newActiveId);
  }, [pickUploads, pickActiveId]);

  // Pack handlers
  const handlePackNewUpload = useCallback(async (upload: BenchmarkUpload) => {
    const next = [...packUploads, upload];
    await Promise.all([
      idbSet(PACK_UPLOADS_KEY, next),
      idbSet(PACK_ACTIVE_KEY, upload.id),
    ]);
    setPackUploads(next);
    setPackActiveId(upload.id);
  }, [packUploads]);

  const handlePackDelete = useCallback(async (id: string) => {
    const next = packUploads.filter((u) => u.id !== id);
    const newActiveId = packActiveId === id ? (next.length > 0 ? next[next.length - 1].id : null) : packActiveId;

    await Promise.all([
      idbSet(PACK_UPLOADS_KEY, next),
      newActiveId ? idbSet(PACK_ACTIVE_KEY, newActiveId) : idbRemove(PACK_ACTIVE_KEY),
    ]);

    setPackUploads(next);
    setPackActiveId(newActiveId);
  }, [packUploads, packActiveId]);

  const handlePackSelect = useCallback(async (id: string) => {
    await idbSet(PACK_ACTIVE_KEY, id);
    setPackActiveId(id);
  }, []);

  const handlePackRename = useCallback(async (id: string, newName: string) => {
    const next = packUploads.map((u) => u.id === id ? { ...u, name: newName } : u);
    await idbSet(PACK_UPLOADS_KEY, next);
    setPackUploads(next);
  }, [packUploads]);

  const [backlog, setBacklog] = useState<Record<string, number>>({});

  // Load backlog from IDB
  useEffect(() => {
    idbGet<Record<string, number>>("plannedBacklog").then((v) => { if (v) setBacklog(v); });
  }, []);

  const handleBacklogChange = useCallback((updated: Record<string, number>) => {
    setBacklog(updated);
  }, []);

  const handleResetBacklog = useCallback(() => {
    setBacklog({});
    idbSet("plannedBacklog", {});
  }, []);

  const handleResetZoneBacklog = useCallback((zone: "A" | "B") => {
    const lookup = buildZoneLookup();
    const updated = { ...backlog };
    for (const merchant of Object.keys(updated)) {
      if (lookup[merchant]?.zone === zone) {
        updated[merchant] = 0;
      }
    }
    setBacklog(updated);
    idbSet("plannedBacklog", updated);
  }, [backlog]);
  const stats = useMemo(() => {
    const totalOrders = mergedFlowData.reduce((s, r) => s + r.order_volume, 0);
    const totalPlannedBacklog = mergedFlowData.reduce((s, r) => s + (backlog[r.merchant_name] || 0), 0);

    const MULTIPLIER = 1.125;
    let adjPickHrs = 0;
    let adjPackHrs = 0;
    let adjVolume = 0;
    for (const r of mergedFlowData) {
      const bl = backlog[r.merchant_name] || 0;
      const effVol = Math.max(0, r.order_volume - bl);
      const effWait = Math.max(0, r.waiting_for_picking - bl);
      const pickRate = pickingRates[r.merchant_name];
      const packRate = packingRates[r.merchant_name];
      if (pickRate && packRate && pickRate > 0 && packRate > 0) {
        adjPickHrs += effWait / (pickRate * MULTIPLIER);
        adjPackHrs += effVol / (packRate * MULTIPLIER);
        adjVolume += effVol;
      }
    }
    const adjDenom = adjPickHrs + adjPackHrs + (nonProdHeadcount * 8);
    const adjustedSph = adjDenom > 0 ? adjVolume / adjDenom : 0;

    return { totalOrders, totalPickingHours: adjPickHrs, totalPackingHours: adjPackHrs, merchantCount: mergedFlowData.length, totalPlannedBacklog, adjustedSph };
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
            <TabsTrigger value="aging" className="text-xs gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <CalendarClock size={14} /> Aging Orders
            </TabsTrigger>
            <TabsTrigger value="performance" className="text-xs gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <Users size={14} /> Performance Tracker
            </TabsTrigger>
          </TabsList>

          <TabsContent value="flow" className="space-y-4">
            <SummaryStats {...stats} nonProdHeadcount={nonProdHeadcount} onNonProdHeadcountChange={handleNonProdChange} onResetBacklog={handleResetBacklog} />
            {isLoading && mergedFlowData.length === 0 ? (
              <div className="rounded-md border bg-card p-12 flex items-center justify-center gap-2 text-muted-foreground">
                <Loader2 size={16} className="animate-spin" />
                <span className="text-sm">Loading live data from Metabase...</span>
              </div>
            ) : (
              <FlowManagementTable data={mergedFlowData} pickingRates={pickingRates} packingRates={packingRates} onBacklogChange={handleBacklogChange} externalBacklog={backlog} extraMerchants={extraMerchants} onExtraMerchantsChange={setExtraMerchants} />
            )}
          </TabsContent>
          <TabsContent value="zoneA">
            <ZoneView zone="A" flowData={mergedFlowData} timeLeft={0} backlog={backlog} pickingRates={pickingRates} packingRates={packingRates} onBacklogChange={handleBacklogChange} onResetZoneBacklog={handleResetZoneBacklog} />
          </TabsContent>
          <TabsContent value="zoneB">
            <ZoneView zone="B" flowData={mergedFlowData} timeLeft={0} backlog={backlog} pickingRates={pickingRates} packingRates={packingRates} onBacklogChange={handleBacklogChange} onResetZoneBacklog={handleResetZoneBacklog} />
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
              onDeleteUpload={handlePickDelete}
              liveFlowData={mergedFlowData}
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
              liveFlowData={mergedFlowData}
            />
          </TabsContent>

          <TabsContent value="aging">
            <AgingOrders pickingRates={pickingRates} packingRates={packingRates} />
          </TabsContent>

          <TabsContent value="performance">
            <PerformanceTracker />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default Index;
