import { beforeAll, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseHTML } from "linkedom";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import { buildDocumentation } from "@thermite/query";
import { renderSchematicPacket } from "../src/sheets.js";
import type { SchematicPacketRequest } from "../src/packet/types.js";
import { rowFacts } from "../src/packet/document-facts.js";

let ir: ElectricalIr, request: SchematicPacketRequest;
beforeAll(async () => {
  const path = resolve("examples/topology-coverage");
  const c = await compileProject(path);
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  ir = c.ir;
  request = JSON.parse(await readFile(resolve(path, "packet.json"), "utf8"));
});

it("exports native port-status semantics for each unoccupied connector row", () => {
  const table = buildDocumentation(ir, {
    format: "documentation-view-request/0.1",
    kind: "assemblies",
  });
  const rows = table.rows.filter((r) => r.cells[3] === "Unoccupied");
  expect(rows).toHaveLength(3);
  for (const row of rows) {
    const [deviceUid, portKey] = JSON.parse(row.key);
    expect(rowFacts(ir, table, row.key)).toEqual({
      facts: [{ kind: "connector-port-status", deviceUid, portKey }],
      columns: ["identity", "endpoints", "status"],
    });
    expect(row.cells[0]).toBe("--");
    expect(row.cells[4]).toBe("No assembly declared");
  }
});

it("exports both native endpoint statuses beside each occupied assembly fact", () => {
  const table = buildDocumentation(ir, {
    format: "documentation-view-request/0.1",
    kind: "assemblies",
  });
  for (const relation of ir.relations) {
    if (!relation.assembly) continue;
    expect(rowFacts(ir, table, relation.uid).facts).toEqual([
      { kind: "assembly-pin-map", relationUid: relation.uid },
      {
        kind: "connector-port-status",
        deviceUid: relation.fromDeviceUid,
        portKey: relation.assembly.fromPort,
      },
      {
        kind: "connector-port-status",
        deviceUid: relation.toDeviceUid,
        portKey: relation.assembly.toPort,
      },
    ]);
  }
});

it("declares assembly reasons on their native drawn parts and reuses issued rows", async () => {
  const result = await renderSchematicPacket(ir, request);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const needs =
    result.value.navigation?.dependencies?.filter(
      (d) => d.noteId === "assembly-reasons",
    ) ?? [];
  expect(needs.length).toBeGreaterThan(0);
  const selected = new Set(
    result.value.coverage.topology.assemblies
      .filter((a) => a.appearances.length)
      .map((a) => a.id),
  );
  expect(
    new Set(
      needs.flatMap((d) =>
        d.requiredFacts.flatMap((f) =>
          f.kind === "assembly-pin-map" ? [f.relationUid] : [],
        ),
      ),
    ),
  ).toEqual(selected);
  for (const need of needs) {
    expect(need.resolution.length).toBeGreaterThan(0);
    expect(need.caption?.text).toMatch(/assembly inventory \d{2}.[A-D][1-6]/u);
  }
  expect(
    needs
      .flatMap((d) => d.resolution)
      .every((r) => !r.documentId.startsWith("auto-document")),
  ).toBe(true);
});

it("fits the complete native CBL1 inline row on the original graphical sheet", async () => {
  const dir = resolve("examples/assembly-note-bounds");
  const c = await compileProject(dir);
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  const input = JSON.stringify(c.ir);
  const spec: SchematicPacketRequest = JSON.parse(
    await readFile(resolve(dir, "packet.json"), "utf8"),
  );
  const result = await renderSchematicPacket(c.ir, spec, c.presentation);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.sheets).toHaveLength(1);
  const first = result.value.sheets[0];
  if (!first) throw Error("Missing graphical sheet");
  const doc = parseHTML(first.svg).document;
  expect(doc.querySelector('[data-document-kind="assemblies"]')).not.toBeNull();
  const document = result.value.navigation?.documents?.find(
    (d) => d.kind === "assemblies",
  );
  expect(document?.rows.map((r) => r.displayName)).toEqual(["CBL1"]);
  expect(document?.rows[0]?.sheet).toBe(1);
  expect(
    result.value.navigation?.dependencies?.find(
      (d) => d.noteId === "assembly-reasons",
    )?.caption?.text,
  ).toMatch(/assembly inventory 01.[A-D][1-6] \(CBL1\)/u);
  expect(JSON.stringify(c.ir)).toBe(input);
});

it("prints the native protective-cap disposition and reason without electrical pin tuples", async () => {
  const result = await renderSchematicPacket(ir, request);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const cap = ir.relations.find((r) => r.designation === "CAP-X2");
  if (!cap?.assembly) throw Error("Missing native protective cap");
  expect(cap.assembly.pinMapping.status).toBe("not-applicable");
  const table = buildDocumentation(ir, {
    format: "documentation-view-request/0.1",
    kind: "assemblies",
  });
  const native = table.rows.find((r) => r.key === cap.uid);
  if (!native?.cells[4]) throw Error("Missing cap reason row");
  const rows = result.value.sheets.flatMap((s) =>
    [...parseHTML(s.svg).document.querySelectorAll("[data-report-row]")].filter(
      (r) => r.getAttribute("data-report-row") === cap.uid,
    ),
  );
  expect(rows).toHaveLength(1);
  const painted = rows[0]?.textContent.replace(/\s+/gu, "");
  expect(painted).toContain(native.cells[4].replace(/\s+/gu, ""));
  expect(painted).not.toContain("1->1");
  expect(painted).not.toContain("1→1");
});
