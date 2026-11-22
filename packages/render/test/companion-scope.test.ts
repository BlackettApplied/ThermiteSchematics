import { afterAll, beforeAll, expect, it } from "vitest";
import { compileProject } from "@thermite/compiler";
import { buildDocumentation } from "@thermite/query";
import { offViewFixture } from "./off-view-fixtures.js";
import {
  wireNeed,
  dependencyDraft,
  documentPaper,
} from "./document-fixture.js";
import {
  companionNotes,
  factTable,
  rowFacts,
} from "../src/packet/document-facts.js";
import { appendDocumentCompanions } from "../src/packet/document-companions.js";

let source: Awaited<ReturnType<typeof offViewFixture>>;
beforeAll(async () => {
  source = await offViewFixture();
});
afterAll(async () => {
  await source.dispose();
});
it("counts unique conductor rows, not repeated endpoint incidences, and discloses supplementary purpose", () => {
  const need = wireNeed(source.ir);
  const table = factTable(source.ir, "wires", [
    ...need.requiredFacts,
    ...need.requiredFacts,
  ]);
  const wire = source.ir.wires.find((w) => w.designation === "W3");
  expect(table.rows.map((r) => r.key)).toEqual([wire?.uid]);
  expect(table.title).toBe("Supplementary connections");
  expect(table.notes.join(" ")).toContain(
    "1 conductor row for source-detail notes",
  );
  expect(table.notes.join(" ")).toContain("not a complete inventory");
  expect(table.selection).toBeUndefined();
});
it("names a cable-core-only companion accurately without adding or dropping cores", () => {
  const cable = source.ir.cables[0];
  if (!cable) throw new Error("missing cable");
  const table = factTable(source.ir, "wires", [
    { kind: "core-inventory", cableUid: cable.uid, conductorId: "2" },
  ]);
  expect(table.title).toBe("Supplementary cable cores");
  expect(table.rows.map((r) => r.key)).toEqual([
    JSON.stringify([cable.uid, "2"]),
  ]);
  expect(table.notes.join(" ")).toContain(
    "1 conductor row for source-detail notes",
  );
});
it("carries the truthful scope into automatically issued companion sheets", () => {
  const need = wireNeed(source.ir);
  const closed = appendDocumentCompanions(
    source.ir,
    [dependencyDraft(source.ir, [need, { ...need, noteId: "again" }])],
    documentPaper(),
  );
  if (!closed.ok) throw new Error(closed.error.message);
  const generated = closed.value.filter((d) => d.autoDocumentOrigin);
  expect(generated).toHaveLength(1);
  expect(generated[0]?.view.title).toBe("Supplementary connections");
  expect(generated[0]?.documentHeader?.labelText).toBe(
    "Supplementary connections — wire inventory",
  );
  expect(generated[0]?.content).toContain(
    "1 conductor row for source-detail notes",
  );
  expect(generated[0]?.documentRows).toHaveLength(1);
});
it("keeps full requested schedules complete and requested device filters independently verifiable", () => {
  const full = buildDocumentation(source.ir, {
    format: "documentation-view-request/0.1",
    kind: "wires",
  });
  const native = [...source.ir.wires, ...source.ir.jumpers].map((w) => w.uid);
  for (const cable of source.ir.cables) {
    const type = source.ir.cableTypes.find((t) => t.id === cable.typeId);
    if (!type) throw new Error("missing cable type");
    native.push(
      ...type.conductors.map((c) => JSON.stringify([cable.uid, c.id])),
    );
  }
  expect(full.rows.map((r) => r.key).sort()).toEqual(native.sort());
  expect(full.title).not.toContain("Supplementary");
  expect(full.selection).toBeUndefined();
  const filtered = buildDocumentation(source.ir, {
    format: "documentation-view-request/0.1",
    kind: "wires",
    filter: { devices: ["H1"] },
  });
  const h1 = source.ir.devices.find((d) => d.designation === "H1");
  expect(filtered.rows.map((r) => r.key).sort()).toEqual(
    source.ir.wires
      .filter((w) => w.endpoints.some((e) => e.terminal.deviceUid === h1?.uid))
      .map((w) => w.uid)
      .sort(),
  );
  expect(filtered.selection?.retainedRows).toBe(filtered.rows.length);
  expect(filtered.selection?.totalRows).toBe(native.length);
  expect(filtered.title).toContain("(filtered)");
});

it("does not retain an intermediate device-filter count or a full-terminal promise on a partial companion", () => {
  const device = source.ir.devices.find((d) => d.designation === "H1");
  if (!device) throw new Error("missing fixture device");
  const terminal = { deviceUid: device.uid, terminalKey: "X1" };
  const table = factTable(source.ir, "terminals", [
    { kind: "terminal-inventory", terminal },
  ]);
  expect(table.rows.map((r) => r.key)).toEqual([
    JSON.stringify([device.uid, "X1"]),
  ]);
  expect(table.notes.join(" ")).toContain(
    "1 terminal row for source-detail notes",
  );
  expect(table.notes.join(" ")).not.toMatch(
    /Filtered report:|Lists every terminal|Device-owned rows follow/,
  );
  expect(table.selection).toBeUndefined();
});

it("identifies a complete unfiltered network companion as all native rows", async () => {
  const compiled = await compileProject("examples/operator-console");
  if (!compiled.ok) throw new Error("fixture compilation failed");
  const native = buildDocumentation(compiled.ir, {
    format: "documentation-view-request/0.1",
    kind: "network",
  });
  const table = factTable(
    compiled.ir,
    "network",
    native.rows.flatMap((r) => rowFacts(compiled.ir, native, r.key).facts),
  );
  expect(native.rows).toHaveLength(3);
  expect(table.rows).toEqual(native.rows);
  expect(table.notes.join(" ")).toContain("all 3 network rows");
  expect(table.notes.at(-1)).toBe(
    "Supplementary scope: all 3 network rows for source-detail notes; not a safety assessment.",
  );
  expect(table.notes.join(" ")).not.toMatch(/not a complete|partial/);
});
it("does not assert absent terminal details or a globally incomplete inventory", () => {
  const device = source.ir.devices.find((d) => d.designation === "H1");
  if (!device) throw new Error("missing fixture device");
  const table = factTable(source.ir, "terminals", [
    {
      kind: "terminal-inventory",
      terminal: { deviceUid: device.uid, terminalKey: "X1" },
    },
  ]);
  expect(table.rows.every((r) => r.cells.at(-1) === "Terminated")).toBe(true);
  expect(table.notes.join(" ")).toContain(
    "Selected terminal rows may include unconnected terminals and explicit jumpers",
  );
  expect(table.notes.join(" ")).not.toMatch(
    /not a complete|partial|Selected terminal rows include/,
  );
});

it("removes internal filter notes by identity even when native notes follow them", () => {
  const table = buildDocumentation(source.ir, {
    format: "documentation-view-request/0.1",
    kind: "terminals",
    filter: { devices: ["H1"] },
  });
  const nativeNote = "Native note retained after internal query notes.";
  const augmented = {
    ...table,
    notes: [...table.notes.slice(-2), nativeNote, ...table.notes.slice(0, -2)],
  };
  const notes = companionNotes(
    augmented,
    table.rows.slice(0, 1),
    source.ir.devices.length,
  );
  expect(notes).toContain(nativeNote);
  expect(notes.join(" ")).toContain("Terminals follow the authored order");
  expect(notes.join(" ")).not.toMatch(
    /Filtered report:|Device-owned rows follow/,
  );
  expect(notes.join(" ")).not.toContain("not a complete inventory");
});

it("does not call all filtered operator-console terminal rows a complete native inventory", async () => {
  const compiled = await compileProject("examples/operator-console");
  if (!compiled.ok) throw new Error("fixture compilation failed");
  const native = buildDocumentation(compiled.ir, {
    format: "documentation-view-request/0.1",
    kind: "terminals",
  });
  const filtered = buildDocumentation(compiled.ir, {
    format: "documentation-view-request/0.1",
    kind: "terminals",
    filter: { devices: ["HMI1", "K-B", "K-G", "K-R", "K-Y", "KP8", "SL1"] },
  });
  const table = factTable(
    compiled.ir,
    "terminals",
    filtered.rows.flatMap(
      (row) => rowFacts(compiled.ir, filtered, row.key).facts,
    ),
  );
  expect(native.rows).toHaveLength(24);
  expect(filtered.rows).toHaveLength(46);
  expect(filtered.selection?.retainedRows).toBe(46);
  expect(table.rows).toEqual(filtered.rows);
  expect(table.notes.join(" ")).toContain(
    "46 terminal rows for source-detail notes",
  );
  expect(table.notes.join(" ")).not.toMatch(/all \d+ terminal/);
});
