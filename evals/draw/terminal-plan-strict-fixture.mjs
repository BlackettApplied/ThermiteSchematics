import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileProject } from "../../packages/compiler/dist/index.js";
import {
  renderSchematicPacket,
  printPacketHtml,
} from "../../packages/render/dist/index.js";
import { embedPrintableFont } from "../../packages/cli/dist/printable-font.js";
import { measurePacketGeometry } from "./packet-geometry.mjs";
import { buildSourceTables, scopeTables } from "./m3-documents.mjs";
import { buildDocumentation } from "../../packages/query/dist/index.js";
import { terminalPlanObservation } from "./document-observations.mjs";
import { observation } from "./evaluate.mjs";

export async function terminalPlanFixture(
  page,
  project = "motor-starter",
  override,
) {
  const c = await compileProject(`examples/${project}`);
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  const request = override ?? {
    format: "schematic-packet-request/0.1",
    index: false,
    views: [
      {
        format: "documentation-view-request/0.1",
        kind: "terminals",
        ...(project === "operator-console" ? { device: "XT-HMI" } : {}),
      },
    ],
  };
  const result = await renderSchematicPacket(c.ir, request);
  if (!result.ok) throw Error(JSON.stringify(result.error));
  const packet = result.value;
  const directory = await mkdtemp(join(tmpdir(), "thermite-check7-"));
  return measureTerminalPlan({ packet, ir: c.ir, request, directory }, page);
}

export async function measureTerminalPlan(x, page) {
  const html = join(x.directory, "packet.html");
  await writeFile(
    html,
    printPacketHtml(x.packet.sheets, x.packet.page, "CHECK7"),
  );
  const geometries = [];
  const standaloneSheets = x.packet.sheets.map((sheet) => ({
    ...sheet,
    svg: embedPrintableFont(sheet.svg),
  }));
  await measurePacketGeometry(
    page,
    html,
    { ...x.packet, sheets: standaloneSheets },
    x.ir,
    geometries,
  );
  const tables = scopeTables(
    x.packet,
    geometries,
    x.ir,
    buildSourceTables(x.ir, x.request, buildDocumentation),
    x.request,
  );
  Object.assign(tables, { request: x.request });
  return { ...x, geometries, tables };
}

export function strictTerminalRows(x) {
  return x.packet.sheets.map((s, i) =>
    terminalPlanObservation(
      s,
      x.geometries[i],
      x.tables,
      (dq, findings, extra) =>
        observation({ id: "check7" }, s, dq, findings, extra),
      x,
    ),
  );
}
