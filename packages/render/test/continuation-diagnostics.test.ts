import { createHash } from "node:crypto";
import { beforeAll, expect, it } from "vitest";
import {
  compileProject,
  type ElectricalIr,
  type CompiledProjectPresentation,
} from "@thermite/compiler";
import {
  renderSchematicPacket,
  type SchematicPacketRequest,
} from "../src/sheets.js";
import type { PreparedSchematicDrawing } from "../src/renderer.js";
import {
  rootedConstraint,
  rootedDiagnosticError,
  leastRootedConstraint,
  withRootedConstraint,
} from "../src/packet/rooted-constraint.js";
import { continuationGridConstraint } from "../src/packet/continuation-constraint.js";

let ir: ElectricalIr;
let presentation: CompiledProjectPresentation | undefined;
beforeAll(async () => {
  const compiled = await compileProject("examples/conveyor-line");
  if (!compiled.ok) throw Error("compile");
  ir = compiled.ir;
  presentation = compiled.presentation;
});
const request: SchematicPacketRequest = {
  format: "schematic-packet-request/0.1",
  page: { size: "a4", orientation: "portrait", marginMm: 25 },
  views: [
    {
      format: "schematic-view-request/0.1",
      root: { by: "designation", value: "M1" },
      family: "power",
      flow: "left-to-right",
    },
  ],
};
// Complete error bytes, including the unchanged contextual fields. The valid
// generic error uses the least all-bank shortfall across tested layouts. A
// span-fitting bad-label alternative clears pageConstraint. Uncut digests stay pinned.
const outcomes = {
  valid: "414a7cceee28e650bf741a28563c6afc7e49ce297cd2c2e8abf09e17bf3cb217",
  one: "dee2ba00971be0530140f3d9740b3e6861afd91a7229779cd5c422881a2d3cf8",
  half: "dee2ba00971be0530140f3d9740b3e6861afd91a7229779cd5c422881a2d3cf8",
  all: "dee2ba00971be0530140f3d9740b3e6861afd91a7229779cd5c422881a2d3cf8",
};

it.each(["valid", "one", "half", "all"] as const)(
  "keeps the tight A4 conveyor outcome exact with %s bad crossed labels",
  async (mode) => {
    const input = structuredClone(ir);
    for (const [i, wire] of input.wires.entries())
      if (
        mode === "all" ||
        (mode === "half" && i % 2 === 0) ||
        (mode === "one" && wire.designation === "W-PWR-001")
      )
        wire.properties = { ...wire.properties, label: "A\nB" };
    const result = await renderSchematicPacket(input, request, presentation);
    expect(result.ok).toBe(false);
    if (result.ok) throw Error("Expected R006");
    expect(result.error.code).toBe("R006");
    if (mode === "valid") {
      expect(result.error.message).toContain(
        "protected width 115.55 mm exceeds 110.81 mm by 4.74 mm",
      );
      expect(result.error.details?.continuationIdentity).toBeUndefined();
      expect(result.error.details?.pageConstraint).toBeUndefined();
    } else {
      expect(result.error.details?.continuationIdentity).toBe(
        '["wire","77cec021-7247-476b-8293-549bbd3739c0"]',
      );
      expect(result.error.message).toContain("U+000A");
      expect(result.error.message).toContain(
        "Use larger paper, landscape, or the other flow so no cut crosses this conductor.",
      );
      expect(result.error.details?.pageConstraint).toBeUndefined();
      expect(result.error.message).not.toContain("No safe sheet grid fits");
    }
    expect(result.error.message).not.toContain("Continuation identities: .");
    expect(
      createHash("sha256").update(JSON.stringify(result)).digest("hex"),
    ).toBe(outcomes[mode]);
  },
);

function prepared(width: number, height: number) {
  return {
    graph: { edges: [] },
    layout: {
      nodes: [{ id: "body", kind: "device", x: 0, y: 0, width, height }],
      labels: [],
      edges: [],
    },
  } as unknown as PreparedSchematicDrawing;
}
it("retains typed width and height measurements alongside the original wording", () => {
  expect(
    rootedConstraint(prepared(576, 776), { x: 0, y: 0, w: 100, h: 80 }, 0.25),
  ).toEqual({
    kind: "protected-span",
    spans: [
      { axis: "width", requiredMm: 150, availableMm: 100, shortfallMm: 50 },
      { axis: "height", requiredMm: 200, availableMm: 80, shortfallMm: 120 },
    ],
    message:
      "No safe sheet grid fits: protected width 150.00 mm exceeds 100.00 mm by 50.00 mm; protected height 200.00 mm exceeds 80.00 mm by 120.00 mm. Use a larger sheet or landscape.",
  });
});

it("clears a first-bank shortfall when another bank fits, and otherwise chooses the least shortfall", () => {
  const p = prepared(576, 776);
  const narrow = { x: 0, y: 0, w: 100, h: 80 };
  const better = { x: 0, y: 0, w: 140, h: 210 };
  const fitting = { x: 0, y: 0, w: 160, h: 210 };
  const expected = rootedConstraint(p, better, 0.25);
  expect(continuationGridConstraint(p, [narrow, better], 0.25)).toEqual(
    expected,
  );
  expect(continuationGridConstraint(p, [better, narrow], 0.25)).toEqual(
    expected,
  );
  expect(expected).toMatchObject({
    kind: "protected-span",
    spans: [
      { axis: "width", requiredMm: 150, availableMm: 140, shortfallMm: 10 },
    ],
  });
  const cleared = continuationGridConstraint(p, [narrow, fitting], 0.25);
  expect(cleared.kind).toBe("grid");
  expect(cleared.message).not.toContain("protected width");
});

it("uses the same least constraint for generic errors and drops an initial claim when a later layout fits", () => {
  const p = prepared(576, 776);
  const initial = rootedConstraint(p, { x: 0, y: 0, w: 100, h: 80 }, 0.25);
  const better = rootedConstraint(p, { x: 0, y: 0, w: 140, h: 210 }, 0.25);
  const fitting = rootedConstraint(p, { x: 0, y: 0, w: 160, h: 210 }, 0.25);
  const error = {
    code: "R006" as const,
    root: "packet",
    reason: "unprintable-layout" as const,
    message: initial.message + " Context.",
    details: { retained: true },
  };
  const original = {
    constraint: initial,
    gridFailure: { error, suffix: " Context." },
  };
  expect(
    rootedDiagnosticError(error, [original, { constraint: better }]),
  ).toEqual({
    ...error,
    message: better.message + " Context.",
  });
  expect(
    rootedDiagnosticError(error, [original, { constraint: fitting }]).message,
  ).toBe(fitting.message + " Context.");
  const identity = {
    ...error,
    message: "Crossed identity.",
    details: { continuationIdentity: "wire" },
  };
  expect(
    rootedDiagnosticError(identity, [original, { constraint: better }]).details
      ?.pageConstraint,
  ).toBe(better);
  expect(
    rootedDiagnosticError(identity, [original, { constraint: fitting }]),
  ).toBe(identity);
  expect(leastRootedConstraint([initial, undefined])).toBeUndefined();
});

it("does not carry a false page constraint for the reviewer's printable letter-portrait conveyor", async () => {
  const page = {
    size: "letter" as const,
    orientation: "portrait" as const,
    marginMm: 25,
  };
  const valid = await renderSchematicPacket(
    ir,
    { ...request, page },
    presentation,
  );
  if (!valid.ok) throw Error(valid.error.message);
  expect(valid.value.sheets).toHaveLength(5);
  expect(valid.value.sheets.flatMap((s) => s.continuations)).toHaveLength(32);
  const bad = structuredClone(ir);
  for (const wire of bad.wires)
    wire.properties = { ...wire.properties, label: "A\nB" };
  const result = await renderSchematicPacket(
    bad,
    { ...request, page },
    presentation,
  );
  if (result.ok) throw Error("Expected crossed identity refusal");
  expect(result.error.code).toBe("R006");
  expect(result.error.message).toContain("U+000A");
  expect(result.error.message).toContain("so no cut crosses this conductor");
  expect(result.error.details?.pageConstraint).toBeUndefined();
  expect(result.error.message).not.toContain("No safe sheet grid fits");
});

it("keeps a genuine tight-A4 constraint when every bank and layout falls short", async () => {
  const views = [{ ...request.views[0]!, flow: "top-to-bottom" as const }];
  const valid = await renderSchematicPacket(
    ir,
    { ...request, views },
    presentation,
  );
  if (valid.ok) throw Error("Expected tight-A4 refusal");
  expect(valid.error.message).toContain(
    "protected width 134.70 mm exceeds 124.00 mm by 10.70 mm",
  );
  const bad = structuredClone(ir);
  for (const [i, wire] of bad.wires.entries())
    if (i % 2 === 0) wire.properties = { ...wire.properties, label: "A\nB" };
  const result = await renderSchematicPacket(
    bad,
    { ...request, views },
    presentation,
  );
  if (result.ok) throw Error("Expected tight-A4 refusal with bad labels");
  expect(result.error.code).toBe("R006");
  expect(result.error.message).toContain(
    "protected width 126.91 mm exceeds 124.00 mm by 2.91 mm",
  );
  // With ordered vertical lanes no complete cut grid is available here, so
  // an untested malformed conductor must not be reported as a crossed identity.
  // The LTR cases above and typed merge test below retain identity diagnostics.
  expect(result.error.details?.continuationIdentity).toBeUndefined();
  expect(result.error.details?.pageConstraint).toBeUndefined();
});

it("uses the constraint type rather than prose to merge an identity refusal", () => {
  const error = {
    code: "R006" as const,
    root: "packet",
    reason: "unprintable-layout" as const,
    message: "Crossed identity.",
    details: { continuationIdentity: "wire" },
  };
  const generic = rootedConstraint(
    prepared(80, 80),
    { x: 0, y: 0, w: 100, h: 80 },
    0.25,
  );
  expect(generic.kind).toBe("grid");
  expect(
    withRootedConstraint(error, {
      ...generic,
      message: "protected width is only prose here",
    }),
  ).toBe(error);
  const constraint = {
    kind: "protected-span" as const,
    spans: [],
    message: "Measured shortfall.",
  };
  expect(withRootedConstraint(error, constraint)).toEqual({
    ...error,
    message: "Crossed identity. Measured shortfall.",
    details: { ...error.details, pageConstraint: constraint },
  });
});
