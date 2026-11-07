import { it, expect } from "vitest";
import { normalizeUsageToday } from "./capture-normalization.mjs";
it("normalizes relative reset times without erasing the CLI's date form", () => {
  expect(normalizeUsageToday("try again at 11:42 AM.")).toBe(
    "try again at 12:00 PM.",
  );
  expect(normalizeUsageToday("try again at Nov 6th, 2026 12:42 AM.")).toBe(
    "try again at Nov 6th, 2026 12:00 PM.",
  );
  expect(normalizeUsageToday("unrelated 11:42 AM.")).toBe(
    "unrelated 11:42 AM.",
  );
});
