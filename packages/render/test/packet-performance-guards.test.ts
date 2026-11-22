import { afterEach, expect, it, vi } from "vitest";
import { searchNavigationSlot } from "../src/packet/navigation-slot-search.js";
import { reportTokens } from "../src/packet/report-column-widths.js";
import type { NavigationShape } from "../src/packet/navigation-types.js";

afterEach(() => vi.restoreAllMocks());

it.each([32, 64])(
  "prunes the blocked Cartesian grid for %i obstacles before measuring distance",
  (count) => {
    const obstacles = Array.from({ length: count }, (_, i) => ({
      x: i / 2,
      y: i / 2,
      w: 190 - i / 2,
      h: 200 - i / 2,
    }));
    const shape: NavigationShape = {
      id: "blocked-grid",
      mode: "self-located",
      inkMm: { x: 0, y: 0, w: 5, h: 3 },
      maximumForms: [],
      wrapWidthMm: 3,
    };
    const distance = vi.spyOn(Math, "hypot");
    const result = searchNavigationSlot(
      [shape],
      { x: 0, y: 0, w: 200, h: 200 },
      { x: 50, y: 50, w: 10, h: 10 },
      obstacles,
    );
    const calls = distance.mock.calls.length;
    distance.mockRestore();
    expect(result).toBeDefined();
    // The first obstacle covers every y in the field. Only its right edge +
    // clearance and the field's right edge survive: two x positions per row.
    // Each obstacle contributes at most two y edges, plus four fixed edges.
    expect(calls).toBeGreaterThan(0);
    expect(calls).toBeLessThanOrEqual(2 * (2 * count + 4));
  },
);

it.each([64, 256])(
  "does not scan %i cached names for each unrelated cell",
  (count) => {
    const names = Array.from({ length: count }, (_, i) => ({
      value: `D${i}`,
      kind: "designation" as const,
    }));
    const cells = Array.from(
      { length: count },
      (_, i) => `Ω${String.fromCharCode(0x400 + i)}`,
    );
    reportTokens("Ω", names); // Build the name index before counting cell work.
    const indexOf = vi.spyOn(String.prototype, "indexOf"),
      includes = vi.spyOn(String.prototype, "includes");
    const tokens = cells.map((cell) => reportTokens(cell, names));
    const probes = indexOf.mock.calls.length + includes.mock.calls.length;
    indexOf.mockRestore();
    includes.mockRestore();
    expect(tokens.every((hits) => hits.length === 0)).toBe(true);
    // No cell contains any character from a name. Literal string probes may be
    // linear in cell length, never the product of cell count and name count.
    expect(probes).toBeLessThanOrEqual(
      cells.reduce((sum, cell) => sum + cell.length, 0),
    );
  },
);
