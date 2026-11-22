import { beforeAll, afterAll, expect, it } from "vitest";
import { offViewFixture } from "./off-view-fixtures.js";
import {
  reportFixture,
  wireNeed,
  fixtureSheets,
  documentPaper,
} from "./document-fixture.js";
import {
  issuedDocuments,
  resolveDocumentNeed,
} from "../src/packet/document-registry.js";
import { documentDependencies } from "../src/packet/document-companions.js";
import { dependencyDraft } from "./document-fixture.js";

let source: Awaited<ReturnType<typeof offViewFixture>>;
beforeAll(async () => {
  source = await offViewFixture();
});
afterAll(async () => {
  await source.dispose();
});
const wire = (name: string) =>
  source.ir.wires.find((w) => w.designation === name)!.uid;
function resolve(
  groups: readonly { id: string; names: string[] }[],
  names = ["W3", "W3b"],
) {
  const drafts = groups.flatMap((g) =>
    reportFixture(
      source.ir,
      { format: "documentation-view-request/0.1", kind: "wires" },
      g.names.map(wire),
      g.id,
    ),
  );
  const documents = issuedDocuments(
    source.ir,
    drafts,
    fixtureSheets(source.ir, drafts),
    documentPaper(),
  );
  const seeds = names.map((name) => wireNeed(source.ir, name));
  const seed = {
    ...seeds[0]!,
    requiredFacts: seeds.flatMap((n) => n.requiredFacts),
    count: seeds.length * 2,
  };
  const need = documentDependencies(source.ir, [
    dependencyDraft(source.ir, [seed]),
  ])[0]!;
  return { documents, resolution: resolveDocumentNeed(need, documents) };
}
it("reuses one sufficient document before a union", () => {
  const r = resolve([
    { id: "A", names: ["W3"] },
    { id: "B", names: ["W3b"] },
    { id: "whole", names: ["W1", "W3", "W3b"] },
  ]);
  expect(r.resolution.map((r) => r.documentId)).toEqual(["whole"]);
});
it("prefers exact scope, then smallest sufficient superset, then authored order", () => {
  const groups = [
    { id: "big", names: ["W1", "W2", "W3", "W3b"] },
    { id: "small", names: ["W1", "W3", "W3b"] },
    { id: "exact", names: ["W3", "W3b"] },
    { id: "later", names: ["W3", "W3b"] },
  ];
  expect(resolve(groups).resolution.map((r) => r.documentId)).toEqual([
    "exact",
  ]);
  expect(
    resolve(groups.slice(0, 2)).resolution.map((r) => r.documentId),
  ).toEqual(["small"]);
});
it("resolves a sufficient union with each exact row and sheet", () => {
  const r = resolve([
    { id: "A", names: ["W3"] },
    { id: "B", names: ["W3b"] },
  ]);
  expect(r.resolution.map((r) => r.documentId)).toEqual(["A", "B"]);
  expect(
    r.resolution.flatMap((resolution) =>
      r.documents
        .find((d) => d.id === resolution.documentId)!
        .rows.filter((r) => resolution.rows.includes(r.id))
        .map((r) => [r.nativeKey, r.sheet, r.zone, r.anchorRule]),
    ),
  ).toEqual([
    [wire("W3"), 1, "A4", "row-region-center/1"],
    [wire("W3b"), 2, "A4", "row-region-center/1"],
  ]);
});
it("does not resolve a wrong-device, filtered or empty target by kind/title", () => {
  const r = resolve([
    { id: "misleading-title", names: ["Wfar"] },
    { id: "empty", names: [] },
  ]);
  expect(r.resolution).toEqual([]);
});
it("compares native row scope even when rows expose different numbers of typed facts", async () => {
  const f = await offViewFixture((objects) =>
    objects.push({
      kind: "cable",
      uid: "69000000-0000-4000-8000-000000000090",
      designation: "CBL2",
      type: "core:cordset-sensor-4core",
      conductors: [],
    }),
  );
  try {
    const core = JSON.stringify([
        f.ir.cables.find((c) => c.designation === "CBL1")!.uid,
        "4",
      ]),
      other = f.ir.cables.find((c) => c.designation === "CBL2")!.uid;
    const reports = [
      ...reportFixture(
        f.ir,
        { format: "documentation-view-request/0.1", kind: "wires" },
        [core, JSON.stringify([other, "1"]), JSON.stringify([other, "2"])],
        "earlier-extra-rows",
      ),
      ...reportFixture(
        f.ir,
        { format: "documentation-view-request/0.1", kind: "wires" },
        [core, f.ir.wires.find((w) => w.designation === "W3")!.uid],
        "smaller",
      ),
    ];
    const need = documentDependencies(f.ir, [
      dependencyDraft(f.ir, [
        {
          noteId: "core",
          need: "core-inventory",
          requiredFacts: [
            {
              kind: "core-inventory",
              cableUid: f.ir.cables.find((c) => c.designation === "CBL1")!.uid,
              conductorId: "4",
            },
          ],
          requiredColumns: ["identity", "endpoints", "status"],
          subject: "Core details",
        },
      ]),
    ])[0]!;
    const docs = issuedDocuments(
      f.ir,
      reports,
      fixtureSheets(f.ir, reports),
      documentPaper(),
    );
    expect(resolveDocumentNeed(need, docs).map((r) => r.documentId)).toEqual([
      "smaller",
    ]);
  } finally {
    await f.dispose();
  }
});
