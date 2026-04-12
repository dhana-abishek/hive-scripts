import { describe, it, expect } from "vitest";
import { deduplicateByKeys, averageTopTwo, calculateFlowManagement, buildLookup } from "@/lib/warehouseProcessing";

describe("deduplicateByKeys", () => {
  it("removes duplicates based on key function", () => {
    const data = [
      { id: 1, name: "a" },
      { id: 2, name: "b" },
      { id: 1, name: "a-dup" },
    ];
    const result = deduplicateByKeys(data, (row) => String(row.id));
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("a");
    expect(result[1].name).toBe("b");
  });

  it("returns empty array for empty input", () => {
    expect(deduplicateByKeys([], (r) => String(r))).toEqual([]);
  });

  it("keeps first occurrence when duplicates exist", () => {
    const data = [
      { key: "x", val: 1 },
      { key: "x", val: 2 },
      { key: "x", val: 3 },
    ];
    const result = deduplicateByKeys(data, (r) => r.key);
    expect(result).toHaveLength(1);
    expect(result[0].val).toBe(1);
  });
});

describe("averageTopTwo", () => {
  it("averages the top two values per merchant", () => {
    const data = [
      { merchant_name: "MerchA", value: 10 },
      { merchant_name: "MerchA", value: 20 },
      { merchant_name: "MerchA", value: 30 },
    ];
    const result = averageTopTwo(data);
    expect(result).toHaveLength(1);
    expect(result[0].merchant_name).toBe("MerchA");
    expect(result[0].benchmark).toBe(25); // avg of 30 and 20
  });

  it("handles single value per merchant", () => {
    const data = [{ merchant_name: "Solo", value: 42 }];
    const result = averageTopTwo(data);
    expect(result[0].benchmark).toBe(42);
  });

  it("handles multiple merchants", () => {
    const data = [
      { merchant_name: "A", value: 100 },
      { merchant_name: "B", value: 50 },
      { merchant_name: "A", value: 80 },
    ];
    const result = averageTopTwo(data);
    expect(result).toHaveLength(2);
    const a = result.find((r) => r.merchant_name === "A");
    const b = result.find((r) => r.merchant_name === "B");
    expect(a?.benchmark).toBe(90); // avg of 100 and 80
    expect(b?.benchmark).toBe(50);
  });
});

describe("calculateFlowManagement", () => {
  const merchants = [
    { merchant_name: "TestMerch", order_volume: 100, waiting_for_picking: 80 },
  ];
  const pickingRates = { testmerch: 40 };
  const packingRates = { testmerch: 20 };

  it("calculates picking and packing hours correctly", () => {
    const result = calculateFlowManagement(merchants, pickingRates, packingRates);
    expect(result).toHaveLength(1);
    const row = result[0];
    // picking_hours = 80 / (40 * 1.125) = 1.78
    expect(row.picking_hours).toBeCloseTo(1.78, 1);
    // packing_hours = 100 / (20 * 1.125) = 4.44
    expect(row.packing_hours).toBeCloseTo(4.44, 1);
  });

  it("calculates ideal SPH", () => {
    const result = calculateFlowManagement(merchants, pickingRates, packingRates);
    const row = result[0];
    // ideal_sph = 100 / (1.78 + 4.44) ≈ 16.07
    expect(row.ideal_sph).toBeGreaterThan(0);
  });

  it("filters out merchants with no benchmark rates", () => {
    const result = calculateFlowManagement(
      [{ merchant_name: "Unknown", order_volume: 50, waiting_for_picking: 30 }],
      {},
      {},
    );
    expect(result).toHaveLength(0);
  });

  it("filters out merchants with zero rates", () => {
    const result = calculateFlowManagement(merchants, { testmerch: 0 }, { testmerch: 20 });
    expect(result).toHaveLength(0);
  });
});

describe("buildLookup", () => {
  it("creates a case-insensitive lookup from benchmark entries", () => {
    const benchmarks = [
      { merchant_name: "TestMerch", benchmark: 45 },
      { merchant_name: "ANOTHER", benchmark: 30 },
    ];
    const lookup = buildLookup(benchmarks);
    expect(lookup["testmerch"]).toBe(45);
    expect(lookup["another"]).toBe(30);
  });

  it("excludes entries with zero benchmark", () => {
    const benchmarks = [
      { merchant_name: "Active", benchmark: 50 },
      { merchant_name: "Inactive", benchmark: 0 },
    ];
    const lookup = buildLookup(benchmarks);
    expect(lookup["active"]).toBe(50);
    expect(lookup["inactive"]).toBeUndefined();
  });

  it("returns empty object for empty input", () => {
    expect(buildLookup([])).toEqual({});
  });
});
