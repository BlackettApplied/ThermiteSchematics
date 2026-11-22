import { beforeAll, afterAll, expect, it } from "vitest";
import { offViewFixture } from "./off-view-fixtures.js";
import {
  documentDependencies,
  appendDocumentCompanions,
} from "../src/packet/document-companions.js";
import {
  dependencyDraft,
  wireNeed,
  documentPaper,
} from "./document-fixture.js";
import {
  wiringHiddenIncidences,
  omittedTerminalNeed,
} from "../src/packet/document-producers.js";
import { factKey } from "../src/packet/document-facts.js";
import { renderSchematicPacket } from "../src/sheets.js";

let source: Awaited<ReturnType<typeof offViewFixture>>;
beforeAll(async () => {
  source = await offViewFixture();
});
afterAll(async () => {
  await source.dispose();
});
it.each([
  "extra",
  "kind",
  "fact-extra",
  "terminal-extra",
  "foreign-end",
  "wrong-end",
  "duplicate",
  "missing-column",
  "count",
  "empty-id",
])("refuses invalid dependency %s", (mutation) => {
  const need = structuredClone(wireNeed(source.ir)) as any;
  if (mutation === "extra") need.unrecognized = true;
  if (mutation === "kind") need.need = "unsupported";
  if (mutation === "fact-extra") need.requiredFacts[0].unrecognized = true;
  if (mutation === "terminal-extra")
    need.requiredFacts[0].terminal.unrecognized = true;
  if (mutation === "foreign-end")
    need.requiredFacts[0].terminal.terminalKey = "FOREIGN";
  if (mutation === "wrong-end") need.requiredFacts[0].end = 1;
  if (mutation === "duplicate") {
    need.requiredFacts.push(need.requiredFacts[0]);
    need.count = 3;
  }
  if (mutation === "missing-column") need.requiredColumns = ["identity"];
  if (mutation === "count") need.count = 900;
  if (mutation === "empty-id") need.noteId = "";
  expect(() =>
    documentDependencies(source.ir, [dependencyDraft(source.ir, [need])]),
  ).toThrow();
  const result = appendDocumentCompanions(
    source.ir,
    [dependencyDraft(source.ir, [need])],
    documentPaper(),
  );
  expect(result.ok).toBe(false);
  if (result.ok) throw Error("must refuse");
  expect(result.error.code).toBe("R006");
});
it("makes source note and dependency identity independent of sheet insertion", () => {
  const d = dependencyDraft(source.ir, [wireNeed(source.ir)]);
  const first = documentDependencies(source.ir, [d])[0]!;
  const moved = documentDependencies(source.ir, [
    dependencyDraft(source.ir),
    d,
  ])[0]!;
  expect(moved.id).toBe(first.id);
  expect(moved.owner.noteId).toBe(first.owner.noteId);
  expect([first.owner.sheet, moved.owner.sheet]).toEqual([1, 2]);
});
it("rejects duplicate note identities instead of silently dropping a promise", () => {
  const need = wireNeed(source.ir);
  expect(() =>
    documentDependencies(source.ir, [dependencyDraft(source.ir, [need, need])]),
  ).toThrow(/Duplicate document note/);
});
it("keeps fact keys deterministic across object property insertion order", () => {
  const fact = wireNeed(source.ir).requiredFacts[0]!;
  expect(factKey(fact)).toBe(
    factKey(Object.fromEntries(Object.entries(fact).reverse()) as typeof fact),
  );
});
it("defensively counts both endpoint ordinals and singly ended core facts", () => {
  const ir = structuredClone(source.ir),
    uid = ir.devices.find((d) => d.designation === "PS1")!.uid;
  // Same-terminal source wires are invalid (separate E024 control below). The
  // defensive IR census must nevertheless not merge endpoint ordinals.
  const loop = structuredClone(ir.wires[0]!);
  loop.uid = "69000000-0000-4000-8000-000000000001";
  loop.endpoints = [
    { ...loop.endpoints[0]!, terminal: { deviceUid: uid, terminalKey: "-" } },
    { ...loop.endpoints[1]!, terminal: { deviceUid: uid, terminalKey: "-" } },
  ];
  ir.wires.push(loop);
  const terminal = { deviceUid: uid, terminalKey: "-" },
    selected = ir.wires.find((w) => w.designation === "W2")!.uid;
  const hidden = wiringHiddenIncidences(
    ir,
    new Set([selected]),
    new Map([[JSON.stringify([uid, "-"]), terminal]]),
  ).needs[0]!;
  expect(hidden.count).toBe(6); // W4, two jumpers, one singly ended core, two synthetic loop incidences.
  const ends = hidden.requiredFacts.filter(
    (f) =>
      f.kind === "conductor-incidence" &&
      f.element.kind === "wire" &&
      f.element.uid === loop.uid,
  );
  expect(
    ends.map((f) => (f.kind === "conductor-incidence" ? f.end : -1)),
  ).toEqual([0, 1]);
  expect(omittedTerminalNeed(ir, uid, ["-", "+"])!.requiredFacts.length).toBe(
    ir.deviceTypes.find(
      (t) => t.id === ir.devices.find((d) => d.uid === uid)!.typeId,
    )!.terminals.length - 2,
  );
});
it("preserves strict E024 rejection of same-terminal source conductors", async () => {
  await expect(
    offViewFixture((objects) =>
      objects.push({
        kind: "wire",
        uid: "69000000-0000-4000-8000-000000000001",
        designation: "LOOP",
        endpoints: [
          { device: "PS1", terminal: "-" },
          { device: "PS1", terminal: "-" },
        ],
      }),
    ),
  ).rejects.toThrow(/E024/);
});
it.each([
  [],
  Array(41).fill({ format: "documentation-view-request/0.1", kind: "wires" }),
])("preserves the public 1–40 request limit", async (views) => {
  const result = await renderSchematicPacket(source.ir, {
    format: "schematic-packet-request/0.1",
    views,
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw Error("must refuse");
  expect(result.error.message).toContain("1–40");
});
it("UID-resolves wiring and cable-assembly selections for persistent note ownership", async () => {
  const { navigationViewKey } =
    await import("../src/packet/navigation-identity.js");
  const wire = source.ir.wires.find((w) => w.designation === "W1")!;
  const a = {
      format: "wiring-view-request/0.1",
      title: "One",
      conductors: ["W1"],
    },
    b = { ...a, title: "Renamed", conductors: [wire.uid] };
  expect(navigationViewKey(source.ir, a, 0)).toBe(
    navigationViewKey(source.ir, b, 0),
  );
  const cable = source.ir.cables[0]!;
  const c = {
    format: "signal-loop-view-request/0.1",
    cableAssemblies: [
      {
        cable: cable.designation,
        connector: "X",
        description: "Source description",
      },
    ],
  };
  expect(navigationViewKey(source.ir, c, 0)).toBe(
    navigationViewKey(
      source.ir,
      {
        ...c,
        cableAssemblies: [{ ...c.cableAssemblies[0], cable: cable.uid }],
      },
      0,
    ),
  );
});
