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
