import type { BenchmarkEntry } from "@/types/warehouse";

const MULTIPLIER = 1.125;

/**
 * Replicates pick1/pack1: dedup raw data by key columns
 */
export function deduplicateByKeys<T>(
  data: T[],
  getKey: (row: T) => string
): T[] {
  const seen = new Set<string>();
  return data.filter((row) => {
    const key = getKey(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Replicates pick2/pack2: group by merchant, average top 2 values
 */
export function averageTopTwo(
  data: { merchant_name: string; value: number }[]
): BenchmarkEntry[] {
  const groups: Record<string, number[]> = {};
  for (const row of data) {
    if (!groups[row.merchant_name]) groups[row.merchant_name] = [];
    groups[row.merchant_name].push(row.value);
  }

  return Object.entries(groups).map(([merchant_name, values]) => {
    values.sort((a, b) => b - a);
    const top = values.slice(0, 2);
    const avg = top.reduce((s, v) => s + v, 0) / top.length;
    return { merchant_name, benchmark: Math.round(avg * 100) / 100 };
  });
}

/**
 * Replicates runFullProcess: calculate picking/packing hours and ideal SPH
 */
export function calculateFlowManagement(
  merchants: { merchant_name: string; order_volume: number; waiting_for_picking: number }[],
  pickingRates: Record<string, number>,
  packingRates: Record<string, number>
) {
  return merchants
    .map((m) => {
      const key = m.merchant_name.toLowerCase();
      const pickRate = pickingRates[key];
      const packRate = packingRates[key];

      if (!pickRate || !packRate || pickRate <= 0 || packRate <= 0) return null;

      const pickingHours = m.waiting_for_picking / (pickRate * MULTIPLIER);
      const packingHours = m.order_volume / (packRate * MULTIPLIER);
      const totalHours = pickingHours + packingHours;
      const idealSph = totalHours > 0 ? m.order_volume / totalHours : 0;

      return {
        merchant_name: m.merchant_name,
        order_volume: m.order_volume,
        waiting_for_picking: m.waiting_for_picking,
        picking_hours: Math.round(pickingHours * 100) / 100,
        packing_hours: Math.round(packingHours * 100) / 100,
        ideal_sph: Math.round(idealSph * 100) / 100,
      };
    })
    .filter(Boolean) as {
    merchant_name: string;
    order_volume: number;
    waiting_for_picking: number;
    picking_hours: number;
    packing_hours: number;
    ideal_sph: number;
  }[];
}

/**
 * Build a lookup map from benchmark entries.
 * Keys are normalised to lowercase so that lookups are case-insensitive
 * (e.g. "HAFERLÖWE" and "Haferlöwe" resolve to the same benchmark).
 */
export function buildLookup(benchmarks: BenchmarkEntry[]): Record<string, number> {
  const lookup: Record<string, number> = {};
  for (const b of benchmarks) {
    if (b.benchmark > 0) lookup[b.merchant_name.toLowerCase()] = b.benchmark;
  }
  return lookup;
}
