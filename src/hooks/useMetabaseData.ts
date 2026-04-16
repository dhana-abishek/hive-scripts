import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { pickingBenchmarks as defaultPickingBenchmarks, packingBenchmarks as defaultPackingBenchmarks } from "@/data/warehouseData";
import { calculateFlowManagement, buildLookup } from "@/lib/warehouseProcessing";
import type { BenchmarkEntry } from "@/types/warehouse";
import { parseCSVLine } from "@/lib/csvParser";

import { supabase } from "@/integrations/supabase/client";
const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

export interface MerchantAgg {
  merchant_name: string;
  order_volume: number;
  waiting_for_picking: number;
}

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

export function useMetabaseData(customPicking?: BenchmarkEntry[] | null, customPacking?: BenchmarkEntry[] | null): MetabaseDataResult {
  const [rawMerchants, setRawMerchants] = useState<MerchantAgg[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pickLookup = useMemo(() => buildLookup(customPicking ?? defaultPickingBenchmarks), [customPicking]);
  const packLookup = useMemo(() => buildLookup(customPacking ?? defaultPackingBenchmarks), [customPacking]);

  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const { data, error: fnError } = await supabase.functions.invoke("fetch-metabase-csv");
      if (fnError) throw new Error(fnError.message || "Edge function error");

      const text = typeof data === "string" ? data : await data.text();
      const merchants = parseCSV(text);

      if (merchants.length === 0) {
        throw new Error("No data returned from Metabase");
      }

      setRawMerchants(merchants);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch data");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const flowData = useMemo(() => {
    if (rawMerchants.length === 0) return [];
    const benchmarked = calculateFlowManagement(rawMerchants, pickLookup, packLookup);

    // Compute weighted average ideal SPH from benchmarked merchants
    let totalVol = 0;
    let totalHrs = 0;
    for (const r of benchmarked) {
      totalVol += r.order_volume;
      totalHrs += r.picking_hours + r.packing_hours;
    }
    const weightedAvgSph = totalHrs > 0 ? totalVol / totalHrs : 0;

    // Find unbenchmarked merchants (no pick or pack rate)
    const benchmarkedNames = new Set(benchmarked.map(r => r.merchant_name));
    const unbenchmarkedRows = rawMerchants
      .filter(m => !benchmarkedNames.has(m.merchant_name))
      .map(m => {
        // Use weighted avg SPH to derive total hours, split proportionally
        const pickRatio = totalHrs > 0 ? (benchmarked.reduce((s, r) => s + r.picking_hours, 0) / totalHrs) : 0.5;
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
  }, [rawMerchants, pickLookup, packLookup]);

  return { flowData, rawMerchants, pickingRates: pickLookup, packingRates: packLookup, isLoading, error, lastUpdated, refresh: fetchData };
}
