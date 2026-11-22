import { afterAll, beforeAll, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  compileProject,
  serializeIr,
} from "../../packages/compiler/dist/index.js";
import { renderSchematicPacket } from "../../packages/render/dist/sheets.js";
import { embedPrintableFont } from "../../packages/cli/dist/printable-font.js";
import { launch, openSheet, drawingContextOptions } from "./browser.mjs";
import { assemblyAppearances } from "./assembly-appearances.mjs";
import {
  assemblySelection,
  assemblyPortNeeds,
  portId,
} from "./assembly-note-source.mjs";
import { assemblyDeliveryFindings } from "./assembly-note-delivery.mjs";
import { nativeRows } from "./m3-native.mjs";
import { issuedRows } from "./m3-documents.mjs";
import { text } from "./tranche4-fixtures.mjs";
let browser, packet, geometries, ir, request;
beforeAll(async () => {
  const compiled = await compileProject(resolve("examples/cap-pagination"));
  if (!compiled.ok) throw Error("Cap fixture did not compile");
  ir = JSON.parse(serializeIr(compiled.ir));
  request = JSON.parse(
    await readFile(resolve("examples/cap-pagination/packet.json"), "utf8"),
  );
  const r = await renderSchematicPacket(
    compiled.ir,
    request,
    compiled.presentation,
  );
  if (!r.ok) throw Error(r.error.message);
  packet = r.value;
  browser = await launch();
  const page = await browser.newPage(drawingContextOptions);
  await page.emulateMedia({ media: "print" });
  geometries = [];
  for (const s of packet.sheets)
    geometries.push(await openSheet(page, embedPrintableFont(s.svg)));
});
afterAll(async () => {
  await browser?.close();
});
it("S1 real cap-pagination sheet 1: X10 is drawn on part 2 and needs no unoccupied status row", () => {
  const uid = ir.devices.find((d) => d.designation === "R1").uid;
  const drawn = assemblyAppearances(packet, geometries, ir);
  const need = assemblyPortNeeds(
    geometries[0],
    assemblySelection(request.views[0], ir),
    ir,
    nativeRows(ir),
    drawn,
  ).find((n) => n.uid === uid && n.key === "X10");
  expect(need).toMatchObject({
    kind: "drawn-port",
    omitted: false,
    identity: portId(uid, "X10"),
  });
  expect(need.row).toBeUndefined();
  expect(need.targets[0].sheet).toBe(2);
  expect(need.targets[0].zones.length).toBeGreaterThan(0);
  const note = text(`X10 → P2/S02.${need.targets[0].zones[0]}`, {
    deviceUid: uid,
  });
  const rows = issuedRows(packet, geometries);
  expect(assemblyDeliveryFindings(note, [need], rows, 1)).toEqual([]);
  note.text = "X10 → P2/S99.A1";
  expect(assemblyDeliveryFindings(note, [need], rows, 1)).toHaveLength(1);
  note.text = "X10 → P2/S02.Z99";
  expect(assemblyDeliveryFindings(note, [need], rows, 1)).toHaveLength(1);
  note.text = "See other parts and assembly schedule";
  expect(assemblyDeliveryFindings(note, [need], rows, 1)).toHaveLength(1);
});
it("B1 real cap sheet 1: X10/X11 pointers cannot be swapped or pooled anonymously", () => {
  const uid = ir.devices.find((d) => d.designation === "R1").uid;
  const pair = assemblyPortNeeds(
    geometries[0],
    assemblySelection(request.views[0], ir),
    ir,
    nativeRows(ir),
    assemblyAppearances(packet, geometries, ir),
  ).filter((n) => n.uid === uid && ["X10", "X11"].includes(n.key));
  expect(pair).toHaveLength(2);
  expect(pair.every((n) => n.kind === "drawn-port")).toBe(true);
  const targets = pair.map(
    (n) => `S${n.targets[0].sheet}.${n.targets[0].zones[0]}`,
  );
  const n = text(`2 other ports: X10 → ${targets[0]}; X11 → ${targets[1]}`, {
    deviceUid: uid,
  });
  expect(assemblyDeliveryFindings(n, pair, [], 1)).toEqual([]);
  n.text = `2 other ports: X10 → ${targets[1]}; X11 → ${targets[0]}`;
  expect(assemblyDeliveryFindings(n, pair, [], 1)).toHaveLength(2);
  n.text = `2 other ports: see ${targets.join(", ")}`;
  expect(assemblyDeliveryFindings(n, pair, [], 1)).toHaveLength(2);
});
