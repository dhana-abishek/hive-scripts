import { useState, useEffect } from "react";

export function calcTimeLeft(): number {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 6=Sat
  const h = now.getHours(), m = now.getMinutes(), s = now.getSeconds();
  const nowFrac = (h * 3600 + m * 60 + s) / 86400;
  const t = (hh: number, mm: number, ss: number) => (hh * 3600 + mm * 60 + ss) / 86400;
  const start = t(8, 10, 0), lunchStart = t(12, 0, 0), lunchEnd = t(12, 30, 0), lunchDur = t(0, 30, 0);
  if (day === 0) return 8;
  if (nowFrac < start) return 8;
  const endTime = day === 6 ? t(15, 0, 0) : t(16, 40, 0);
  if (nowFrac >= endTime) return 8;
  const totalShift = (endTime - start - lunchDur) * 24;
  let elapsed: number;
  if (nowFrac < lunchStart) elapsed = (nowFrac - start) * 24;
  else if (nowFrac < lunchEnd) elapsed = (lunchStart - start) * 24;
  else elapsed = (lunchStart - start) * 24 + (nowFrac - lunchEnd) * 24;
  return Math.max(0, totalShift - elapsed);
}

/**
 * Returns the remaining shift hours, recalculated every minute so the UI
 * stays in sync without requiring a full page reload.
 */
export function useTimeLeft(): number {
  const [timeLeft, setTimeLeft] = useState(calcTimeLeft);

  useEffect(() => {
    const id = setInterval(() => setTimeLeft(calcTimeLeft()), 60_000);
    return () => clearInterval(id);
  }, []);

  return timeLeft;
}
