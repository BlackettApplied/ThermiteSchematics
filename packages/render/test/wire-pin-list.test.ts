import { expect, it } from "vitest";
import { cp, mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { compileProject, lockProject } from "@thermite/compiler";
import { renderSchematicPacket } from "../src/sheets.js";
import { parseSvg } from "./off-view-fixtures.js";
import { signal } from "../../../evals/draw/corpus/requests.mjs";

it.each(
  ["analog-output", "signal-loop"].flatMap((kind) =>
    ["left-to-right", "top-to-bottom"].map((flow) => [kind, flow] as const),
  ),
)(
  "%s %s locates every native connector pin even when painted only as a pin-list row",
  async (kind, flow) => {
    const root = await mkdtemp(join(tmpdir(), "thermite-pin-list-"));
    try {
      for (const name of ["field-interfaces", "industrial-pilot"])
        await cp(resolve("libraries", name), join(root, name), {
          recursive: true,
        });
      await cp(
        resolve("packages/cli/fixtures", kind, "source.json"),
        join(root, "source.json"),
      );
      await writeFile(
        join(root, "system.json"),
        JSON.stringify({
          format: "electrical-system/0.1",
          project: { name: "Synthetic pin list" },
          sources: ["source.json"],
          libraries: ["field-interfaces", "industrial-pilot"].map((name) => ({
            name,
            version: "0.1.0",
            path: name,
          })),
        }),
      );
      expect((await lockProject(root)).ok).toBe(true);
      const compiled = await compileProject(root);
      if (!compiled.ok) throw Error(JSON.stringify(compiled));
      const request =
        kind === "analog-output"
          ? JSON.parse(
              await readFile(
                "packages/cli/fixtures/analog-output/packet.request.json",
                "utf8",
              ),
            )
          : structuredClone(signal);
      for (const view of request.views) view.flow = flow;
      if (flow === "top-to-bottom")
        request.page = { ...request.page, orientation: "portrait" };
      const before = JSON.stringify(compiled.ir);
      const result = await renderSchematicPacket(
        compiled.ir,
        request,
        compiled.presentation,
      );
      if (!result.ok) throw Error(JSON.stringify(result.error));
      expect(JSON.stringify(compiled.ir)).toBe(before);
      expect(result.value.sheets).toHaveLength(2);
      const device = compiled.ir.devices.find(
        (d) => d.designation === (kind === "analog-output" ? "V1" : "PT1"),
      )!;
      const drawing = parseSvg(result.value.sheets[0]!.svg);
      const pins = [...drawing.querySelectorAll("[data-pin-terminal]")].map(
        (n) => JSON.parse(n.getAttribute("data-pin-terminal")!),
      );
      for (const terminal of ["1", "2", "3", "4"]) {
        expect(pins).toContainEqual([device.uid, terminal]);
        expect(
          [...drawing.querySelectorAll("circle[data-loop-terminal]")].some(
            (n) =>
              n.getAttribute("data-loop-terminal") ===
              JSON.stringify([device.uid, terminal]),
          ),
        ).toBe(false);
      }
      const schedule = parseSvg(result.value.sheets[1]!.svg),
        column = kind === "analog-output" ? 7 : 6;
      const cells = [
        ...schedule.querySelectorAll(
          `[data-report-row] [data-report-column="${column}"]`,
        ),
      ];
      expect(cells).toHaveLength(4);
      for (const cell of cells)
        expect(cell.textContent!.trim()).toMatch(/^01\.[A-D][1-6]$/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
