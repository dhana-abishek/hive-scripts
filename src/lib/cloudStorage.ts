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
    if (error) {
      console.warn(`[cloudStorage] Failed to get key "${key}":`, error.message);
      return null;
    }
    if (!data) return null;
    return data.value as T;
  } catch (err) {
    console.warn(`[cloudStorage] Unexpected error getting key "${key}":`, err);
    return null;
  }
}

export async function cloudSet(key: string, value: unknown): Promise<void> {
  try {
    const { error } = await supabase
      .from("app_storage")
      .upsert({ key, value: value as any, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) console.warn(`[cloudStorage] Failed to set key "${key}":`, error.message);
  } catch (err) {
    console.warn(`[cloudStorage] Unexpected error setting key "${key}":`, err);
  }
}

export async function cloudRemove(key: string): Promise<void> {
  try {
    const { error } = await supabase.from("app_storage").delete().eq("key", key);
    if (error) console.warn(`[cloudStorage] Failed to remove key "${key}":`, error.message);
  } catch (err) {
    console.warn(`[cloudStorage] Unexpected error removing key "${key}":`, err);
  }
}
