import { dependencyDraft } from "./document-fixture.js";
import { documentDependencies } from "../src/packet/document-companions.js";
import type { DocumentNeedSeed } from "../src/packet/document-types.js";
import { beforeAll, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import { renderSchematicPacket } from "../src/sheets.js";
import type { SchematicPacketRequest } from "../src/packet/types.js";

let ir: ElectricalIr, request: SchematicPacketRequest;
beforeAll(async () => {
  const dir = resolve("examples/assembly-note-bounds");
  const c = await compileProject(dir);
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  ir = c.ir;
  request = JSON.parse(await readFile(resolve(dir, "packet.json"), "utf8"));
});
for (const [size, pages, reason] of [
  [
    "tabloid",
    1,
    "packed omitted-port captions fit beside the inline inventory",
  ],
  [
    "a4",
    2,
    "nine native rows cannot fit inline, so a same-paper companion is required",
  ],
  [
    "letter",
    2,
    "nine native rows cannot fit inline, so a same-paper companion is required",
  ],
] as const) {
  it(`${size} 400 W stays printable: ${reason}`, async () => {
    const first = request.views[0];
    if (first?.format !== "connector-assembly-view-request/0.1")
      throw Error("Missing source view");
    const spec: SchematicPacketRequest = {
      ...request,
      page: { size, orientation: "landscape" },
      views: [{ ...first, devices: undefined, notes: ["W".repeat(400)] }],
    };
    const before = JSON.stringify(ir);
    const result = await renderSchematicPacket(ir, spec);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sheets).toHaveLength(pages);
    const documents =
      result.value.navigation?.documents?.filter(
        (d) => d.kind === "assemblies",
      ) ?? [];
    expect(documents.flatMap((d) => d.rows)).toHaveLength(9);
    expect(
      documents
        .flatMap((d) => d.rows)
        .filter((r) => r.nativeKey.startsWith("["))
        .map((r) => r.displayName),
    ).toEqual(Array.from({ length: 8 }, (_, i) => `R1 / X${i + 2}`));
    const overflow = documents.flatMap((d) =>
      d.autoOrigin?.overflow ? [d.autoOrigin.overflow] : [],
    );
    expect(overflow).toHaveLength(pages - 1);
    for (const evidence of overflow) {
      expect(evidence.attempts.length).toBeGreaterThan(0);
      expect(evidence.rowKeys).toHaveLength(9);
      expect(evidence.sourceSheets).toEqual([1]);
    }
    const needs = result.value.navigation?.dependencies ?? [];
    expect(
      needs.filter((d) => d.need === "connector-port-status"),
    ).toHaveLength(8);
    expect(
      needs.every(
        (d) =>
          d.resolution.length &&
          d.caption?.text.match(
            d.need === "connector-port-status"
              ? /connector port status:\s+\d{2}\.[A-D][1-6] \(R1 \/ X[2-9]\)/u
              : /assembly inventory \d{2}\.[A-D][1-6]/u,
          ),
      ),
    ).toBe(true);
    expect(JSON.stringify(ir)).toBe(before);
  });
}

it("keeps every partition's native cap reason while reusing the authored schedule", async () => {
  const dir = resolve("examples/cap-pagination");
  const c = await compileProject(dir);
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  const spec: SchematicPacketRequest = JSON.parse(
    await readFile(resolve(dir, "packet.json"), "utf8"),
  );
  const result = await renderSchematicPacket(c.ir, spec, c.presentation);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.sheets).toHaveLength(7);
  const needs =
    result.value.navigation?.dependencies?.filter(
      (d) => d.noteId === "assembly-reasons",
    ) ?? [];
  expect(needs).toHaveLength(2);
  const facts = needs.flatMap((d) =>
    d.requiredFacts.flatMap((f) =>
      f.kind === "assembly-pin-map" ? [f.relationUid] : [],
    ),
  );
  expect(facts).toHaveLength(8);
  expect(new Set(facts).size).toBe(8);
  expect(new Set(needs.map((d) => d.owner.sheet))).toEqual(
    new Set(
      result.value.coverage.topology.assemblies.flatMap((a) =>
        a.appearances.map((p) => p.sheet),
      ),
    ),
  );
});

it("keeps an omitted native port's declaration on every source part", () => {
  const owner = ir.devices.find((d) => d.designation === "R1");
  if (!owner) throw Error("Missing native connector owner");
  const seed: DocumentNeedSeed = {
    noteId: `connector-port-status/${JSON.stringify([owner.uid, "X9"])}`,
    need: "connector-port-status",
    subject: "R1.X9 → connector port status",
    requiredFacts: [
      { kind: "connector-port-status", deviceUid: owner.uid, portKey: "X9" },
    ],
    requiredColumns: ["identity", "endpoints", "status"],
  };
  const part = dependencyDraft(ir, [seed]);
  part.view = {
    format: "documentation-view/0.1",
    kind: "connector-assembly",
    title: "Native part",
  };
  const needs = documentDependencies(ir, [part, structuredClone(part)]);
  expect(needs.map((d) => d.owner.sheet)).toEqual([1, 2]);
  expect(new Set(needs.map((d) => d.id)).size).toBe(1);
  expect(needs.map((d) => d.requiredFacts)).toEqual([
    seed.requiredFacts,
    seed.requiredFacts,
  ]);
});
