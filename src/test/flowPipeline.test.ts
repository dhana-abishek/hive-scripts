import { describe, it, expect } from "vitest";
import {
  averageTopTwo,
  buildLookup,
  calculateFlowManagement,
  deduplicateByKeys,
} from "@/lib/warehouseProcessing";

describe("flow pipeline (dedup → averageTopTwo → buildLookup → calculateFlowManagement)", () => {
  it("derives per-merchant flow rows from raw benchmark history", () => {
    const rawPicking = [
      { merchant_name: "Alpha", worker: "w1", date: "2025-01-01", value: 30 },
      { merchant_name: "Alpha", worker: "w1", date: "2025-01-01", value: 30 },
      { merchant_name: "Alpha", worker: "w2", date: "2025-01-02", value: 50 },
      { merchant_name: "Alpha", worker: "w3", date: "2025-01-03", value: 40 },
      { merchant_name: "Beta", worker: "w1", date: "2025-01-01", value: 20 },
    ];
    const rawPacking = [
      { merchant_name: "Alpha", worker: "w1", date: "2025-01-01", value: 25 },
      { merchant_name: "Alpha", worker: "w2", date: "2025-01-02", value: 35 },
      { merchant_name: "Beta", worker: "w1", date: "2025-01-01", value: 15 },
    ];

    const dedupPicking = deduplicateByKeys(
      rawPicking,
      (r) => `${r.merchant_name}|${r.worker}|${r.date}`,
    );
    expect(dedupPicking).toHaveLength(4);

    const pickBenchmarks = averageTopTwo(dedupPicking);
    const packBenchmarks = averageTopTwo(rawPacking);
    expect(pickBenchmarks.find((b) => b.merchant_name === "Alpha")?.benchmark).toBe(45);
    expect(packBenchmarks.find((b) => b.merchant_name === "Alpha")?.benchmark).toBe(30);

    const pickLookup = buildLookup(pickBenchmarks);
    const packLookup = buildLookup(packBenchmarks);

    const flow = calculateFlowManagement(
      [
        { merchant_name: "Alpha", order_volume: 200, waiting_for_picking: 90 },
        { merchant_name: "Beta", order_volume: 60, waiting_for_picking: 30 },
        { merchant_name: "Gamma", order_volume: 100, waiting_for_picking: 100 },
      ],
      pickLookup,
      packLookup,
    );

    expect(flow.map((f) => f.merchant_name).sort()).toEqual(["Alpha", "Beta"]);

    const alpha = flow.find((r) => r.merchant_name === "Alpha")!;
    expect(alpha.picking_hours).toBeCloseTo(90 / (45 * 1.125), 2);
    expect(alpha.packing_hours).toBeCloseTo(200 / (30 * 1.125), 2);
    expect(alpha.ideal_sph).toBeGreaterThan(0);
    expect(alpha.ideal_sph).toBeLessThan(Math.max(45, 30));
  });

  it("case-insensitively matches merchant names between lookup and flow input", () => {
    const benchmarks = averageTopTwo([
      { merchant_name: "HAFERLÖWE", value: 50 },
      { merchant_name: "HAFERLÖWE", value: 60 },
    ]);
    const lookup = buildLookup(benchmarks);
    const flow = calculateFlowManagement(
      [{ merchant_name: "Haferlöwe", order_volume: 100, waiting_for_picking: 50 }],
      lookup,
      lookup,
    );
    expect(flow).toHaveLength(1);
    expect(flow[0].merchant_name).toBe("Haferlöwe");
  });

  it("drops merchants whose benchmark was filtered out as zero", () => {
    const picks = buildLookup(averageTopTwo([
      { merchant_name: "Dead", value: 0 },
      { merchant_name: "Live", value: 40 },
    ]));
    const packs = buildLookup(averageTopTwo([
      { merchant_name: "Dead", value: 0 },
      { merchant_name: "Live", value: 30 },
    ]));
    const flow = calculateFlowManagement(
      [
        { merchant_name: "Dead", order_volume: 10, waiting_for_picking: 5 },
        { merchant_name: "Live", order_volume: 20, waiting_for_picking: 10 },
      ],
      picks,
      packs,
    );
    expect(flow.map((r) => r.merchant_name)).toEqual(["Live"]);
  });
});
