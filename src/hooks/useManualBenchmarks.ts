import { useEffect, useState, useCallback } from "react";
import { cloudGet, cloudSet } from "@/lib/cloudStorage";

const STORAGE_KEY = "manualBenchmarks";

export interface ManualBenchmark {
  pick?: number;
  pack?: number;
}

export type ManualBenchmarks = Record<string, ManualBenchmark>;

/**
 * Cloud-backed manual pick/pack rate overrides keyed by merchant name (lowercase).
 * Used to fill in benchmarks for merchants that don't have one in the uploaded
 * benchmark sheet — falling back to the weighted-average ideal SPH otherwise.
 */
export function useManualBenchmarks() {
  const [manual, setManual] = useState<ManualBenchmarks>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const stored = await cloudGet<ManualBenchmarks>(STORAGE_KEY);
      if (stored && typeof stored === "object") setManual(stored);
      setLoaded(true);
    })();
  }, []);

  const setMerchantBenchmark = useCallback(
    async (merchantName: string, pick: number | null, pack: number | null) => {
      const key = merchantName.toLowerCase();
      setManual((prev) => {
        const next = { ...prev };
        const entry: ManualBenchmark = {};
        if (pick && pick > 0) entry.pick = pick;
        if (pack && pack > 0) entry.pack = pack;
        if (entry.pick === undefined && entry.pack === undefined) {
          delete next[key];
        } else {
          next[key] = entry;
        }
        void cloudSet(STORAGE_KEY, next);
        return next;
      });
    },
    []
  );

  const clearMerchantBenchmark = useCallback(async (merchantName: string) => {
    const key = merchantName.toLowerCase();
    setManual((prev) => {
      const next = { ...prev };
      delete next[key];
      void cloudSet(STORAGE_KEY, next);
      return next;
    });
  }, []);

  return { manual, loaded, setMerchantBenchmark, clearMerchantBenchmark };
}

/** Merge manual overrides into a rates lookup. Manual values take precedence. */
export function mergeManualRates(
  baseRates: Record<string, number>,
  manual: ManualBenchmarks,
  field: "pick" | "pack"
): Record<string, number> {
  const merged = { ...baseRates };
  for (const [key, entry] of Object.entries(manual)) {
    const v = entry[field];
    if (v && v > 0) merged[key] = v;
  }
  return merged;
}
