import { describe, it, expect } from "vitest";
import { getInflowFactor, parseOvernightVolumes } from "@/lib/inflowEstimation";

describe("getInflowFactor", () => {
  it("returns 0 factor on Sunday", () => {
    // April 12, 2026 is a Sunday
    const sunday = new Date(2026, 3, 12, 10, 0);
    const result = getInflowFactor(sunday);
    expect(result.factor).toBe(0);
    expect(result.baseFactor).toBe(0);
    expect(result.label).toContain("Sunday");
  });

  it("returns 20% base factor on Monday", () => {
    // April 13, 2026 is a Monday
    const monday = new Date(2026, 3, 13, 7, 0);
    const result = getInflowFactor(monday);
    expect(result.baseFactor).toBe(0.20);
    expect(result.factor).toBe(0.20); // At 7 AM, full factor
  });

  it("returns 30% base factor on Tuesday-Saturday", () => {
    // April 14, 2026 is a Tuesday
    const tuesday = new Date(2026, 3, 14, 7, 0);
    const result = getInflowFactor(tuesday);
    expect(result.baseFactor).toBe(0.30);
  });

  it("returns full factor before 7 AM", () => {
    const earlyMonday = new Date(2026, 3, 13, 6, 0);
    const result = getInflowFactor(earlyMonday);
    expect(result.factor).toBe(0.20);
  });

  it("returns 0 factor after 1 PM", () => {
    const afternoonTuesday = new Date(2026, 3, 14, 14, 0);
    const result = getInflowFactor(afternoonTuesday);
    expect(result.factor).toBe(0);
  });

  it("linearly decreases factor between 7 AM and 1 PM", () => {
    // At 10 AM (halfway): timeMultiplier = (13 - 10) / 6 = 0.5
    const midMorning = new Date(2026, 3, 14, 10, 0); // Tuesday
    const result = getInflowFactor(midMorning);
    expect(result.factor).toBeCloseTo(0.30 * 0.5, 2);
  });
});

describe("parseOvernightVolumes", () => {
  it("counts orders between 1 PM yesterday and 7 AM today", () => {
    // Simulate April 14 at 8 AM — overnight window is April 13 1PM to April 14 7AM
    const now = new Date(2026, 3, 14, 8, 0);
    const csv = [
      "merchant,created_at,other",
      'MerchA,"April 13, 2026, 14:00",x',  // 2 PM Apr 13 — in range
      'MerchA,"April 13, 2026, 15:00",x',  // 3 PM Apr 13 — in range
      'MerchB,"April 14, 2026, 06:00",x',  // 6 AM Apr 14 — in range
      'MerchA,"April 14, 2026, 08:00",x',  // 8 AM Apr 14 — out of range (after 7 AM)
      'MerchB,"April 13, 2026, 12:00",x',  // noon Apr 13 — out of range (before 1 PM)
    ].join("\n");

    const result = parseOvernightVolumes(csv, now);
    expect(result.volumes["MerchA"]).toBe(2);
    expect(result.volumes["MerchB"]).toBe(1);
  });

  it("returns empty volumes for empty CSV", () => {
    const result = parseOvernightVolumes("", new Date());
    expect(result.volumes).toEqual({});
    expect(result.restockCandidates).toEqual({});
  });

  it("returns empty volumes if required columns are missing", () => {
    const csv = "name,other\nFoo,bar";
    const result = parseOvernightVolumes(csv, new Date());
    expect(result.volumes).toEqual({});
    expect(result.restockCandidates).toEqual({});
  });

  it("detects restock candidates when created_at and ready_for_fulfillment_at are on different days", () => {
    // Simulate April 14 at 8 AM
    const now = new Date(2026, 3, 14, 8, 0);
    const csv = [
      "merchant,created_at,ready_for_fulfillment_at",
      // Restock: created Apr 10, ready_for_fulfillment Apr 13 (different days, in overnight window)
      'MerchA,"April 13, 2026, 14:00","April 13, 2026, 14:05"',  // same day — normal order
      'MerchA,"April 13, 2026, 15:00","April 13, 2026, 15:10"',  // same day — normal order
      'MerchB,"April 13, 2026, 14:00","April 13, 2026, 15:00"',  // same day — normal order
      'MerchB,"April 13, 2026, 14:00","April 14, 2026, 06:00"',  // diff day — restock candidate
      'MerchB,"April 13, 2026, 16:00","April 14, 2026, 06:00"',  // diff day — restock candidate
    ].join("\n");

    const result = parseOvernightVolumes(csv, now);
    expect(result.volumes["MerchA"]).toBe(2);
    expect(result.volumes["MerchB"]).toBe(3);
    // Only MerchB has restock candidates (2 orders)
    expect(result.restockCandidates["MerchA"]).toBeUndefined();
    expect(result.restockCandidates["MerchB"]).toBe(2);
  });

  it("does not produce restock candidates when ready_for_fulfillment_at column is absent", () => {
    const now = new Date(2026, 3, 14, 8, 0);
    const csv = [
      "merchant,created_at",
      'MerchA,"April 13, 2026, 14:00"',
    ].join("\n");

    const result = parseOvernightVolumes(csv, now);
    expect(result.volumes["MerchA"]).toBe(1);
    expect(result.restockCandidates).toEqual({});
  });
});
