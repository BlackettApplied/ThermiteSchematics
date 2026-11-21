import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import {
  dependencyDraft,
  documentPaper,
  fixtureSheets,
} from "./document-fixture.js";
import { appendDocumentCompanions } from "../src/packet/document-companions.js";
import { finalizeNavigation } from "../src/packet/navigation-finalize.js";
import { compactDocumentCaption } from "../src/packet/document-caption-compact.js";
import { parseSvg } from "./off-view-fixtures.js";
import type {
  DocumentDependency,
  DocumentNeedSeed,
} from "../src/packet/document-types.js";
import * as native from "../src/packet/document-native.js";

let ir: ElectricalIr, uid: string;
const ports = ["IN", "OUT", "B1", "B2", "B3", "SPARE"];
afterEach(() => vi.restoreAllMocks());
beforeAll(async () => {
  const c = await compileProject("examples/network-pagination");
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  ir = c.ir;
  uid = ir.devices.find((d) => d.designation === "N01")!.uid;
});
function compactFixture(width: number) {
  const need: DocumentNeedSeed = {
    noteId: "ports",
    need: "port-link-status",
    subject: "Ports",
    requiredFacts: ports.map((portKey) => ({
      kind: "port-link-status",
      deviceUid: uid,
      portKey,
    })),
    requiredColumns: ["identity", "endpoints", "protocol", "status"],
  };
  const d = dependencyDraft(ir, [need]);
  d.drawingBounds = { x: 30, y: 60, w: width, h: 6 };
  const closed = appendDocumentCompanions(ir, [d], documentPaper());
  if (!closed.ok) throw Error(JSON.stringify(closed.error));
  const sheets = fixtureSheets(ir, closed.value);
  const result = finalizeNavigation(ir, closed.value, sheets, {
    page: documentPaper(),
    documents: { presentation: undefined, standalone: false },
  });
  return { result, sheets };
}
function success(width: number) {
  const { result, sheets } = compactFixture(width);
  if (!result.ok) throw Error(JSON.stringify(result.error));
  return { ...result.value, before: sheets };
}
it("prefers all per-identity profiles before the compact form", () => {
  const packet = success(120);
  const caption = packet.navigation.dependencies![0]!.caption!;
  expect(caption.form).toBe("identities");
  expect(caption.groups).toBeUndefined();
  expect(caption.text).toBe(
    "Ports: network inventory 02.A4 (NET01, N01: B1); 02.B4 (N01: B2, N01: B3, N01: IN, N01: SPARE).",
  );
});
it("falls back to compact native counts in the six-mm caption strip", () => {
  const packet = success(90);
  const need = packet.navigation.dependencies![0]!;
  const caption = need.caption!;
  expect(caption.form).toBe("compact");
  expect(caption.text).toBe(
    "Ports: network inventory 02.A4 (N01: 2 ports); 02.B4 (N01: 4 ports).",
  );
  expect(caption.text).not.toContain("N01.");
  expect(
    caption.groups!.map((g) => [g.sheet, g.zone, g.count, g.owner]),
  ).toEqual([
    [2, "A4", 2, { kind: "device", uid }],
    [2, "B4", 4, { kind: "device", uid }],
  ]);
  const expected = ports
    .map((key) => JSON.stringify(["port-link-status", uid, key]))
    .sort();
  expect(caption.groups!.flatMap((g) => g.factKeys).sort()).toEqual(expected);
  expect(new Set(caption.groups!.flatMap((g) => g.factKeys)).size).toBe(6);
  for (const group of caption.groups!) {
    expect(group.count).toBe(group.factKeys.length);
    const document = packet.navigation.documents!.find(
      (d) => d.id === group.documentId,
    )!;
    for (const id of group.rows) {
      const row = document.rows.find((r) => r.id === id)!;
      expect([row.sheet, row.zone]).toEqual([group.sheet, group.zone]);
      const ink = parseSvg(packet.sheets[row.sheet - 1]!.svg).getElementById(
        row.primitiveId,
      )!;
      expect(ink.textContent).toContain("N01:");
    }
  }
  const ink = parseSvg(packet.sheets[0]!.svg).querySelector(
    "[data-document-dependency]",
  )!;
  expect(ink.getAttribute("data-document-caption-form")).toBe("compact");
  expect(ink.querySelectorAll("text")).toHaveLength(1);
  expect(packet.before[0]!.svg).not.toContain("data-document-dependency");
});
it("refuses only after identity and compact profiles both fail", () => {
  const { result } = compactFixture(80);
  expect(result.ok).toBe(false);
  if (result.ok) throw Error("must refuse");
  expect(result.error.code).toBe("R006");
  expect(result.error.message).toContain(
    "identity and compact forms cannot fit",
  );
  expect(result.error.details).toMatchObject({
    sheet: 1,
    subjects: ["Ports"],
    identityFormError: expect.any(String),
    compactFormError: expect.any(String),
  });
});
it("counts only the scoped subset, even when a chosen row contains its peer's fact", () => {
  const p = success(120),
    need = structuredClone(p.navigation.dependencies![0]!);
  need.requiredFacts = need.requiredFacts.filter(
    (f) => f.kind === "port-link-status" && f.portKey === "OUT",
  );
  const compact = compactDocumentCaption(ir, need, p.navigation.documents!);
  expect(compact.tokens.join(" ")).toBe(
    "Ports: network inventory 02.A4 (N01: 1 port).",
  );
  expect(compact.groups).toHaveLength(1);
  expect(compact.groups[0]!.factKeys).toEqual([
    JSON.stringify(["port-link-status", uid, "OUT"]),
  ]);
});
it("partitions each fact once across repeated resolution rows", () => {
  const p = success(90),
    need = structuredClone(p.navigation.dependencies![0]!);
  need.resolution = [...need.resolution, ...need.resolution];
  const c = compactDocumentCaption(ir, need, p.navigation.documents!);
  expect(c.groups.map((g) => g.count)).toEqual([2, 4]);
});
it("keeps separate devices in one shared native link row", () => {
  const p = success(120),
    need = structuredClone(p.navigation.dependencies![0]!);
  const other = ir.devices.find((d) => d.designation === "N02")!.uid;
  need.requiredFacts = [
    { kind: "port-link-status", deviceUid: uid, portKey: "OUT" },
    { kind: "port-link-status", deviceUid: other, portKey: "IN" },
  ];
  const c = compactDocumentCaption(ir, need, p.navigation.documents!);
  expect(c.tokens.join(" ")).toBe(
    "Ports: network inventory 02.A4 (N01: 1 port); 02.A4 (N02: 1 port).",
  );
  expect(c.groups.map((g) => g.count)).toEqual([1, 1]);
  expect(c.groups[0]!.rows).toEqual(c.groups[1]!.rows);
});
it.each(["membership", "printed name"])(
  "refuses a compact device missing native row %s",
  (mode) => {
    const p = success(120),
      need = p.navigation.dependencies![0]!;
    const original = native.nativeDocumentTable;
    vi.spyOn(native, "nativeDocumentTable").mockImplementation((...args) => {
      const table = original(...args)!;
      return {
        ...table,
        rows: table.rows.map((r) => ({
          ...r,
          ...(mode === "membership"
            ? { deviceUids: [] }
            : {
                cells: r.cells.map((c) => c.replaceAll("N01", "Wrong device")),
              }),
        })),
      };
    });
    expect(() =>
      compactDocumentCaption(ir, need, p.navigation.documents!),
    ).toThrow(
      mode === "membership"
        ? "absent from its native row"
        : "not printed in its native row",
    );
  },
);
it("rejects forged row ownership and missing compact facts", () => {
  const p = success(120),
    need = structuredClone(
      p.navigation.dependencies![0]!,
    ) as DocumentDependency;
  const documents = structuredClone(p.navigation.documents!);
  const first = documents.find((d) => d.id === need.resolution[0]!.documentId)!;
  const row = first.rows.find((r) => r.id === need.resolution[0]!.rows[0])!;
  row.facts = [{ kind: "port-link-status", deviceUid: uid, portKey: "SPARE" }];
  need.requiredFacts = row.facts;
  expect(() => compactDocumentCaption(ir, need, documents)).toThrow(
    "absent from its native row",
  );
  need.resolution = [];
  expect(() => compactDocumentCaption(ir, need, documents)).toThrow(
    "unresolved facts",
  );
});
it("refuses nonempty compact output that leaves part of the scope unresolved", () => {
  const p = success(120),
    need = structuredClone(p.navigation.dependencies![0]!);
  need.resolution = [
    { ...need.resolution[0]!, rows: [need.resolution[0]!.rows[0]!] },
  ];
  expect(() =>
    compactDocumentCaption(ir, need, p.navigation.documents!),
  ).toThrow("unresolved facts");
});

it("uses assembly/assemblies for compact native assembly groups", async () => {
  const { documentLoopFixture } = await import("./document-loop-fixture.js");
  const source = await documentLoopFixture();
  try {
    const { documentIdentity } =
      await import("../src/packet/document-facts.js");
    const { issuedDocuments } =
      await import("../src/packet/document-registry.js");
    const { reportFixture } = await import("./document-fixture.js");
    const drafts = reportFixture(source.ir, {
      format: "documentation-view-request/0.1",
      kind: "assemblies",
    });
    const docs = issuedDocuments(
      source.ir,
      drafts,
      fixtureSheets(source.ir, drafts),
      documentPaper(),
    );
    const relation = source.ir.relations.find((r) => !!r.assembly)!;
    const need: DocumentDependency = {
      ...documentIdentity(source.ir),
      id: "need",
      noteId: "assembly",
      need: "assembly-pin-map",
      subject: "Assembly",
      requiredFacts: [{ kind: "assembly-pin-map", relationUid: relation.uid }],
      requiredColumns: ["identity", "endpoints", "status", "pin-map"],
      owner: { viewKey: "view", noteId: "assembly", sheet: 1 },
      resolution: [{ documentId: docs[0]!.id, rows: [docs[0]!.rows[0]!.id] }],
    };
    expect(
      compactDocumentCaption(source.ir, need, docs).tokens.join(" "),
    ).toContain("(TX1: 1 assembly)");
    expect(
      compactDocumentCaption(source.ir, need, docs).tokens.join(" "),
    ).not.toContain("assemblie)");
  } finally {
    await source.dispose();
  }
});
