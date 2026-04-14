import { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from "react";
import type { BenchmarkUpload } from "@/components/BenchmarkTable";
import type { ExtraMerchant } from "@/components/PerformanceTracker";
import { cloudGet as idbGet, cloudSet as idbSet, cloudRemove as idbRemove } from "@/lib/cloudStorage";
import { buildZoneLookup } from "@/data/zoneMappings";

const PICK_UPLOADS_KEY = "pickBenchmarkUploads";
const PICK_ACTIVE_KEY = "pickBenchmarkActiveId";
const PACK_UPLOADS_KEY = "packBenchmarkUploads";
const PACK_ACTIVE_KEY = "packBenchmarkActiveId";
const INFLOW_ENABLED_KEY = "inflowEnabled";
const OVERNIGHT_VOLUMES_KEY = "overnightVolumes";

interface DashboardState {
  nonProdHeadcount: number;
  nonProdHC_A: number;
  nonProdHC_B: number;
  availableHC_A: number;
  availableHC_B: number;
  availableHeadcount: number;
  extraMerchants: ExtraMerchant[];
  inflowEnabled: boolean;
  overnightVolumes: Record<string, number>;
  /** Restock orders detected from the CSV, pending user confirmation to exclude. */
  restockCandidates: Record<string, number>;
  pickUploads: BenchmarkUpload[];
  pickActiveId: string | null;
  packUploads: BenchmarkUpload[];
  packActiveId: string | null;
  backlog: Record<string, number>;
}

interface DashboardActions {
  setNonProdHC_A: (val: number) => void;
  setNonProdHC_B: (val: number) => void;
  setAvailableHC_A: (val: number) => void;
  setAvailableHC_B: (val: number) => void;
  setExtraMerchants: (m: ExtraMerchant[]) => void;
  setInflowEnabled: (enabled: boolean) => void;
  setOvernightVolumes: (volumes: Record<string, number>) => void;
  setRestockCandidates: (candidates: Record<string, number>) => void;
  /** User confirms — subtract restock candidates from overnight volumes and persist. */
  confirmRestockExclusion: () => void;
  /** User dismisses — clear candidates without changing overnight volumes. */
  dismissRestockCandidates: () => void;
  handlePickNewUpload: (upload: BenchmarkUpload) => Promise<void>;
  handlePickSelect: (id: string) => Promise<void>;
  handlePickRename: (id: string, newName: string) => Promise<void>;
  handlePickDelete: (id: string) => Promise<void>;
  handlePackNewUpload: (upload: BenchmarkUpload) => Promise<void>;
  handlePackSelect: (id: string) => Promise<void>;
  handlePackRename: (id: string, newName: string) => Promise<void>;
  handlePackDelete: (id: string) => Promise<void>;
  handleBacklogChange: (updated: Record<string, number>) => void;
  handleResetBacklog: () => void;
  handleResetZoneBacklog: (zone: "A" | "B") => void;
}

type DashboardContextType = DashboardState & DashboardActions;

const DashboardContext = createContext<DashboardContextType | null>(null);

export function useDashboard(): DashboardContextType {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error("useDashboard must be used within DashboardProvider");
  return ctx;
}

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [nonProdHC_A, setNonProdHC_A_Raw] = useState(6);
  const [nonProdHC_B, setNonProdHC_B_Raw] = useState(6);
  const [availableHC_A, setAvailableHC_A_Raw] = useState(0);
  const [availableHC_B, setAvailableHC_B_Raw] = useState(0);
  const [extraMerchants, setExtraMerchants] = useState<ExtraMerchant[]>([]);
  const [inflowEnabled, setInflowEnabledRaw] = useState(false);
  const [overnightVolumes, setOvernightVolumesRaw] = useState<Record<string, number>>({});
  const [restockCandidates, setRestockCandidatesRaw] = useState<Record<string, number>>({});
  const [pickUploads, setPickUploads] = useState<BenchmarkUpload[]>([]);
  const [pickActiveId, setPickActiveId] = useState<string | null>(null);
  const [packUploads, setPackUploads] = useState<BenchmarkUpload[]>([]);
  const [packActiveId, setPackActiveId] = useState<string | null>(null);
  const [backlog, setBacklog] = useState<Record<string, number>>({});

  const nonProdHeadcount = nonProdHC_A + nonProdHC_B;
  const availableHeadcount = availableHC_A + availableHC_B;

  // Load all persisted state on mount
  useEffect(() => {
    (async () => {
      const [pu, pa, pku, pka, em, ahcA, ahcB, npA, npB, ie, ov, bl] = await Promise.all([
        idbGet<BenchmarkUpload[]>(PICK_UPLOADS_KEY),
        idbGet<string>(PICK_ACTIVE_KEY),
        idbGet<BenchmarkUpload[]>(PACK_UPLOADS_KEY),
        idbGet<string>(PACK_ACTIVE_KEY),
        idbGet<ExtraMerchant[]>("perfExtraMerchants"),
        idbGet<number>("availableHC_zoneA"),
        idbGet<number>("availableHC_zoneB"),
        idbGet<number>("nonProdHC_zoneA"),
        idbGet<number>("nonProdHC_zoneB"),
        idbGet<boolean>(INFLOW_ENABLED_KEY),
        idbGet<Record<string, number>>(OVERNIGHT_VOLUMES_KEY),
        idbGet<Record<string, number>>("plannedBacklog"),
      ]);
      if (pu) setPickUploads(pu);
      if (pa) setPickActiveId(pa);
      if (pku) setPackUploads(pku);
      if (pka) setPackActiveId(pka);
      if (em) setExtraMerchants(em);
      if (ahcA !== null) setAvailableHC_A_Raw(ahcA);
      if (ahcB !== null) setAvailableHC_B_Raw(ahcB);
      if (npA !== null) setNonProdHC_A_Raw(npA);
      if (npB !== null) setNonProdHC_B_Raw(npB);
      if (ie !== null) setInflowEnabledRaw(ie);
      if (ov) setOvernightVolumesRaw(ov);
      if (bl) setBacklog(bl);
    })();
  }, []);

  // Auto-correct active pick/pack IDs
  useEffect(() => {
    if (pickUploads.length === 0) {
      if (pickActiveId !== null) { setPickActiveId(null); void idbRemove(PICK_ACTIVE_KEY); }
      return;
    }
    if (!pickActiveId || !pickUploads.some((u) => u.id === pickActiveId)) {
      const fallbackId = pickUploads[pickUploads.length - 1].id;
      setPickActiveId(fallbackId);
      void idbSet(PICK_ACTIVE_KEY, fallbackId);
    }
  }, [pickUploads, pickActiveId]);

  useEffect(() => {
    if (packUploads.length === 0) {
      if (packActiveId !== null) { setPackActiveId(null); void idbRemove(PACK_ACTIVE_KEY); }
      return;
    }
    if (!packActiveId || !packUploads.some((u) => u.id === packActiveId)) {
      const fallbackId = packUploads[packUploads.length - 1].id;
      setPackActiveId(fallbackId);
      void idbSet(PACK_ACTIVE_KEY, fallbackId);
    }
  }, [packUploads, packActiveId]);

  // Persisted setters
  const setNonProdHC_A = useCallback((val: number) => {
    setNonProdHC_A_Raw(val);
    idbSet("nonProdHC_zoneA", val);
  }, []);

  const setNonProdHC_B = useCallback((val: number) => {
    setNonProdHC_B_Raw(val);
    idbSet("nonProdHC_zoneB", val);
  }, []);

  const setAvailableHC_A = useCallback((val: number) => {
    setAvailableHC_A_Raw(val);
    idbSet("availableHC_zoneA", val);
  }, []);

  const setAvailableHC_B = useCallback((val: number) => {
    setAvailableHC_B_Raw(val);
    idbSet("availableHC_zoneB", val);
  }, []);

  const setInflowEnabled = useCallback((enabled: boolean) => {
    setInflowEnabledRaw(enabled);
    if (enabled) {
      void idbSet(INFLOW_ENABLED_KEY, true);
    } else {
      void idbRemove(INFLOW_ENABLED_KEY);
      void idbRemove(OVERNIGHT_VOLUMES_KEY);
    }
  }, []);

  const setOvernightVolumes = useCallback((volumes: Record<string, number>) => {
    setOvernightVolumesRaw(volumes);
    if (Object.keys(volumes).length > 0) {
      void idbSet(OVERNIGHT_VOLUMES_KEY, volumes);
    } else {
      void idbRemove(OVERNIGHT_VOLUMES_KEY);
    }
  }, []);

  const setRestockCandidates = useCallback((candidates: Record<string, number>) => {
    setRestockCandidatesRaw(candidates);
  }, []);

  const confirmRestockExclusion = useCallback(() => {
    setOvernightVolumesRaw((prev) => {
      const updated: Record<string, number> = {};
      for (const [merchant, count] of Object.entries(prev)) {
        const restock = restockCandidates[merchant] || 0;
        const effective = Math.max(0, count - restock);
        if (effective > 0) updated[merchant] = effective;
      }
      if (Object.keys(updated).length > 0) {
        void idbSet(OVERNIGHT_VOLUMES_KEY, updated);
      } else {
        void idbRemove(OVERNIGHT_VOLUMES_KEY);
      }
      return updated;
    });
    setRestockCandidatesRaw({});
  }, [restockCandidates]);

  const dismissRestockCandidates = useCallback(() => {
    setRestockCandidatesRaw({});
  }, []);

  // Pick handlers
  const handlePickNewUpload = useCallback(async (upload: BenchmarkUpload) => {
    const next = [...pickUploads, upload];
    await Promise.all([idbSet(PICK_UPLOADS_KEY, next), idbSet(PICK_ACTIVE_KEY, upload.id)]);
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
    await Promise.all([idbSet(PICK_UPLOADS_KEY, next), newActiveId ? idbSet(PICK_ACTIVE_KEY, newActiveId) : idbRemove(PICK_ACTIVE_KEY)]);
    setPickUploads(next);
    setPickActiveId(newActiveId);
  }, [pickUploads, pickActiveId]);

  // Pack handlers
  const handlePackNewUpload = useCallback(async (upload: BenchmarkUpload) => {
    const next = [...packUploads, upload];
    await Promise.all([idbSet(PACK_UPLOADS_KEY, next), idbSet(PACK_ACTIVE_KEY, upload.id)]);
    setPackUploads(next);
    setPackActiveId(upload.id);
  }, [packUploads]);

  const handlePackSelect = useCallback(async (id: string) => {
    await idbSet(PACK_ACTIVE_KEY, id);
    setPackActiveId(id);
  }, []);

  const handlePackRename = useCallback(async (id: string, newName: string) => {
    const next = packUploads.map((u) => u.id === id ? { ...u, name: newName } : u);
    await idbSet(PACK_UPLOADS_KEY, next);
    setPackUploads(next);
  }, [packUploads]);

  const handlePackDelete = useCallback(async (id: string) => {
    const next = packUploads.filter((u) => u.id !== id);
    const newActiveId = packActiveId === id ? (next.length > 0 ? next[next.length - 1].id : null) : packActiveId;
    await Promise.all([idbSet(PACK_UPLOADS_KEY, next), newActiveId ? idbSet(PACK_ACTIVE_KEY, newActiveId) : idbRemove(PACK_ACTIVE_KEY)]);
    setPackUploads(next);
    setPackActiveId(newActiveId);
  }, [packUploads, packActiveId]);

  // Backlog handlers
  const handleBacklogChange = useCallback((updated: Record<string, number>) => {
    setBacklog(updated);
  }, []);

  const handleResetBacklog = useCallback(() => {
    setBacklog({});
    idbSet("plannedBacklog", {});
  }, []);

  const handleResetZoneBacklog = useCallback((zone: "A" | "B") => {
    const lookup = buildZoneLookup();
    setBacklog((prev) => {
      const updated = { ...prev };
      for (const merchant of Object.keys(updated)) {
        if (lookup[merchant]?.zone === zone) {
          updated[merchant] = 0;
        }
      }
      idbSet("plannedBacklog", updated);
      return updated;
    });
  }, []);

  const value = useMemo<DashboardContextType>(() => ({
    nonProdHeadcount, nonProdHC_A, nonProdHC_B, availableHC_A, availableHC_B, availableHeadcount,
    extraMerchants, inflowEnabled, overnightVolumes, restockCandidates,
    pickUploads, pickActiveId, packUploads, packActiveId,
    backlog,
    setNonProdHC_A, setNonProdHC_B, setAvailableHC_A, setAvailableHC_B,
    setExtraMerchants, setInflowEnabled, setOvernightVolumes,
    setRestockCandidates, confirmRestockExclusion, dismissRestockCandidates,
    handlePickNewUpload, handlePickSelect, handlePickRename, handlePickDelete,
    handlePackNewUpload, handlePackSelect, handlePackRename, handlePackDelete,
    handleBacklogChange, handleResetBacklog, handleResetZoneBacklog,
  }), [
    nonProdHeadcount, nonProdHC_A, nonProdHC_B, availableHC_A, availableHC_B, availableHeadcount,
    extraMerchants, inflowEnabled, overnightVolumes, restockCandidates,
    pickUploads, pickActiveId, packUploads, packActiveId,
    backlog,
    setNonProdHC_A, setNonProdHC_B, setAvailableHC_A, setAvailableHC_B,
    setInflowEnabled, setOvernightVolumes,
    setRestockCandidates, confirmRestockExclusion, dismissRestockCandidates,
    handlePickNewUpload, handlePickSelect, handlePickRename, handlePickDelete,
    handlePackNewUpload, handlePackSelect, handlePackRename, handlePackDelete,
    handleBacklogChange, handleResetBacklog, handleResetZoneBacklog,
  ]);

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}
