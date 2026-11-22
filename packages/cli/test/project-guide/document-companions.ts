import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { parseHTML } from "linkedom";
import { compileProject } from "@thermite/compiler";
import { renderSchematicPacket } from "@thermite/render";
import { singleSheetSvg } from "../../src/terminal-report-svg.js";
import { repositoryRoot, type FactModule } from "./harness.js";
const module: FactModule = {
  facts: [
    {
      claim:
        "Terminal plans link strips to inventory rows; single-sheet SVG exports retain the inventory without strip references.",
      async check() {
        const compiled = await compileProject(
          join(repositoryRoot, "examples/motor-starter"),
        );
        if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
        const result = await renderSchematicPacket(compiled.ir, {
          format: "schematic-packet-request/0.1",
          index: false,
          views: [
            {
              format: "documentation-view-request/0.1",
              kind: "terminals",
              device: "TB1",
            },
          ],
        });
        if (!result.ok) throw Error(JSON.stringify(result.error));
        const doc = parseHTML(
          result.value.sheets.map((s) => s.svg).join("\n"),
        ).document;
        const terminals = [...doc.querySelectorAll("[data-strip-terminal]")];
        const rows = [...doc.querySelectorAll("[data-strip-row]")];
        expect(terminals.length).toBeGreaterThan(0);
        expect(rows.length).toBe(terminals.length);
        for (const t of terminals) {
          const ref = t.getAttribute("data-strip-ref");
          expect(ref).toMatch(/^T[1-9][0-9]*\/R[1-9][0-9]*$/u);
          expect(
            rows.some(
              (r) =>
                r.getAttribute("data-strip-row") ===
                  t.getAttribute("data-strip-terminal") &&
                r.getAttribute("data-strip-ref") === ref,
            ),
          ).toBe(true);
        }
        const svg = singleSheetSvg(result.value);
        expect(svg).toBeDefined();
        const inventory = parseHTML(svg!).document;
        expect(inventory.querySelectorAll("[data-report-row]")).toHaveLength(
          terminals.length,
        );
        expect(
          inventory.querySelectorAll("[data-strip-row],[data-strip-ref]"),
        ).toHaveLength(0);
      },
    },
    {
      claim: "Schedules can point to painted strip landings.",
      async check() {
        const source = await compileProject(
          join(repositoryRoot, "examples/motor-starter"),
        );
        if (!source.ok) throw Error(JSON.stringify(source.diagnostics));
        const packet = await renderSchematicPacket(source.ir, {
          format: "schematic-packet-request/0.1",
          views: [
            { format: "documentation-view-request/0.1", kind: "wires" },
            {
              format: "documentation-view-request/0.1",
              kind: "terminals",
              device: "TB1",
            },
          ],
        });
        if (!packet.ok) throw Error(packet.error.message);
        const strip = packet.value.sheets.find(
          (s) => s.view.kind === "terminal-strip",
        );
        expect(strip).toBeDefined();
        const token = String(strip!.number).padStart(2, "0") + ".";
        const cells = packet.value.sheets
          .filter((s) => s.view.kind === "wires")
          .flatMap((s) => [
            ...parseHTML(s.svg).document.querySelectorAll(
              '[data-report-column="6"],[data-report-column="7"]',
            ),
          ]);
        expect(
          cells.some((cell) => cell.textContent?.trim().startsWith(token)),
        ).toBe(true);
      },
    },
    {
      claim:
        "Packets may append required companion inventories; requested filters stay unchanged.",
      async check() {
        const project = join(repositoryRoot, "examples/report-filtering");
        const compiled = await compileProject(project);
        if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
        const request = JSON.parse(
          await readFile(join(project, "packet.json"), "utf8"),
        );
        const original = JSON.stringify(request);
        const result = await renderSchematicPacket(
          compiled.ir,
          request,
          compiled.presentation,
        );
        if (!result.ok) throw Error(JSON.stringify(result.error));
        expect(result.value.navigation!.autoDocuments!.length).toBeGreaterThan(
          0,
        );
        const authored = result.value.documentationSelections!;
        for (const selection of authored)
          expect(selection.filter).toEqual(
            request.views[selection.view - 1].filter,
          );
        expect(JSON.stringify(request)).toBe(original);
        expect(
          result.value.navigation!.autoDocuments!.every((d) => !("view" in d)),
        ).toBe(true);
      },
    },
  ],
  unexecuted: new Map([
    [
      "Include appended sheets when reviewing page counts.",
      "Manual packet review advice; appended pages are exported in navigation.autoDocuments.",
    ],
  ]),
};
export default module;
