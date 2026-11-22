import { expect, it } from "vitest";
import { printableTextMetrics } from "../src/text-metrics.js";
import {
  cachedFontMetrics,
  withFontMetricCache,
  MAX_FONT_METRIC_CACHE_ENTRIES,
} from "../src/symbols/font-metric-cache.js";
it("returns identical pinned metrics for literal, normalized, bold, math and grapheme text", async () => {
  const inputs = [
    "W-CTL-003",
    "A  B ",
    "e\u0301",
    "A\u200dB",
    "α → PE",
    "LS1-RETURN-PLC1-DI0",
  ];
  for (const text of inputs)
    for (const size of [2.5, 3, 10])
      for (const bold of [false, true])
        for (const literal of [false, true]) {
          const expected = printableTextMetrics(text, size, bold, literal);
          await withFontMetricCache(async () => {
            const a = printableTextMetrics(text, size, bold, literal),
              b = printableTextMetrics(text, size, bold, literal);
            expect(a).toEqual(expected);
            expect(b).toBe(a);
            expect(Object.isFrozen(a)).toBe(true);
          });
        }
});
it("bounds entries and scopes reuse to one async view, including parallel searches", async () => {
  const value = printableTextMetrics("W", 3);
  let calls = 0;
  const compute = () => {
    calls++;
    return { ...value };
  };
  const args = (s: string) => [s, 3, false, true] as const;
  await withFontMetricCache(async () => {
    for (let i = 0; i < MAX_FONT_METRIC_CACHE_ENTRIES; i++)
      cachedFontMetrics(args(String(i)), compute);
    cachedFontMetrics(args("0"), compute);
    expect(calls).toBe(MAX_FONT_METRIC_CACHE_ENTRIES);
    cachedFontMetrics(args("overflow"), compute);
    cachedFontMetrics(args("overflow"), compute);
    expect(calls).toBe(MAX_FONT_METRIC_CACHE_ENTRIES + 2);
    await withFontMetricCache(async () => {
      cachedFontMetrics(args("0"), compute);
    });
    expect(calls).toBe(MAX_FONT_METRIC_CACHE_ENTRIES + 2);
  });
  const values = await Promise.all(
    [0, 1].map(() =>
      withFontMetricCache(async () => {
        await Promise.resolve();
        return cachedFontMetrics(args("0"), compute);
      }),
    ),
  );
  expect(values[0]).not.toBe(values[1]);
  const a = cachedFontMetrics(args("0"), compute),
    b = cachedFontMetrics(args("0"), compute);
  expect(a).not.toBe(b);
});

it("distinguishes literal and normalized forms of the same string within one scope", async () => {
  const value = "A  B ";
  const expected = printableTextMetrics(value, 3, false, false);
  await withFontMetricCache(async () => {
    const literal = printableTextMetrics(value, 3, false, true);
    const normalized = printableTextMetrics(value, 3, false, false);
    expect(literal.advance).toBeGreaterThan(normalized.advance);
    expect(literal).not.toEqual(normalized);
    expect(normalized).toEqual(expected);
    expect(printableTextMetrics(value, 3, false, true)).toBe(literal);
    expect(printableTextMetrics(value, 3, false, false)).toBe(normalized);
  });
});
