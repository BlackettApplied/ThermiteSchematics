import { expect, it } from "vitest";
import { compileProject } from "@thermite/compiler";
import { buildDocumentation } from "@thermite/query";
import { parseHTML } from "linkedom";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { renderSchematicSheets, renderSchematicPacket } from "../src/sheets.js";

const view = {
  format: "documentation-view-request/0.1" as const,
  kind: "terminals" as const,
};
const normalize = (s: string) => s.replace(/\s+/gu, "").replaceAll("->", "→");
function equality(ir: Parameters<typeof buildDocumentation>[0], svg: string) {
  const doc = parseHTML(svg).document;
  const ink = [
    ...doc.querySelectorAll(
      "[data-strip-incidence],[data-strip-bridge-label],[data-strip-jumper-end]",
    ),
  ];
  for (const row of buildDocumentation(ir, view).rows) {
    const expected = row.cells
      .slice(4, 6)
      .filter((s) => !s.startsWith("No "))
      .flatMap((s) => s.split("; "))
      .map(normalize)
      .sort();
    const actual = ink
      .filter((e) => e.getAttribute("data-strip-at") === row.key)
      .map((e) =>
        normalize(
          [...e.querySelectorAll("text")]
            .map((t) => t.textContent)
            .join(" ")
            .replace(/^B\d+\s/u, "")
            .split("; continued on sheet ")[0]!,
        ),
      )
      .sort();
    expect(actual, row.key).toEqual(expected);
  }
  return doc;
}
it.each(["examples/motor-starter", "examples/conveyor-line"])(
  "retains graph-authored CBL1 cores and exactly matches every TB1/JB1 inventory row: %s",
  async (project) => {
    const c = await compileProject(project);
    if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
    const original = JSON.stringify(c.ir);
    for (const mode of ["standalone", "packet", "CLI"] as const) {
      const result =
        mode === "CLI"
          ? undefined
          : mode === "packet"
            ? await renderSchematicPacket(c.ir, {
                format: "schematic-packet-request/0.1",
                index: false,
                views: [view],
              })
            : await renderSchematicSheets(c.ir, view);
      if (result && !result.ok) throw Error(JSON.stringify(result.error));
      const packet =
        mode === "CLI"
          ? JSON.parse(
              execFileSync(
                process.execPath,
                [
                  resolve("thermite.mjs"),
                  "report",
                  "terminals",
                  "--project",
                  project,
                  "--json",
                ],
                { encoding: "utf8", maxBuffer: 5_000_000 },
              ),
            )
          : result && result.ok
            ? result.value
            : undefined;
      const doc = equality(
        c.ir,
        packet.sheets.map((s: { svg: string }) => s.svg).join("\n"),
      );
      const cable = c.ir.cables.find((c) => c.designation === "CBL1")!;
      for (const core of ["1+", "1-", "2+", "2-"])
        expect(
          [...doc.querySelectorAll("[data-strip-incidence]")].filter(
            (e) =>
              e.getAttribute("data-strip-incidence") ===
              JSON.stringify([cable.uid, core]),
          ),
        ).toHaveLength(2);
    }
    expect(JSON.stringify(c.ir)).toBe(original);
  },
);
it("unions physical and assigned cores once and keeps a single-ended spare honest", async () => {
  const c = await compileProject("examples/motor-starter");
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  const cable = c.ir.cables.find((c) => c.designation === "CBL1")!;
  const physical = c.ir.cableConductors.filter((k) => k.cableUid === cable.uid);
  const first = physical.find((k) => k.id.conductorId === "1+")!;
  const spare = physical.find((k) => k.id.conductorId === "2+")!;
  cable.assignments = [
    { id: "1+", usage: "in-use", endpoints: first.endpoints },
    { id: "2+", usage: "spare", endpoints: [spare.endpoints[0], null] },
    { id: "2-", usage: "spare", endpoints: [null, null] },
  ];
  const r = await renderSchematicSheets(c.ir, view);
  if (!r.ok) throw Error(JSON.stringify(r.error));
  const doc = equality(c.ir, r.value.sheets.map((s) => s.svg).join("\n"));
  const stubs = [...doc.querySelectorAll("[data-strip-incidence]")].filter(
    (e) =>
      e.getAttribute("data-strip-incidence") ===
      JSON.stringify([cable.uid, "2+"]),
  );
  expect(stubs).toHaveLength(1);
  expect(stubs[0]!.textContent).toContain("Unterminated");
  expect(
    [...doc.querySelectorAll("[data-strip-incidence]")].filter(
      (e) =>
        e.getAttribute("data-strip-incidence") ===
        JSON.stringify([cable.uid, "1+"]),
    ),
  ).toHaveLength(2);
});
