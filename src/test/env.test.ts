import { describe, it, expect } from "vitest";
import { loadEnv } from "@/lib/env";

describe("loadEnv", () => {
  it("returns parsed values when both vars are present and valid", () => {
    const result = loadEnv({
      VITE_SUPABASE_URL: "https://project.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "anon-key",
    });
    expect(result.VITE_SUPABASE_URL).toBe("https://project.supabase.co");
    expect(result.VITE_SUPABASE_PUBLISHABLE_KEY).toBe("anon-key");
  });

  it("throws when VITE_SUPABASE_URL is missing", () => {
    expect(() =>
      loadEnv({ VITE_SUPABASE_PUBLISHABLE_KEY: "anon-key" }),
    ).toThrow(/VITE_SUPABASE_URL/);
  });

  it("throws when VITE_SUPABASE_URL is not a valid URL", () => {
    expect(() =>
      loadEnv({
        VITE_SUPABASE_URL: "not-a-url",
        VITE_SUPABASE_PUBLISHABLE_KEY: "anon-key",
      }),
    ).toThrow(/valid URL/);
  });

  it("throws when VITE_SUPABASE_PUBLISHABLE_KEY is empty", () => {
    expect(() =>
      loadEnv({
        VITE_SUPABASE_URL: "https://project.supabase.co",
        VITE_SUPABASE_PUBLISHABLE_KEY: "",
      }),
    ).toThrow(/VITE_SUPABASE_PUBLISHABLE_KEY/);
  });

  it("lists every failing field in a single error message", () => {
    try {
      loadEnv({});
    } catch (e) {
      const message = (e as Error).message;
      expect(message).toContain("VITE_SUPABASE_URL");
      expect(message).toContain("VITE_SUPABASE_PUBLISHABLE_KEY");
      return;
    }
    throw new Error("expected loadEnv to throw");
  });
});
