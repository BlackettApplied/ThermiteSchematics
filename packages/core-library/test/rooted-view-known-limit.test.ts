import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DOMParser } from "linkedom";
import { expect, it } from "vitest";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import { renderSchematic } from "../../render/src/renderer.js";
import type { RenderedSchematic } from "../../render/src/types.js";

const selectedWires = ["W30", "W32", "W33", "W34", "W36", "W41"];
const gaps = [
  ["OL1", "96", ["W35"]],
  ["S2", "14", ["W37"]],
  ["K1", "A1", ["W38", "W39"]],
  ["PS1", "-", ["W40", "W42"]],
] as const;

type Endpoint = { device: string; terminal: string };
async function materializeRepro(root: string) {
  await cp("packages/core-library/test/fixtures/dol-starter", root, {
    recursive: true,
  });
  const path = join(root, "source.json");
  const source: { objects: { designation: string; endpoints?: Endpoint[] }[] } =
    JSON.parse(await readFile(path, "utf8"));
  const edits: Record<string, Endpoint[]> = {
    W30: [
      { device: "PS1", terminal: "+" },
      { device: "S0", terminal: "11" },
    ],
    W36: [
      { device: "S2", terminal: "14" },
      { device: "K1", terminal: "A1" },
    ],
    W37: [
      { device: "R1", terminal: "14" },
      { device: "S2", terminal: "14" },
    ],
    W38: [
      { device: "K1", terminal: "A1" },
      { device: "R1", terminal: "A1" },
    ],
  };
  source.objects = source.objects.filter((o) => o.designation !== "W31");
  for (const object of source.objects)
    if (edits[object.designation]) object.endpoints = edits[object.designation];
  await writeFile(path, JSON.stringify(source, null, 2) + "\n");
}

function assertKnownOmissions(ir: ElectricalIr, rendered: RenderedSchematic) {
  const svg = new DOMParser().parseFromString(rendered.svg, "image/svg+xml");
  const selected = new Set(
    rendered.summary.conductiveElementIds.map((id) => id.uid),
  );
  expect(
    ir.wires
      .filter((w) => selected.has(w.uid))
      .map((w) => w.designation)
      .sort(),
  ).toEqual(selectedWires);
  const drawn = new Set(
    [...svg.querySelectorAll("[data-wire-uid]")].map((e) =>
      e.getAttribute("data-wire-uid"),
    ),
  );
  expect(
    ir.wires
      .filter((w) => drawn.has(w.uid))
      .map((w) => w.designation)
      .sort(),
  ).toEqual(selectedWires);
  for (const [designation, terminalKey, omitted] of gaps) {
    const device = ir.devices.find((d) => d.designation === designation);
    if (!device) throw Error(`Missing authored device ${designation}`);
    expect(
      svg.querySelector(
        `[data-device-uid="${device.uid}"][data-terminal-key="${terminalKey}"]`,
      ),
    ).not.toBeNull();
    expect(
      ir.wires
        .filter(
          (w) =>
            !selected.has(w.uid) &&
            w.endpoints.some(
              (e) =>
                e.terminal.deviceUid === device.uid &&
                e.terminal.terminalKey === terminalKey,
            ),
        )
        .map((w) => w.designation)
        .sort(),
    ).toEqual(omitted);
  }
  for (const designation of ["H1", "R1"]) {
    const device = ir.devices.find((d) => d.designation === designation);
    if (!device) throw Error(`Missing authored device ${designation}`);
    expect(rendered.summary.deviceUids).not.toContain(device.uid);
    expect(
      rendered.summary.terminalIds.some((t) => t.deviceUid === device.uid),
    ).toBe(false);
    expect(
      svg.querySelectorAll(`[data-device-uid="${device.uid}"]`).length,
    ).toBe(0);
  }
  // #84b must flip these absence assertions when it adds the disclosure markers.
  expect(svg.querySelectorAll("[data-off-view-terminal]").length).toBe(0);
  expect(rendered.svg).not.toContain("Off-view at");
}

it.each(["left-to-right", "top-to-bottom"] as const)(
  "known limitation #84: bounded K1 actuation omits authored branches without markers (%s); #84b updates this witness",
  async (flow) => {
    const root = await mkdtemp(
      join(realpathSync(tmpdir()), "thermite-repro84-"),
    );
    try {
      await materializeRepro(root);
      const compiled = await compileProject(root);
      if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
      const before = JSON.stringify(compiled.ir);
      const result = await renderSchematic(compiled.ir, {
        format: "schematic-view-request/0.1",
        root: { by: "designation", value: "K1" },
        family: "control",
        flow,
      });
      if (!result.ok) throw Error(JSON.stringify(result.error));
      assertKnownOmissions(compiled.ir, result.value);
      expect(JSON.stringify(compiled.ir)).toBe(before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
