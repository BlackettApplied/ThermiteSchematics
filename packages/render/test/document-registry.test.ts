import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, afterAll, expect, it } from "vitest";
import { compileProject, serializeIr } from "@thermite/compiler";
import { buildDocumentation } from "@thermite/query";
import { offViewFixture, parseSvg } from "./off-view-fixtures.js";
import { tableDrafts } from "../src/packet/reports.js";
import { normalizePaperPage } from "../src/packet/page.js";
import { assembleSheets } from "../src/packet/assembly.js";
import { issuedDocuments } from "../src/packet/document-registry.js";
import { renderSchematicPacket } from "../src/sheets.js";

let source: Awaited<ReturnType<typeof offViewFixture>>;
beforeAll(async () => {
  source = await offViewFixture();
});
afterAll(async () => {
  await source.dispose();
});

it("binds requested documents, companions and dependencies to each compiled compact presentation", async () => {
  const manifestPath = join(source.root, "system.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  await writeFile(
    manifestPath,
    JSON.stringify({ ...manifest, presentation: "presentation.json" }),
  );
  const hash = (value: unknown) =>
    createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const digests: string[] = [];
  for (const value of ["Sample A", "Sample B"]) {
    await writeFile(
      join(source.root, "presentation.json"),
      JSON.stringify({
        format: "project-presentation/0.3",
        revision: "TEST A",
        titleBlock: {
          fields: { customer: { slot: "customer", label: "CUSTOMER", value } },
        },
      }),
    );
    const compiled = await compileProject(source.root);
    if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
    const result = await renderSchematicPacket(
      compiled.ir,
      {
        format: "schematic-packet-request/0.1",
        views: [
          {
            format: "wiring-view-request/0.1",
            title: "One wire",
            conductors: ["W1"],
          },
          { format: "documentation-view-request/0.1", kind: "wires" },
        ],
      },
      compiled.presentation,
    );
    if (!result.ok) throw Error(JSON.stringify(result.error));
    const { documents = [], dependencies = [] } = result.value.navigation ?? {};
    const wires = documents.find((d) => d.kind === "wires" && !d.autoOrigin);
    expect(wires?.rows.length).toBeGreaterThan(0);
    expect(documents.some((d) => d.autoOrigin)).toBe(true);
    expect(dependencies.length).toBeGreaterThan(0);
    const binding = {
      snapshotDigest: hash(serializeIr(compiled.ir)),
      presentationDigest: hash(compiled.presentation),
      revision: "TEST A",
    };
    for (const record of [...documents, ...dependencies])
      expect(record).toMatchObject(binding);
    digests.push(wires!.presentationDigest);
  }
  expect(new Set(digests).size).toBe(2);
});

it("requires a visible native header as well as visible body rows", () => {
  const page = normalizePaperPage();
  if (!page.ok) throw Error("page");
  const table = buildDocumentation(source.ir, {
    format: "documentation-view-request/0.1",
    kind: "wires",
  });
  const result = tableDrafts(source.ir, table, undefined, page.value);
  if (!result.ok) throw Error(JSON.stringify(result.error));
  const sheets = assembleSheets(
    source.ir,
    structuredClone(result.value),
    page.value,
  );
  expect(
    issuedDocuments(source.ir, result.value, sheets, page.value)[0]!.rows
      .length,
  ).toBe(table.rows.length);
  sheets[0]!.svg = sheets[0]!.svg.replace(
    'data-column-name="Conductor / label"',
    'style="display:none" data-column-name="Conductor / label"',
  );
  expect(
    issuedDocuments(source.ir, result.value, sheets, page.value)[0]?.rows ?? [],
  ).toHaveLength(0);
});

it.each(["snapshotDigest", "presentationDigest", "revision"] as const)(
  "rejects stale %s",
  (field) => {
    const page = normalizePaperPage();
    if (!page.ok) throw Error("page");
    const result = tableDrafts(
      source.ir,
      buildDocumentation(source.ir, {
        format: "documentation-view-request/0.1",
        kind: "wires",
      }),
      undefined,
      page.value,
    );
    if (!result.ok) throw Error(JSON.stringify(result.error));
    const sheets = assembleSheets(
      source.ir,
      structuredClone(result.value),
      page.value,
    );
    for (const d of result.value) d.issuedDocument![field] = "stale";
    expect(
      issuedDocuments(source.ir, result.value, sheets, page.value),
    ).toEqual([]);
  },
);

it.each([
  "hidden-label",
  "wrong-label",
  "hidden-row",
  "hidden-column",
  "opacity",
  "white",
  "fill-opacity",
  "mask",
  "tiny",
  "occluded",
  "clip",
  "column-name",
  "row-key",
  "text",
  "metadata",
  "forged-body",
  "forged-header",
  "forged-status",
])("rejects %s instead of trusting metadata", (mutation) => {
  const page = normalizePaperPage();
  if (!page.ok) throw Error("page");
  const full = buildDocumentation(source.ir, {
    format: "documentation-view-request/0.1",
    kind: "wires",
  });
  const result = tableDrafts(
    source.ir,
    { ...full, rows: full.rows.slice(0, 1) },
    undefined,
    page.value,
  );
  if (!result.ok) throw Error(JSON.stringify(result.error));
  const sheets = assembleSheets(
    source.ir,
    structuredClone(result.value),
    page.value,
  );
  const dom = parseSvg(sheets[0]!.svg),
    row = dom.querySelector("[data-report-row]")!,
    column = row.querySelector('[data-report-column="2"]')!,
    text = column.querySelector("text")!;
  if (mutation === "hidden-label")
    dom
      .querySelector("#sheet-1-document-label")!
      .setAttribute("display", "none");
  if (mutation === "wrong-label")
    dom.querySelector("#sheet-1-document-label")!.textContent =
      "Wrong inventory";
  if (mutation === "hidden-row") row.setAttribute("display", "none");
  if (mutation === "hidden-column") column.setAttribute("visibility", "hidden");
  if (mutation === "opacity") row.setAttribute("opacity", "0.0");
  if (mutation === "white") text.setAttribute("fill", "white");
  if (mutation === "fill-opacity") row.setAttribute("fill-opacity", "0");
  if (mutation === "mask") row.setAttribute("mask", "url(#missing)");
  if (mutation === "tiny") text.setAttribute("font-size", "0.1");
  if (mutation === "occluded")
    row.innerHTML +=
      '<rect x="0" y="0" width="500" height="500" fill="white"/>';
  if (mutation === "clip") {
    const svg = dom.querySelector("svg")!;
    svg.innerHTML +=
      '<defs><clipPath id="hidden"><rect width="1" height="1"/></clipPath></defs>';
    dom
      .querySelector("[data-report-row]")!
      .setAttribute("clip-path", "url(#hidden)");
  }
  if (mutation === "column-name")
    column.setAttribute("data-column-name", "Unrelated column");
  if (mutation === "row-key") row.setAttribute("data-report-row", "foreign");
  if (mutation === "text") text.textContent = "FOREIGN.1";
  if (mutation === "metadata")
    (result.value[0]!.documentRows![0]!.cells as string[])[1] = "FOREIGN.1";
  if (mutation === "forged-body") {
    text.textContent = "FOREIGN.1";
    (result.value[0]!.documentRows![0]!.printedCells as string[][])[1] = [
      "FOREIGN.1",
    ];
  }
  if (mutation === "forged-status") {
    row.querySelector('[data-report-column="5"] text')!.textContent =
      "Invented status";
    (result.value[0]!.documentRows![0]!.cells as string[])[4] =
      "Invented status";
    (result.value[0]!.documentRows![0]!.printedCells as string[][])[4] = [
      "Invented status",
    ];
  }
  if (mutation === "forged-header") {
    const cell = dom.querySelector(
      '#sheet-1-document-header [data-report-column="2"] text',
    )!;
    cell.textContent = "Foreign header";
    (result.value[0]!.documentHeader!.printedCells as string[][])[1] = [
      "Foreign header",
    ];
  }
  sheets[0]!.svg = dom.toString();
  expect(
    issuedDocuments(source.ir, result.value, sheets, page.value)[0]?.rows ?? [],
  ).toHaveLength(0);
});

it("requires actual SVG rows, not JSON-only claims or empty reports", () => {
  const page = normalizePaperPage();
  if (!page.ok) throw Error("page");
  const result = tableDrafts(
    source.ir,
    buildDocumentation(source.ir, {
      format: "documentation-view-request/0.1",
      kind: "wires",
    }),
    undefined,
    page.value,
  );
  if (!result.ok) throw Error(JSON.stringify(result.error));
  expect(result.value[0]!.issuedDocument!.revision).toBe("UNSPECIFIED");
  expect(issuedDocuments(source.ir, result.value, [], page.value)).toEqual([]);
  const sheets = assembleSheets(
    source.ir,
    structuredClone(result.value),
    page.value,
  );
  sheets[0]!.svg = '<svg width="432" height="279" viewBox="0 0 432 279"/>';
  expect(
    issuedDocuments(source.ir, result.value, sheets, page.value)[0]?.rows ?? [],
  ).toHaveLength(0);
});
it("rejects a duplicated native row identity within one document", () => {
  const page = normalizePaperPage();
  if (!page.ok) throw Error("page");
  const native = buildDocumentation(source.ir, {
    format: "documentation-view-request/0.1",
    kind: "wires",
  });
  const result = tableDrafts(
    source.ir,
    { ...native, rows: [native.rows[0]!, native.rows[0]!] },
    undefined,
    page.value,
  );
  if (!result.ok) throw Error(JSON.stringify(result.error));
  expect(() =>
    issuedDocuments(
      source.ir,
      result.value,
      assembleSheets(source.ir, structuredClone(result.value), page.value),
      page.value,
    ),
  ).toThrow(/Duplicate issued document row/);
});
