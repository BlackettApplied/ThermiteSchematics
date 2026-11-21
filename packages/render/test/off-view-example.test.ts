import { readFile } from "node:fs/promises";
import { compileProject } from "@thermite/compiler";
import { expect, it } from "vitest";
import { renderSchematic } from "../src/renderer.js";
import { parseSvg, flows } from "./off-view-fixtures.js";

/** Independent source-to-SVG oracle: no production incidence/selection helper. */
it.each(flows)(
  "matches the example's complete authored incidence in %s",
  async (flow) => {
    const root = "examples/off-view-connections";
    const { objects } = JSON.parse(
      await readFile(`${root}/source.json`, "utf8"),
    );
    const names = new Map<string, string>(
      objects
        .filter((o: any) => o.kind === "device")
        .map((o: any) => [o.uid, o.designation]),
    );
    const facts: { key: string; name: string; ends: (string | null)[] }[] = [];
    const endpoint = (e: any) => (e ? `${e.device}.${e.terminal}` : null);
    for (const o of objects) {
      if (o.kind === "wire" || o.kind === "jumper")
        facts.push({
          key: `${o.kind}:${o.uid}`,
          name: o.designation ?? "Jumper",
          ends: o.endpoints.map(endpoint),
        });
      if (o.kind === "cable")
        for (const core of o.conductors)
          facts.push({
            key: `core:${o.uid}:${core.id}`,
            name: `${o.designation}.${core.id}`,
            ends: core.endpoints.map(endpoint),
          });
    }
    const compiled = await compileProject(root);
    if (!compiled.ok) throw Error(JSON.stringify(compiled));
    const rendered = await renderSchematic(
      compiled.ir,
      {
        format: "schematic-view-request/0.1",
        family: "control",
        root: { by: "designation", value: "K1" },
        flow,
      },
      compiled.presentation,
    );
    if (!rendered.ok) throw Error(JSON.stringify(rendered));
    const doc = parseSvg(rendered.value.svg),
      selected = new Set<string>();
    for (const path of doc.querySelectorAll("path.net-path")) {
      if (path.hasAttribute("data-wire-uid"))
        selected.add(`wire:${path.getAttribute("data-wire-uid")}`);
      if (path.hasAttribute("data-jumper-uid"))
        selected.add(`jumper:${path.getAttribute("data-jumper-uid")}`);
      if (path.hasAttribute("data-cable-uid"))
        selected.add(
          `core:${path.getAttribute("data-cable-uid")}:${path.getAttribute("data-conductor-id")}`,
        );
    }
    const terminals = new Set(
      [...doc.querySelectorAll(".terminal-marker")].map(
        (p) =>
          `${names.get(p.getAttribute("data-device-uid")!)}.${p.getAttribute("data-terminal-key")}`,
      ),
    );
    const annotations = [...doc.querySelectorAll("[data-off-view-terminal]")];
    let omitted = 0;
    for (const terminal of terminals) {
      const expected = facts.filter(
        (f) => f.ends.includes(terminal) && !selected.has(f.key),
      );
      const cards = annotations.filter(
        (g) => g.getAttribute("data-off-view-terminal") === terminal,
      );
      expect(cards).toHaveLength(expected.length ? 1 : 0);
      if (!expected.length) continue;
      omitted += expected.length;
      const card = cards[0]!,
        actual = JSON.parse(card.getAttribute("data-off-view-conductors")!);
      const keys = actual.map((id: any) =>
        id.kind === "cable_conductor"
          ? `core:${id.cableUid}:${id.conductorId}`
          : `${id.kind}:${id.uid}`,
      );
      expect(keys.sort()).toEqual(expected.map((f) => f.key).sort());
      expect(
        [...card.querySelectorAll(".off-view-heading")]
          .map((t) => t.textContent)
          .join(""),
      ).toBe(`Off-view at ${terminal}`);
      const printed = [...card.querySelectorAll(".off-view-row")]
        .map((t) => t.textContent)
        .join("");
      for (const f of expected) {
        const side = f.ends.indexOf(terminal),
          other = f.ends[side === 0 ? 1 : 0];
        expect(printed).toContain(
          `${f.name} → ${other ?? "unterminated (spare)"}`,
        );
      }
    }
    expect(annotations).toHaveLength(2);
    expect(omitted).toBe(7);
    const rows = annotations
      .flatMap((g) =>
        [...g.querySelectorAll(".off-view-row")].map((t) => t.textContent),
      )
      .join("");
    for (const text of ["CBL1.1", "CBL1.2", "Jumper"])
      expect(rows).toContain(text);
    expect(rows).not.toContain("84000000-0000-4000-8000-000000000021");
  },
);
