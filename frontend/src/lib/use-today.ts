"use client";
import { useEffect, useState } from "react";

/** Local calendar date as YYYY-MM-DD. */
export function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return isoLocal(new Date(y, m - 1, d + days));
}

/**
 * Today's date, read after mount. With Cache Components enabled the current time
 * must not be read while rendering (it would be frozen into the prerender), so
 * this is "" on the first render and the real date immediately after.
 */
export function useToday(): string {
  const [today, setToday] = useState("");
  useEffect(() => {
    setToday(isoLocal(new Date()));
  }, []);
  return today;
}
