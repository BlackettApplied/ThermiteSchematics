import { expect, it, vi } from "vitest";
import { compileProject } from "@thermite/compiler";
import { renderSchematicPacket } from "../src/sheets.js";
import {
  continuationIdentity,
  continuationIdentityConstraint,
} from "../src/packet/continuation-identity.js";
import * as plans from "../src/packet/rooted-plans.js";
import * as labels from "../src/packet/label-text.js";
import { continuationHeaderWidth } from "../src/packet/continuation-label.js";
import type { PresentationEdge } from "../src/types.js";

it.each(["motor-starter", "conveyor-line"])(
  "reports the crossed conductor's identity problem after trying grids (%s)",
  async (project) => {
    const compiled = await compileProject(`examples/${project}`);
    if (!compiled.ok) throw Error(JSON.stringify(compiled));
    const grid = vi.spyOn(plans, "rootedGrids");
    try {
      for (const label of ["   ", "W\u2028BAD", "W\nBAD"]) {
        const ir = structuredClone(compiled.ir);
        for (const wire of ir.wires)
          wire.properties = { ...wire.properties, label };
        const result = await renderSchematicPacket(ir, {
          format: "schematic-packet-request/0.1",
          views: [
            {
              format: "schematic-view-request/0.1",
              root: { by: "designation", value: "M1" },
              family: "power",
              flow: "left-to-right",
            },
          ],
        });
        expect(result.ok).toBe(false);
        if (result.ok) throw Error("Expected identity refusal");
        expect(result.error.code).toBe("R006");
        expect(result.error.message).toContain(
          "cannot print a continuation identity",
        );
        expect(result.error.message).toContain(
          label.includes("\n")
            ? "U+000A"
            : label.trim()
              ? "U+2028"
              : "missing or whitespace-only",
        );
        expect(
          ir.wires.some(
            (w) =>
              result.error.message.includes(w.uid) &&
              result.error.message.includes(w.designation),
          ),
        ).toBe(true);
        expect(result.error.message).not.toContain("No safe sheet grid");
        expect(result.error.message).not.toContain(
          "Continuation identities: .",
        );
        expect(result.error.message).toContain("A candidate cut crosses");
        expect(grid).toHaveBeenCalled();
      }
    } finally {
      grid.mockRestore();
    }
  },
  30000,
);

const edge = (kind: "jumper" | "cable" | "core", value: string) =>
  ({
    id: "authored-edge",
    elementIds:
      kind === "jumper"
        ? [{ kind: "jumper", uid: "jumper-uid" }]
        : [
            {
              kind: "cable_conductor",
              cableUid: "cable-uid",
              conductorId: kind === "core" ? value : "1+",
            },
          ],
    conductor:
      kind === "jumper"
        ? { kind: "jumper", uid: "jumper-uid", designation: value }
        : {
            kind: "cable-conductor",
            cableUid: "cable-uid",
            cableDesignation: kind === "cable" ? value : "CBL1",
            conductorId: kind === "core" ? value : "1+",
          },
    label: {
      textSources:
        kind === "jumper" ? [{ field: "jumper.designation", value }] : [],
    },
  }) as unknown as PresentationEdge;

it.each(["jumper", "cable", "core"] as const)(
  "defends every identity component against blank and line separator text (%s)",
  (kind) => {
    for (const value of [
      "",
      " ",
      "A\rB",
      "A\nB",
      "A\tB",
      "A\u0085B",
      "A\u2028B",
      "A\u2029B",
    ]) {
      expect(continuationIdentity(edge(kind, value))).toBeUndefined();
      const message = continuationIdentityConstraint(edge(kind, value));
      expect(message).toContain(kind === "jumper" ? "jumper-uid" : "cable-uid");
      expect(message).toContain(
        value.trim() ? "line break or separator" : "whitespace-only",
      );
    }
    expect(continuationIdentity(edge(kind, "A  B/Ω"))?.conductor).toContain(
      "A  B/Ω",
    );
  },
);

it("names missing provenance instead of inventing a printed identity", () => {
  const missing = { ...edge("jumper", "JP1"), elementIds: [] };
  expect(continuationIdentity(missing)).toBeUndefined();
  expect(continuationIdentityConstraint(missing)).toContain(
    "matching provenance are missing",
  );
});

it("uses the same exact header width with bounded per-digit-length measurements", () => {
  const destination = Math.max(
    ...Array.from({ length: 100 }, (_, n) =>
      [..."ABCD"].flatMap((row) =>
        Array.from(
          { length: 6 },
          (_, col) =>
            labels.labelMetrics(
              `${String(n + 1).padStart(2, "0")}.${row}${col + 1}`,
            ).width,
        ),
      ),
    ).flat(),
  );
  const oldPrefix = Math.max(
    ...Array.from(
      { length: 1001 },
      (_, n) =>
        labels.labelMetrics(`C${String(n + 1).padStart(3, "0")} / `).width,
    ),
  );
  expect(continuationHeaderWidth(1001)).toBe(oldPrefix + destination);
  for (const n of "0123456789")
    expect(labels.labelMetrics(n).advance).toBe(
      labels.labelMetrics("9").advance,
    );
  const metrics = vi.spyOn(labels, "labelMetrics");
  try {
    expect(continuationHeaderWidth(1_000_000)).toBe(
      labels.labelMetrics("C9999999 / ").width + destination,
    );
    expect(metrics.mock.calls.length).toBeLessThanOrEqual(64);
  } finally {
    metrics.mockRestore();
  }
});
