import { describe, it, expect, vi, beforeEach } from "vitest";

const selectMaybeSingle = vi.fn();
const upsert = vi.fn();
const deleteEq = vi.fn();

vi.mock("@/integrations/supabase/client", () => {
  const from = vi.fn((_table: string) => ({
    select: () => ({
      eq: (_col: string, _val: string) => ({
        maybeSingle: () => selectMaybeSingle(),
      }),
    }),
    upsert,
    delete: () => ({ eq: (col: string, val: string) => deleteEq(col, val) }),
  }));
  return { supabase: { from } };
});

import { cloudGet, cloudSet, cloudRemove } from "@/lib/cloudStorage";

beforeEach(() => {
  selectMaybeSingle.mockReset();
  upsert.mockReset();
  deleteEq.mockReset();
});

describe("cloudGet", () => {
  it("returns the stored value when Supabase returns a row", async () => {
    selectMaybeSingle.mockResolvedValue({
      data: { value: { count: 42 } },
      error: null,
    });
    const result = await cloudGet<{ count: number }>("stats");
    expect(result).toEqual({ count: 42 });
  });

  it("returns null when no row exists", async () => {
    selectMaybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await cloudGet("missing")).toBeNull();
  });

  it("returns null and does not throw when Supabase returns an error", async () => {
    selectMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: "permission denied" },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await cloudGet("any")).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("returns null when the underlying call throws", async () => {
    selectMaybeSingle.mockRejectedValue(new Error("network down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await cloudGet("any")).toBeNull();
    warn.mockRestore();
  });
});

describe("cloudSet", () => {
  it("upserts the value with the correct key and conflict column", async () => {
    upsert.mockResolvedValue({ data: null, error: null });
    await cloudSet("zones", { A: ["m1"] });
    expect(upsert).toHaveBeenCalledTimes(1);
    const [payload, options] = upsert.mock.calls[0] as [
      { key: string; value: unknown; updated_at: string },
      { onConflict: string },
    ];
    expect(payload.key).toBe("zones");
    expect(payload.value).toEqual({ A: ["m1"] });
    expect(typeof payload.updated_at).toBe("string");
    expect(options).toEqual({ onConflict: "key" });
  });

  it("warns but does not throw when upsert returns an error", async () => {
    upsert.mockResolvedValue({ data: null, error: { message: "row too big" } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(cloudSet("k", "v")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("cloudRemove", () => {
  it("calls delete().eq with the given key", async () => {
    deleteEq.mockResolvedValue({ data: null, error: null });
    await cloudRemove("to-remove");
    expect(deleteEq).toHaveBeenCalledWith("key", "to-remove");
  });

  it("warns but does not throw when delete returns an error", async () => {
    deleteEq.mockResolvedValue({ data: null, error: { message: "nope" } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(cloudRemove("k")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
