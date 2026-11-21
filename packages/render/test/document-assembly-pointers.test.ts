import { expect, it } from "vitest";
import { compileProject } from "@thermite/compiler";
import { buildConnectorAssemblyInventory } from "@thermite/query";
import { dependencyDraft, documentPaper } from "./document-fixture.js";
import type { RenderedSheet } from "../src/packet/types.js";
import { assemblyPortPointers } from "../src/packet/document-assembly-pointers.js";
import { parseHTML } from "linkedom";
import { readFile } from "node:fs/promises";
import { renderSchematicPacket } from "../src/sheets.js";

it("pairs each drawn port with its own native sheet and zone, never an inventory", async () => {
  const c = await compileProject("examples/assembly-note-bounds");
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  const owner = c.ir.devices.find((d) => d.designation === "R1");
  if (!owner) throw Error("Missing native connector owner");
  const ports = buildConnectorAssemblyInventory(c.ir).ports.filter(
    (p) => p.deviceUid === owner.uid,
  );
  expect(ports.slice(0, 3).map((p) => p.key)).toEqual(["X1", "X2", "X3"]);
  const points = [
    { x: 10, y: 15 },
    { x: 50, y: 45 },
    { x: 100, y: 90 },
  ];
  const drafts = points.map(() => {
    const draft = dependencyDraft(c.ir);
    draft.view = {
      format: "documentation-view/0.1",
      kind: "connector-assembly",
      title: "Native port fixture",
    };
    draft.drawingBounds = { x: 0, y: 0, w: 120, h: 120 };
    return draft;
  });
  const sheets: RenderedSheet[] = points.map((point, i) => {
    const draft = drafts[i],
      port = ports[i];
    if (!draft || !port) throw Error("Missing native port fixture");
    return {
      number: i + 1,
      view: draft.view,
      references: [],
      continuations: [],
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="120mm" height="120mm" viewBox="0 0 120 120"><g data-device-uid="${owner.uid}"><g data-connector-port="${port.key}"><circle cx="${point.x}" cy="${point.y}" r="1.1" fill="white" stroke="black" stroke-width=".4"/><text x="${point.x + 2}" y="${point.y + 1}" font-size="2.7">${port.key}</text></g></g></svg>`,
    };
  });
  const source = JSON.stringify(c.ir);
  const result = assemblyPortPointers(
    c.ir,
    drafts,
    sheets,
    documentPaper(),
    [],
  );
  const first = result[0];
  if (!first) throw Error("Missing pointer sheet");
  const caption = parseHTML(first.svg)
    .document.querySelector("[data-assembly-port-destinations]")
    ?.textContent.replace(/\s+/gu, " ");
  expect(caption).toContain("Port R1.X2 → 02.B3;");
  expect(caption).toContain("Port R1.X3 → 03.D6.");
  expect(caption).not.toMatch(/inventory|schedule/u);
  expect(caption).not.toContain("Port R1.X4");
  expect(JSON.stringify(c.ir)).toBe(source);
});

it("fits every drawn-port pointer on the existing A4 compact cap source sheets", async () => {
  const c = await compileProject("examples/cap-pagination");
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  const request = JSON.parse(
    await readFile("examples/cap-pagination/packet.json", "utf8"),
  );
  const result = await renderSchematicPacket(c.ir, {
    ...request,
    page: { size: "a4", orientation: "landscape" },
    layout: "compact",
    views: [request.views[0]],
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  // Six native graphical parts remain; no extra graphical page buys a pointer slot.
  expect(
    result.value.sheets.filter((s) => s.view.kind === "connector-assembly"),
  ).toHaveLength(6);
  const sixth = result.value.sheets[5];
  expect(sixth?.view.kind).toBe("connector-assembly");
  const pointer = parseHTML(sixth?.svg ?? "").document.querySelector(
    "[data-assembly-port-destinations]",
  );
  expect(pointer).not.toBeNull();
  expect(pointer?.textContent).toBe(
    "Port R1.X01 → 01.B3; Port R1.X02 → 01.C3; Port R1.X03 → 02.B3; Port R1.X04 → 02.C3; Port R1.X05 → 03.B3; Port R1.X06 → 03.C3; Port R1.X07 → 04.B3; Port R1.X08 → 04.C3.",
  );
  for (const text of pointer?.querySelectorAll("text") ?? [])
    expect(Number(text.getAttribute("font-size"))).toBe(2.5);
});
