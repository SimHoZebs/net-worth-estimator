import { describe, expect, it } from "vitest";
import { calendarDayMs, isCalendarDay } from "./calendarDay.ts";

describe("calendarDay", () => {
  it("accepts real calendar days including leap day", () => {
    expect(calendarDayMs("2024-02-29")).toBe(Date.UTC(2024, 1, 29));
    expect(isCalendarDay("2026-01-31")).toBe(true);
  });

  it("rejects rolled-over, empty and malformed days", () => {
    for (const day of ["2026-02-30", "2025-02-29", "2026-04-31", "", "2026-2-1", "2026-13-01"]) {
      expect(calendarDayMs(day)).toBeNull();
      expect(isCalendarDay(day)).toBe(false);
    }
  });
});
