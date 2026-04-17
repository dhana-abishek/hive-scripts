import { useEffect, useState, useCallback } from "react";
import {
  buildZoneLookup,
  getZoneOverrides,
  setZoneOverrides,
  upsertZoneOverride,
  removeZoneOverride,
  subscribeZoneOverrides,
  type ZoneAssignment,
} from "@/data/zoneMappings";
import { cloudGet, cloudSet } from "@/lib/cloudStorage";

const STORAGE_KEY = "zoneOverrides";
let loadPromise: Promise<void> | null = null;

/** Load overrides from cloud once and apply to the in-memory lookup. */
export function loadZoneOverridesOnce(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const stored = await cloudGet<Record<string, ZoneAssignment>>(STORAGE_KEY);
    if (stored && typeof stored === "object") {
      setZoneOverrides(stored);
    }
  })();
  return loadPromise;
}

/**
 * Subscribe to zone-override changes. Returns the current lookup, plus
 * setters that persist to cloud storage.
 */
export function useZoneOverrides() {
  const [, setVersion] = useState(0);

  useEffect(() => {
    loadZoneOverridesOnce().then(() => setVersion((v) => v + 1));
    const unsub = subscribeZoneOverrides(() => setVersion((v) => v + 1));
    return () => {
      unsub();
    };
  }, []);

  const persist = useCallback(async (next: Record<string, ZoneAssignment>) => {
    await cloudSet(STORAGE_KEY, next);
  }, []);

  const assign = useCallback(
    async (merchant: string, assignment: ZoneAssignment) => {
      upsertZoneOverride(merchant, assignment);
      await persist(getZoneOverrides());
    },
    [persist]
  );

  const unassign = useCallback(
    async (merchant: string) => {
      removeZoneOverride(merchant);
      await persist(getZoneOverrides());
    },
    [persist]
  );

  return {
    lookup: buildZoneLookup(),
    overrides: getZoneOverrides(),
    assign,
    unassign,
  };
}
