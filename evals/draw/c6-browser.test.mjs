import { beforeAll, afterAll, it, expect } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launch, drawingContextOptions, openSheet } from "./browser.mjs";
import { measurePacketGeometry } from "./packet-geometry.mjs";
import { identifierTable } from "./identifier-tables.mjs";
let browser, context, page, directory;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "c6-identifier-"));
  browser = await launch();
  context = await browser.newContext(drawingContextOptions);
  page = await context.newPage();
});
afterAll(async () => {
  await context?.close();
  await browser?.close();
  await rm(directory, { recursive: true, force: true });
});
const svg = (kind = "assemblies", rect = true) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="200mm" viewBox="0 0 210 200"><g data-document-id="inline" data-document-origin="auto" data-document-kind="${kind}"><g data-report-row="native"><g>${rect ? '<rect x="25" y="40" width="130" height="10" fill="white" stroke="#9ba6b4"/>' : ""}<g data-report-column="1" data-column-name="Assembly / cable"><text x="26" y="46" font-size="3.5">CBL1</text></g></g></g></g></svg>`;
const ir = { devices: [], deviceTypes: [], functions: [], nets: [] },
  s = {
    number: 1,
    view: { kind: "connector-assembly", format: "documentation-view/0.1" },
  },
  table = { kind: "assemblies", documentId: "inline", columns: [], rows: [] };
it("C6 resolves actual painted inline-kind metadata without relabelling the graphical sheet", async () => {
  const g = await openSheet(page, svg());
  expect(identifierTable(s, { sheets: [s] }, g, ir, [table])).toBe(table);
  const bad = await openSheet(page, svg("network"));
  expect(() => identifierTable(s, { sheets: [s] }, bad, ir, [table])).toThrow(
    "source table missing",
  );
});
it.each(["html", "svg"])(
  "C6 browser measurement failure retains its %s sheet context",
  async (medium) => {
    const path = join(directory, medium + ".html");
    await writeFile(
      path,
      `<section id="sheet-1">${svg("assemblies", medium !== "html")}</section>`,
    );
    const packet = {
      sheets: [{ ...s, svg: svg("assemblies", medium !== "svg") }],
    };
    await expect(
      measurePacketGeometry(page, path, packet, ir, []),
    ).rejects.toMatchObject({
      sheet: 1,
      medium,
      instrumentation: "identifier",
    });
  },
);
