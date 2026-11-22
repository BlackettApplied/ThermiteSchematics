import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { compileProject } from "@thermite/compiler";
import { renderSchematicPacket } from "@thermite/render";
import { repositoryRoot, noteOutput, type FactModule } from "./harness.js";
async function frame() {
  const compiled = await compileProject(
    join(repositoryRoot, "examples/motor-starter"),
  );
  if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  const result = await renderSchematicPacket(
    compiled.ir,
    {
      format: "schematic-packet-request/0.2",
      views: [{ format: "documentation-view-request/0.1", kind: "bom" }],
    },
    {
      format: "project-presentation/0.3",
      revision: "UNSPECIFIED",
      backgroundColor: "#ffffff",
      titleBlockLines: [],
      compactFrame: {
        format: "project-presentation/0.3",
        titleBlock: {
          fields: {
            customer: {
              slot: "customer",
              label: "Client",
              value: "TEST",
            },
          },
        },
      },
    },
  );
  if (!result.ok) throw Error(JSON.stringify(result.error));
  return result.value.sheets[0]?.svg ?? "";
}
const module: FactModule = {
  facts: [
    {
      claim:
        "For packet frames, use presentation 0.3 named slots; see `thermite guide drawing-frames`.",
      async check() {
        const svg = await frame();
        expect(svg).toContain("Client:");
        expect(svg).toContain(">TEST</text>");
        expect(
          await readFile(
            join(repositoryRoot, "docs/drawing-frames.md"),
            "utf8",
          ),
        ).toContain("project-presentation/0.3");
      },
    },
    {
      claim:
        "Unknown fields stay labelled blank; unknown revision stays `UNSPECIFIED` and remains unmet at issue review.",
      async check() {
        const svg = await frame();
        for (const label of [
          "Drawn by:",
          "Checked by:",
          "Approved by:",
          "Date:",
        ])
          expect(svg).toContain(label);
        expect(svg).toContain(">UNSPECIFIED</text>");
        expect(svg).toContain("Revision history: UNSPECIFIED");
      },
    },
    {
      claim:
        "Preview the whole packet after frame changes; handle R006 honestly.",
      async check() {
        const c = await compileProject(
          join(repositoryRoot, "examples/motor-starter"),
        );
        if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
        const q = {
          format: "schematic-packet-request/0.2" as const,
          views: [
            {
              format: "documentation-view-request/0.1" as const,
              kind: "bom" as const,
            },
            {
              format: "documentation-view-request/0.1" as const,
              kind: "terminals" as const,
            },
          ],
        };
        const p = {
          format: "project-presentation/0.3" as const,
          revision: "UNSPECIFIED",
          backgroundColor: "#ffffff",
          titleBlockLines: [],
        };
        const all = await renderSchematicPacket(c.ir, q, p);
        expect(all.ok).toBe(true);
        if (all.ok) expect(all.value.sheets.length).toBeGreaterThanOrEqual(2);
        const refused = await renderSchematicPacket(
          c.ir,
          {
            ...q,
            titleData: { defaults: { values: { drawnBy: "W".repeat(80) } } },
          },
          p,
        );
        noteOutput(JSON.stringify(refused));
        expect(refused).toMatchObject({
          ok: false,
          error: { code: "R006", reason: "unprintable-layout" },
        });
      },
    },
  ],
  unexecuted: new Map([
    [
      "Enter only supplied title/revision data.",
      "Authoring instruction: software cannot establish that an entered fact was supplied by its owner.",
    ],
  ]),
};
export default module;
