// Cloud-backed storage using Supabase app_storage table
// Drop-in replacement for idbStorage with the same API

import { supabase } from "@/integrations/supabase/client";

export async function cloudGet<T>(key: string): Promise<T | null> {
  try {
    const { data, error } = await supabase
      .from("app_storage")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    if (error || !data) return null;
    return data.value as T;
  } catch {
    return null;
  }
}

export async function cloudSet(key: string, value: unknown): Promise<void> {
  try {
    await supabase
      .from("app_storage")
      .upsert({ key, value: value as any, updated_at: new Date().toISOString() }, { onConflict: "key" });
  } catch {
    // silent fail
  }
}

export async function cloudRemove(key: string): Promise<void> {
  try {
    await supabase.from("app_storage").delete().eq("key", key);
  } catch {
    // silent fail
  }
}
