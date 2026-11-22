import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compileProject } from "@thermite/compiler";
import { parseHTML } from "linkedom";
import { expect, it } from "vitest";
import {
  coreTypes,
  machineProbe,
} from "../../core-library/test/machine-fixtures.js";
import { renderSchematic } from "../src/renderer.js";

it.each(["left-to-right", "top-to-bottom"] as const)(
  "draws authored gang ink between a breaker's control feed and return poles in %s",
  async (flow) => {
    const type = (await coreTypes()).find((t) => t.id === "core:breaker-2p");
    const fixture = await machineProbe(type, "control", "pole1");
    try {
      const path = join(fixture.root, "source.json");
      const source = JSON.parse(await readFile(path, "utf8"));
      const wire = source.objects.find(
        (o: any) =>
          o.kind === "wire" &&
          o.endpoints.some(
            (e: any) => e.device === "K1" && e.terminal === "A2",
          ),
      );
      wire.endpoints = [
        { device: "K1", terminal: "A2" },
        { device: "DUT", terminal: "3/L2" },
      ];
      source.objects.push({
        kind: "wire",
        uid: "62000000-0000-4000-8000-000000000099",
        designation: "W-return",
        endpoints: [
          { device: "DUT", terminal: "4/T2" },
          { device: "PS1", terminal: "-" },
        ],
      });
      await writeFile(path, JSON.stringify(source));
      const compiled = await compileProject(fixture.root);
      if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
      const ir = compiled.ir;
      const before = JSON.stringify(ir);
      const result = await renderSchematic(ir, { ...fixture.request, flow });
      expect(result.ok, JSON.stringify(result)).toBe(true);
      if (!result.ok) throw Error(result.error.message);
      const doc = parseHTML(result.value.svg).document;
      const poles = [
        ...doc.querySelectorAll('[data-symbol-id="ais:breaker-pole"]'),
      ];
      expect(poles).toHaveLength(2);
      const gangs = [
        ...doc.querySelectorAll('line[data-mechanical-association="ganged"]'),
      ];
      // Removing gang emission must fail this positive assertion in either flow.
      expect(gangs).toHaveLength(1);
      expect(gangs[0]!.getAttribute("stroke-dasharray")).toBe("6 4");
      const members = JSON.parse(
        gangs[0]!.getAttribute("data-ganged-functions")!,
      ) as { deviceUid: string; functionKey: string }[];
      expect(members.map((f) => f.functionKey).sort()).toEqual([
        "pole1",
        "pole2",
      ]);
      expect(new Set(members.map((f) => f.deviceUid)).size).toBe(1);
      expect(result.value.summary.conductiveElementIds).toHaveLength(4);
      const unlinked = structuredClone(ir);
      unlinked.gangedGroups = [];
      const without = await renderSchematic(unlinked, {
        ...fixture.request,
        flow,
      });
      expect(without.ok, JSON.stringify(without)).toBe(true);
      if (!without.ok) throw Error(without.error.message);
      expect(
        parseHTML(without.value.svg).document.querySelectorAll(
          'line[data-mechanical-association="ganged"]',
        ),
      ).toHaveLength(0);
      expect(without.value.summary).toEqual(result.value.summary);
      expect(JSON.stringify(ir)).toBe(before);
    } finally {
      await fixture.dispose();
    }
  },
);
