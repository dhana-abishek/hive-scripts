import { parseCSVLine, parseCSVHeaders } from "@/lib/csvParser";

/**
 * Calculates the inflow factor based on current day and time.
 *
 * - Monday: base factor = 20% (total orders ≈ 120% of 7 AM volume)
 * - Tuesday–Saturday: base factor = 30% (total orders ≈ 130% of 7 AM volume)
 * - Sunday: 0 (no operations)
 *
 * The factor starts at full value at 07:00 and linearly decreases to 0% at 13:00.
 * Before 07:00, the full factor applies. After 13:00, factor is 0.
 */
export function getInflowFactor(now?: Date): { factor: number; baseFactor: number; label: string } {
  const d = now ?? new Date();
  const day = d.getDay(); // 0=Sun, 1=Mon, …, 6=Sat

  let baseFactor: number;
  let label: string;

  if (day === 0) {
    // Sunday
    return { factor: 0, baseFactor: 0, label: "Sunday – no inflow" };
  } else if (day === 1) {
    baseFactor = 0.20;
    label = "Monday (20%)";
  } else {
    baseFactor = 0.30;
    label = "Tue–Sat (30%)";
  }

  const hours = d.getHours() + d.getMinutes() / 60;

  let timeMultiplier: number;
  if (hours <= 7) {
    timeMultiplier = 1; // Full factor before/at 7 AM
  } else if (hours >= 13) {
    timeMultiplier = 0; // No more inflow after 1 PM
  } else {
    timeMultiplier = (13 - hours) / 6; // Linear decrease 7→13
  }

  const factor = baseFactor * timeMultiplier;
  return {
    factor: Math.round(factor * 10000) / 10000,
    baseFactor,
    label: `${label} · ${Math.round(factor * 100)}% remaining`,
  };
}

/**
 * Parse the shipments CSV and count orders per merchant that arrived
 * between 1 PM the previous day and 7 AM today (overnight orders).
 * Uses the "created_at" column for date/time filtering to ensure
 * consistent inflow accuracy.
 */
export function parseOvernightVolumes(csvText: string, now?: Date): Record<string, number> {
  const d = now ?? new Date();

  // 1 PM yesterday
  const yesterday1PM = new Date(d);
  yesterday1PM.setDate(yesterday1PM.getDate() - 1);
  yesterday1PM.setHours(13, 0, 0, 0);

  // 7 AM today
  const today7AM = new Date(d);
  today7AM.setHours(7, 0, 0, 0);

  const lines = csvText.split("\n");
  if (lines.length < 2) return {};

  // Find column indices from header
  const header = parseCSVHeaders(lines[0]);
  const createdIdx = header.findIndex(h => h.includes("created_at"));
  const merchantIdx = header.indexOf("merchant");
  if (createdIdx === -1 || merchantIdx === -1) return {};

  const counts: Record<string, number> = {};

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const fields = parseCSVLine(line);
    if (fields.length <= Math.max(createdIdx, merchantIdx)) continue;

    const merchant = fields[merchantIdx].trim();
    const createdRaw = fields[createdIdx].trim();
    if (!merchant || !createdRaw) continue;

    const createdDate = parseMetabaseDate(createdRaw);
    if (!createdDate) continue;

    if (createdDate >= yesterday1PM && createdDate < today7AM) {
      counts[merchant] = (counts[merchant] || 0) + 1;
    }
  }

  return counts;
}

/** Parse dates like "April 2, 2026, 10:30" */
function parseMetabaseDate(raw: string): Date | null {
  try {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d;
    return null;
  } catch {
    return null;
  }
}
