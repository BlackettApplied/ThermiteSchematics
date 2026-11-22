import { expect, it } from "vitest";
import { textClusters } from "../src/text-metrics.js";
import { labelRows, labelMetrics } from "../src/packet/label-text.js";
import {
  identityTokens,
  MAX_WRAP_CANDIDATES,
  MAX_WRAP_FIT_PROBES,
  wrapIdentity,
} from "../src/packet/label-wrap.js";
import {
  continuationHeaderWidth,
  continuationLabel,
  continuationLabelSvg,
} from "../src/packet/continuation-label.js";

const uuid = "15400000-0000-4000-8000-000000000202";
const clusterWidth = (text: string) => textClusters(text).length;
const noOrphans = (rows: readonly string[]) =>
  expect(rows.every((row) => textClusters(row).length >= 3)).toBe(true);

it("exports the 64-candidate and 32-probe constants", () => {
  expect(MAX_WRAP_CANDIDATES).toBe(64);
  expect(MAX_WRAP_FIT_PROBES).toBe(32);
});

it("prefers literal separator and UUID boundaries with pinned pressure widths", () => {
  const rows = labelRows(uuid, 16.315);
  expect(rows.join("")).toBe(uuid);
  noOrphans(rows);
  expect(labelRows(uuid, 17.16)).toEqual([
    "15400000-",
    "0000-",
    "4000-8000-",
    "000000000202",
  ]);
  expect(labelRows("LS1-RETURN-PLC1-DI0", 16.315)).toEqual([
    "LS1-RETURN-",
    "PLC1-DI0",
  ]);
  expect(rows.every((r) => labelMetrics(r).width <= 16.316)).toBe(true);
});

it("chooses a literal balanced split instead of a one-character separator orphan", () => {
  const value = "ABC-DEF-G";
  const rows = wrapIdentity(value, 4, clusterWidth);
  expect(rows.join("")).toBe(value);
  noOrphans(rows);
  expect(rows).toHaveLength(3);
});

it.each([
  "A--B..C//D  E   ",
  "e\u0301".repeat(9),
  "A\u200dB".repeat(9),
  "A\u0301-B\u200dC / D\u0308E",
])("keeps every literal character and grapheme boundary: %j", (value) => {
  const rows = wrapIdentity(value, 4, clusterWidth);
  expect(rows.join("")).toBe(value);
  const boundaries = new Set<number>([0]);
  let offset = 0;
  for (const cluster of textClusters(value))
    boundaries.add((offset += cluster.length));
  offset = 0;
  for (const row of rows) {
    expect(boundaries.has((offset += row.length))).toBe(true);
    expect(clusterWidth(row)).toBeLessThanOrEqual(4);
  }
  expect(rows.some((r) => r.includes("…"))).toBe(false);
});

it("retains repeated and trailing separators when finding bank tokens", () => {
  const value = "A--B..C//D  E   ";
  expect(identityTokens(value)).toEqual([
    "A-",
    "-",
    "B.",
    ".",
    "C/",
    "/",
    "D ",
    " ",
    "E ",
    " ",
    " ",
  ]);
  expect(identityTokens(value).join("")).toBe(value);
  expect(
    Math.max(...identityTokens(uuid).map((v) => labelMetrics(v).width)),
  ).toBeCloseTo(17.16, 5);
});

it("preserves long separator-heavy input and memoizes measured strings", () => {
  const value = "AB-- .// ".repeat(256) + "END";
  const calls = new Map<string, number>();
  const rows = wrapIdentity(value, 17, (text) => {
    calls.set(text, (calls.get(text) ?? 0) + 1);
    return text.length;
  });
  expect(rows.join("")).toBe(value);
  noOrphans(rows);
  expect([...calls.values()].every((n) => n === 1)).toBe(true);
  expect(wrapIdentity(value, 17, (t) => t.length)).toEqual(rows);
});

it("prefers separator endings on the wide path when over 64 clusters fit", () => {
  const token = "A".repeat(40) + "-";
  const value = token.repeat(6);
  const rows = wrapIdentity(value, 100, clusterWidth);
  expect(rows.join("")).toBe(value);
  expect(rows).toEqual([token.repeat(2), token.repeat(2), token.repeat(2)]);
  expect(rows.every((row) => row.endsWith("-"))).toBe(true);
});

it("bounds the wide-bank fallback and balances a long oversized literal token", () => {
  const value = "A".repeat(261);
  let calls = 0;
  const rows = wrapIdentity(value, 130, (text) => {
    calls++;
    return text.length;
  });
  expect(rows.join("")).toBe(value);
  expect(rows.map((r) => r.length)).toEqual([130, 65, 66]);
  noOrphans(rows);
  expect(calls).toBeLessThanOrEqual(
    1 + MAX_WRAP_CANDIDATES ** 2 + rows.length * (MAX_WRAP_FIT_PROBES + 5),
  );
});

it("keeps a very wide fitting bank to one measurement and one literal row", () => {
  const value = "AB-- .// e\u0301A\u200dB ".repeat(512);
  let calls = 0;
  expect(
    wrapIdentity(value, 1e6, (t) => {
      calls++;
      return t.length;
    }),
  ).toEqual([value]);
  expect(calls).toBe(1);
});

it("continues bounded states when a wide fallback has an unavoidable orphan", () => {
  const value = "A".repeat(130) + "W";
  const rows = wrapIdentity(value, 64, (text) =>
    [...text].reduce((sum, c) => sum + (c === "W" ? 65 : 1), 0),
  );
  expect(rows.join("")).toBe(value);
  expect(rows.filter((r) => r.length < 3)).toEqual(["W"]);
});

it("retains indivisible oversized clusters for the existing final fit refusal", () => {
  expect(wrapIdentity("A\u200dB", 0.1, (t) => t.length)).toEqual(["A\u200dB"]);
  expect(labelRows("", 0)).toEqual([""]);
});

it.each([
  ["wire printed number", "LS1-RETURN-PLC1-DI0", undefined],
  ["cable core", "CBL-LONG.1-RETURN", undefined],
  ["jumper designation", "JP-CONTROL-RETURN", undefined],
  ["undesignated jumper", "JUMPER", undefined],
] as const)(
  "emits exact identity-only rows for %s",
  (_name, conductor, descriptor) => {
    const link = {
      id: "C1000",
      to: 100,
      toZone: "D6",
      conductor,
      descriptor,
      netId: "N",
      x: 100,
      y: 100,
      side: "right" as const,
    };
    const label = continuationLabel(link, 17.16, continuationHeaderWidth(1000));
    expect(
      label.rows
        .slice(1)
        .map((r) => r.text)
        .join(""),
    ).toBe((descriptor ?? "") + conductor);
    expect(label.rows[0]!.text).toBe("C1000 / 100.D6");
    const svg = continuationLabelSvg({ ...link, label });
    expect(svg).not.toMatch(/tspan|textLength|…/u);
    expect(svg.match(/<text\b/gu)).toHaveLength(label.rows.length);
    expect(svg.match(/font-size="2.5"/gu)).toHaveLength(label.rows.length);
    for (let n = 1; n < label.rows.length; n++)
      expect(label.rows[n]!.y - label.rows[n - 1]!.y).toBeCloseTo(3.5, 8);
  },
);
