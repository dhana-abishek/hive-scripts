import { describe, it, expect, vi, beforeEach } from "vitest";

const upsertMock = vi.fn();
const selectMock = vi.fn();
const deleteMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => ({
      upsert: upsertMock,
      select: selectMock,
      delete: deleteMock,
    })),
  },
}));

import { cloudGet, cloudSet, cloudRemove } from "@/lib/cloudStorage";

beforeEach(() => {
  upsertMock.mockReset();
  selectMock.mockReset();
  deleteMock.mockReset();
});

describe("cloudGet", () => {
  it("returns the stored value for a known key", async () => {
    selectMock.mockReturnValue({
      eq: () => ({
        maybeSingle: async () => ({ data: { value: { foo: 1 } }, error: null }),
      }),
    });
    const result = await cloudGet<{ foo: number }>("k");
    expect(result).toEqual({ foo: 1 });
  });

  it("returns null when the row is missing", async () => {
    selectMock.mockReturnValue({
      eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
    });
    expect(await cloudGet("missing")).toBeNull();
  });

  it("returns null and warns when supabase responds with an error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    selectMock.mockReturnValue({
      eq: () => ({
        maybeSingle: async () => ({ data: null, error: { message: "boom" } }),
      }),
    });
    expect(await cloudGet("k")).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("returns null when the supabase client throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    selectMock.mockReturnValue({
      eq: () => ({
        maybeSingle: async () => {
          throw new Error("network");
        },
      }),
    });
    expect(await cloudGet("k")).toBeNull();
    warn.mockRestore();
  });
});

describe("cloudSet", () => {
  it("upserts JSON-serialisable values without mutating the input", async () => {
    upsertMock.mockResolvedValue({ error: null });
    const value = { foo: [1, 2], bar: "x" };
    await cloudSet("k", value);
    expect(upsertMock).toHaveBeenCalledTimes(1);
    const [row, opts] = upsertMock.mock.calls[0];
    expect(row.key).toBe("k");
    expect(row.value).toEqual(value);
    expect(row.value).not.toBe(value); // round-trip produces a fresh object
    expect(typeof row.updated_at).toBe("string");
    expect(opts).toEqual({ onConflict: "key" });
  });

  it("strips non-JSON values (undefined, functions) via round-trip", async () => {
    upsertMock.mockResolvedValue({ error: null });
    await cloudSet("k", { keep: 1, drop: undefined, fn: () => 1 });
    expect(upsertMock.mock.calls[0][0].value).toEqual({ keep: 1 });
  });

  it("warns but does not throw when supabase returns an error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    upsertMock.mockResolvedValue({ error: { message: "denied" } });
    await expect(cloudSet("k", { v: 1 })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("cloudRemove", () => {
  it("issues a delete on the matching key", async () => {
    const eqMock = vi.fn().mockResolvedValue({ error: null });
    deleteMock.mockReturnValue({ eq: eqMock });
    await cloudRemove("k");
    expect(eqMock).toHaveBeenCalledWith("key", "k");
  });

  it("warns but does not throw on supabase error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    deleteMock.mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: { message: "denied" } }),
    });
    await expect(cloudRemove("k")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
