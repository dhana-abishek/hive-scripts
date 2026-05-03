import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { z } from "zod";
import { pickingBenchmarks as defaultPickingBenchmarks, packingBenchmarks as defaultPackingBenchmarks } from "@/data/warehouseData";
import { calculateFlowManagement, buildLookup } from "@/lib/warehouseProcessing";
import type { BenchmarkEntry } from "@/types/warehouse";
import { parseCSVLine } from "@/lib/csvParser";

import { supabase } from "@/integrations/supabase/client";
import {
  METABASE_REFRESH_INTERVAL_MS,
  METABASE_REFRESH_JITTER_MS,
  METABASE_RETRY_BASE_MS,
  METABASE_RETRY_MAX_MS,
} from "@/lib/constants";

const MerchantAggSchema = z.object({
  merchant_name: z.string().min(1),
  order_volume: z.number().int().nonnegative().finite(),
  waiting_for_picking: z.number().int().nonnegative().finite(),
});
const MerchantAggListSchema = z.array(MerchantAggSchema).min(1);

export type MerchantAgg = z.infer<typeof MerchantAggSchema>;

function parseCSV(text: string): MerchantAgg[] {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];

  // Skip header row
  const merchantMap = new Map<string, { totals: number; waiting: number }>();

  for (let i = 1; i < lines.length; i++) {
    // Parse CSV handling potential commas in quoted fields
    const row = lines[i];
    const cols = parseCSVLine(row);
    if (cols.length < 5) continue;

    const merchant = cols[0].trim();
    const status = cols[1].trim();
    const shipmentCount = parseInt(cols[2], 10) || 0;
    const totals = parseInt(cols[4], 10) || 0;

    if (!merchantMap.has(merchant)) {
      merchantMap.set(merchant, { totals, waiting: 0 });
    }

    const entry = merchantMap.get(merchant)!;
    entry.totals = totals; // totals is the same for all rows of a merchant

    if (status === "waiting_for_picking" || status === "needs_reshuffling") {
      entry.waiting += shipmentCount;
    }
  }

  return Array.from(merchantMap.entries()).map(([name, data]) => ({
    merchant_name: name,
    order_volume: data.totals,
    waiting_for_picking: data.waiting,
  }));
}


export interface MetabaseDataResult {
  flowData: ReturnType<typeof calculateFlowManagement>;
  rawMerchants: MerchantAgg[];
  pickingRates: Record<string, number>;
  packingRates: Record<string, number>;
  isLoading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  refresh: () => void;
}

async function readEdgeText(data: unknown): Promise<string> {
  if (typeof data === "string") return data;
  if (data instanceof Blob) return data.text();
  if (data && typeof data === "object" && "text" in data && typeof (data as { text: unknown }).text === "function") {
    return (data as { text: () => Promise<string> }).text();
  }
  throw new Error("Unexpected edge function payload");
}

export function useMetabaseData(customPicking?: BenchmarkEntry[] | null, customPacking?: BenchmarkEntry[] | null): MetabaseDataResult {
  const [rawMerchants, setRawMerchants] = useState<MerchantAgg[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failureCountRef = useRef(0);
  const cancelledRef = useRef(false);

  const pickLookup = useMemo(() => buildLookup(customPicking ?? defaultPickingBenchmarks), [customPicking]);
  const packLookup = useMemo(() => buildLookup(customPacking ?? defaultPackingBenchmarks), [customPacking]);

  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const { data, error: fnError } = await supabase.functions.invoke("fetch-metabase-csv");
      if (fnError) throw new Error(fnError.message || "Edge function error");

      const text = await readEdgeText(data);
      const parsed = parseCSV(text);
      const merchants = MerchantAggListSchema.parse(parsed);

      setRawMerchants(merchants);
      setLastUpdated(new Date());
      failureCountRef.current = 0;
    } catch (err) {
      failureCountRef.current += 1;
      if (err instanceof z.ZodError) {
        setError(`Invalid Metabase response: ${err.issues[0]?.message ?? "schema mismatch"}`);
      } else {
        setError(err instanceof Error ? err.message : "Failed to fetch data");
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    const tick = async () => {
      await fetchData();
      if (cancelledRef.current) return;
      // Successful runs poll at the steady refresh interval; failures back off
      // exponentially up to METABASE_RETRY_MAX_MS to avoid hammering a degraded
      // edge function. Jitter prevents synchronised stampedes across clients.
      const failures = failureCountRef.current;
      const base = failures === 0
        ? METABASE_REFRESH_INTERVAL_MS
        : Math.min(METABASE_RETRY_BASE_MS * 2 ** (failures - 1), METABASE_RETRY_MAX_MS);
      const jitter = Math.random() * METABASE_REFRESH_JITTER_MS;
      timeoutRef.current = setTimeout(tick, base + jitter);
    };
    void tick();
    return () => {
      cancelledRef.current = true;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [fetchData]);

  const flowData = useMemo(
    () => buildFlowData(rawMerchants, pickLookup, packLookup),
    [rawMerchants, pickLookup, packLookup]
  );

  return { flowData, rawMerchants, pickingRates: pickLookup, packingRates: packLookup, isLoading, error, lastUpdated, refresh: fetchData };
}

/**
 * Build flow data rows for all merchants, blending benchmarked (rate-driven)
 * and unbenchmarked (weighted-average ideal SPH) calculations. Exported so
 * callers can recompute when manual benchmark overrides change.
 */
export function buildFlowData(
  rawMerchants: MerchantAgg[],
  pickLookup: Record<string, number>,
  packLookup: Record<string, number>
) {
  if (rawMerchants.length === 0) return [];
  const benchmarked = calculateFlowManagement(rawMerchants, pickLookup, packLookup);

  let totalVol = 0;
  let totalHrs = 0;
  for (const r of benchmarked) {
    totalVol += r.order_volume;
    totalHrs += r.picking_hours + r.packing_hours;
  }
  const weightedAvgSph = totalHrs > 0 ? totalVol / totalHrs : 0;

  const benchmarkedNames = new Set(benchmarked.map((r) => r.merchant_name));
  const unbenchmarkedRows = rawMerchants
    .filter((m) => !benchmarkedNames.has(m.merchant_name))
    .map((m) => {
      const pickRatio =
        totalHrs > 0
          ? benchmarked.reduce((s, r) => s + r.picking_hours, 0) / totalHrs
          : 0.5;
      const totalMerchantHrs = weightedAvgSph > 0 ? m.order_volume / weightedAvgSph : 0;
      const pickHrs = totalMerchantHrs * pickRatio;
      const packHrs = totalMerchantHrs * (1 - pickRatio);
      return {
        merchant_name: m.merchant_name,
        order_volume: m.order_volume,
        waiting_for_picking: m.waiting_for_picking,
        picking_hours: Math.round(pickHrs * 100) / 100,
        packing_hours: Math.round(packHrs * 100) / 100,
        ideal_sph: Math.round(weightedAvgSph * 100) / 100,
      };
    });

  const all = [...benchmarked, ...unbenchmarkedRows];
  all.sort((a, b) => b.order_volume - a.order_volume);
  return all;
}
