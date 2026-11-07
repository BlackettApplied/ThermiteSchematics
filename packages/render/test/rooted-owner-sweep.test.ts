import { readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { compileProject } from "@thermite/compiler";
import { expect, it } from "vitest";
import { renderSchematic } from "../src/renderer.js";
import type { SchematicViewRequest } from "../src/types.js";
import { byDesignation } from "./render-robustness-fixture.js";

it("never throws a missing-owner invariant for admitted shipped examples and fixtures", async () => {
  const roots = [
    "examples",
    "packages/compiler/fixtures",
    "packages/cli/fixtures",
    "packages/cli/templates",
    "packages/agent-tools/test/fixtures",
  ];
  const projects = (
    await Promise.all(
      roots.map(async (root) =>
        (await readdir(root, { recursive: true }))
          .filter((file) => basename(file) === "system.json")
          .map((file) => dirname(join(root, file))),
      ),
    )
  )
    .flat()
    .sort();
  let admitted = 0,
    views = 0;
  for (const project of projects) {
    const compiled = await compileProject(project);
    // Invalid loading/validation fixtures are not inputs to the renderer.
    if (!compiled.ok) continue;
    admitted++;
    const ir = compiled.ir;
    const requests: SchematicViewRequest[] = [];
    for (const device of ir.devices) {
      const root = byDesignation(device.designation);
      const functions = ir.functions.filter(
        (f) => f.id.deviceUid === device.uid,
      );
      if (functions.some((f) => f.kind === "coil"))
        requests.push({
          format: "schematic-view-request/0.1",
          root,
          family: "control",
        });
      if (functions.some((f) => f.kind === "load"))
        requests.push({
          format: "schematic-view-request/0.1",
          root,
          family: "power",
        });
      if (functions.some((f) => f.kind === "source"))
        requests.push({
          format: "schematic-view-request/0.2",
          root,
          intent: { kind: "loads" },
        });
      if (
        functions.some(
          (f) =>
            f.kind === "contact" ||
            (f.kind === "channel" && f.direction === "output"),
        )
      ) {
        for (const target of ir.devices.filter(
          (d) =>
            d.uid !== device.uid &&
            ir.functions.some(
              (f) =>
                f.id.deviceUid === d.uid &&
                f.kind === "channel" &&
                f.direction === "input",
            ),
        ))
          requests.push({
            format: "schematic-view-request/0.2",
            root,
            intent: {
              kind: "trace",
              to: byDesignation(target.designation),
              includePower: true,
            },
          });
      }
    }
    for (const cable of ir.cables)
      requests.push({
        format: "schematic-view-request/0.2",
        root: byDesignation(cable.designation),
        intent: { kind: "conductors" },
      });
    for (const request of requests)
      for (const flow of ["left-to-right", "top-to-bottom"] as const) {
        views++;
        // Any thrown invariant (including the old UID-only T001) fails this sweep.
        const result = await renderSchematic(ir, { ...request, flow });
        if (
          !result.ok &&
          result.error.details?.reason === "unrepresented-terminal"
        ) {
          expect(result.error.code).toBe("R003");
          expect(result.error.message).toContain("circuit view");
          expect(result.error.details).toHaveProperty("designation");
          expect(result.error.details).toHaveProperty("terminalIds");
          expect(result.error.details).toHaveProperty("conductors");
        }
      }
  }
  expect(admitted).toBeGreaterThanOrEqual(31);
  expect(views).toBeGreaterThanOrEqual(210);
}, 30000);
