import { useState, useEffect } from "react";
import { cloudGet, cloudSet, cloudRemove } from "@/lib/cloudStorage";
import { supabase } from "@/integrations/supabase/client";

// ---------- Shift configuration ----------

export interface ShiftConfig {
  /** Start time in "HH:MM" 24h format */
  start: string;
  /** End time in "HH:MM" */
  end: string;
  /** Lunch start "HH:MM" */
  lunchStart: string;
  /** Lunch end "HH:MM" */
  lunchEnd: string;
}

/** Default schedule per JS day index (0=Sun..6=Sat). null = day off. */
const DEFAULT_SHIFTS: (ShiftConfig | null)[] = [
  null, // Sun (off)
  { start: "08:10", end: "16:40", lunchStart: "12:00", lunchEnd: "12:30" }, // Mon
  { start: "08:10", end: "16:40", lunchStart: "12:00", lunchEnd: "12:30" }, // Tue
  { start: "08:10", end: "16:40", lunchStart: "12:00", lunchEnd: "12:30" }, // Wed
  { start: "08:10", end: "16:40", lunchStart: "12:00", lunchEnd: "12:30" }, // Thu
  { start: "08:10", end: "16:40", lunchStart: "12:00", lunchEnd: "12:30" }, // Fri
  { start: "08:00", end: "15:00", lunchStart: "12:00", lunchEnd: "12:30" }, // Sat
];

const STORAGE_KEY = "shift_overrides";
const CLOUD_KEY = "shift_overrides";
const CHANNEL_NAME = "app_storage_shift_overrides";

/** Map of date (YYYY-MM-DD) -> ShiftConfig override. null means explicit day-off. */
type OverrideMap = Record<string, ShiftConfig | null>;

let overrides: OverrideMap = loadFromLocal();
const listeners = new Set<() => void>();
let cloudInitialized = false;

function loadFromLocal(): OverrideMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as OverrideMap;
  } catch {
    return {};
  }
}

function persistLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    /* ignore */
  }
}

function notify() {
  listeners.forEach((fn) => fn());
}

function applyRemote(next: OverrideMap) {
  overrides = next || {};
  persistLocal();
  notify();
}

function initCloudSync() {
  if (cloudInitialized) return;
  cloudInitialized = true;

  // Initial fetch from cloud (merge cloud over local on first load)
  cloudGet<OverrideMap>(CLOUD_KEY).then((remote) => {
    if (remote && typeof remote === "object") {
      overrides = { ...overrides, ...remote };
      persistLocal();
      notify();
    }
  });

  // Realtime broadcast subscription
  const channel = supabase.channel(CHANNEL_NAME);
  channel
    .on("broadcast", { event: "update" }, (payload) => {
      const next = (payload?.payload as { value?: OverrideMap })?.value;
      if (next && typeof next === "object") applyRemote(next);
    })
    .subscribe();
}

function broadcast() {
  supabase
    .channel(CHANNEL_NAME)
    .send({ type: "broadcast", event: "update", payload: { value: overrides } })
    .catch(() => {});
}

export function dateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function getShiftForDate(d: Date = new Date()): ShiftConfig | null {
  const key = dateKey(d);
  if (key in overrides) return overrides[key];
  return DEFAULT_SHIFTS[d.getDay()] ?? null;
}

export function getOverride(d: Date = new Date()): ShiftConfig | null | undefined {
  const key = dateKey(d);
  return key in overrides ? overrides[key] : undefined;
}

export function setShiftOverride(d: Date, cfg: ShiftConfig | null) {
  overrides = { ...overrides, [dateKey(d)]: cfg };
  persistLocal();
  notify();
  cloudSet(CLOUD_KEY, overrides).then(() => broadcast());
}

export function clearShiftOverride(d: Date) {
  const key = dateKey(d);
  if (!(key in overrides)) return;
  const { [key]: _, ...rest } = overrides;
  overrides = rest;
  persistLocal();
  notify();
  cloudSet(CLOUD_KEY, overrides).then(() => broadcast());
}

export function getDefaultShift(d: Date = new Date()): ShiftConfig | null {
  return DEFAULT_SHIFTS[d.getDay()] ?? null;
}

// ---------- Time-left computation ----------

function parseHM(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return ((h || 0) * 3600 + (m || 0) * 60) / 86400;
}

export function calcTimeLeft(now: Date = new Date()): number {
  const shift = getShiftForDate(now);
  if (!shift) return 8;

  const nowFrac = (now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()) / 86400;
  const start = parseHM(shift.start);
  const end = parseHM(shift.end);
  const lunchStart = parseHM(shift.lunchStart);
  const lunchEnd = parseHM(shift.lunchEnd);
  const lunchDur = Math.max(0, lunchEnd - lunchStart);

  if (nowFrac < start) {
    return Math.max(0, (end - start - lunchDur) * 24);
  }
  if (nowFrac >= end) return 0;

  const totalShift = (end - start - lunchDur) * 24;
  let elapsed: number;
  if (nowFrac < lunchStart) elapsed = (nowFrac - start) * 24;
  else if (nowFrac < lunchEnd) elapsed = (lunchStart - start) * 24;
  else elapsed = (lunchStart - start) * 24 + (nowFrac - lunchEnd) * 24;

  const remaining = Math.max(0, totalShift - elapsed);
  // Preserve previous behaviour: if shift hasn't started or has ended, surface 8 so HC math doesn't collapse
  return remaining > 0 ? remaining : (nowFrac >= end ? 8 : remaining);
}

/**
 * Returns the remaining shift hours, recalculated every minute and whenever
 * the shift configuration changes, so the UI stays in sync.
 */
export function useTimeLeft(): number {
  const [timeLeft, setTimeLeft] = useState(() => {
    initCloudSync();
    return calcTimeLeft();
  });

  useEffect(() => {
    initCloudSync();
    const recompute = () => setTimeLeft(calcTimeLeft());
    const id = setInterval(recompute, 60_000);
    listeners.add(recompute);
    return () => {
      clearInterval(id);
      listeners.delete(recompute);
    };
  }, []);

  return timeLeft;
}

/** Subscribe to shift-config changes (returns unsubscribe). */
export function useShiftConfig(date: Date = new Date()): {
  effective: ShiftConfig | null;
  override: ShiftConfig | null | undefined;
  isOverridden: boolean;
} {
  const [, force] = useState(0);
  useEffect(() => {
    initCloudSync();
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  const override = getOverride(date);
  return {
    effective: getShiftForDate(date),
    override,
    isOverridden: override !== undefined,
  };
}
