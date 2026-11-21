import { readFile, readdir } from "node:fs/promises";
import { expect, it } from "vitest";
import { parseHTML } from "linkedom";
import {
  prepareSchematicDrawing,
  createSchematicRendererWithDependencies,
} from "../src/renderer.js";
import { SYMBOL_CATALOG } from "../src/symbols/catalog.js";
import {
  isPowerSwitchingPole,
  gangAnchor,
} from "../src/symbols/gang-geometry.js";
import { rootedGangSegments } from "../src/symbols/rooted-gangs.js";
import { emitSchematicSvg } from "../src/svg/emitter.js";
import {
  authoredPowerMapping,
  DUT,
  libraryGangFixture,
} from "./library-gang-fixtures.js";
import type { ElectricalIr } from "@thermite/compiler";
import {
  projectDeviceTypeSymbolMappings,
  type FunctionSymbolRule,
} from "../src/symbols/mappings.js";

const inventory: { source: string; typeId: string; kind: string }[] =
  JSON.parse(
    await readFile("packages/render/test/fixtures/gang-inventory.json", "utf8"),
  );
async function gangSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const rows = await Promise.all(
    entries.map(async (entry) => {
      if (["node_modules", "dist", "goldens"].includes(entry.name)) return [];
      // Forward slashes keep inventory keys portable; Windows accepts them too.
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) return gangSourceFiles(path);
      return entry.isFile() &&
        entry.name.endsWith(".json") &&
        entry.name !== "electrical-system.lock.json"
        ? [path]
        : [];
    }),
  );
  return rows.flat();
}
function pole(ir: ElectricalIr, rule: FunctionSymbolRule) {
  return {
    representation: "function" as const,
    symbolId: rule.symbolId,
    classification: rule.classification,
    ports: rule.bindings.map((b, i) => ({
      id: b.portId,
      symbolPortId: b.portId,
      terminal: { deviceUid: DUT, terminalKey: b.terminalKey },
      netId: "",
      side: i ? ("east" as const) : ("west" as const),
      offset: 0.5,
      order: i,
      label: b.terminalKey,
    })),
  };
}

it("inventories every authored gang source, including libraries and core fixture definitions", async () => {
  const files = (
    await Promise.all(
      ["packages", "libraries", "examples"].map(gangSourceFiles),
    )
  ).flat();
  const actual: string[] = [];
  for (const f of files) {
    const text = await readFile(f, "utf8");
    if (!text.includes("ganged_with")) continue;
    const d = JSON.parse(text);
    for (const t of d.types ?? [d])
      if (
        t.kind === "device_type" &&
        t.internal_relations?.some((r: any) => r.relation === "ganged_with")
      )
        actual.push(`${f}#${t.id}`);
  }
  expect(actual.sort()).toEqual(
    inventory.map((r) => `${r.source}#${r.typeId}`).sort(),
  );
});

it.each(inventory)(
  "classifies $typeId ($source) as $kind without a power-role whitelist",
  async (row) => {
    const f = await libraryGangFixture(row.source, false, row.typeId);
    try {
      if (row.kind === "unmapped") {
        expect(projectDeviceTypeSymbolMappings(f.ir)).toHaveLength(0);
        return;
      }
      const before = JSON.stringify(f.ir),
        mapping = authoredPowerMapping(f.ir).find(
          (m) => m.typeId === row.typeId,
        )!;
      const keys = new Set(
        f.ir.gangedGroups.flatMap((g) =>
          g.functionIds.map((f) => f.functionKey),
        ),
      );
      const native = projectDeviceTypeSymbolMappings(f.ir).find(
        (m) => m.typeId === row.typeId,
      );
      for (const rule of native?.functions.filter(
        (r) => keys.has(r.functionKey) && r.families.includes("power"),
      ) ?? [])
        expect(isPowerSwitchingPole(pole(f.ir, rule), f.ir)).toBe(
          row.kind === "power",
        );
      for (const rule of mapping.functions.filter((r) =>
        keys.has(r.functionKey),
      ))
        expect(
          isPowerSwitchingPole(pole(f.ir, rule), f.ir),
          rule.functionKey,
        ).toBe(row.kind === "power");
      // Integral aux contacts must remain optional even if a supplied power mapping
      // classifies them as power-contact, as breaker profiles can do.
      for (const rule of mapping.functions.filter(
        (r) => !keys.has(r.functionKey),
      ))
        expect(
          isPowerSwitchingPole(pole(f.ir, rule), f.ir),
          rule.functionKey,
        ).toBe(false);
      expect(JSON.stringify(f.ir)).toBe(before);
    } finally {
      await f.dispose();
    }
  },
);

for (const part of [
  "libraries/schneider-pilot/types/lc1-d65p7.json",
  "libraries/stahl-pilot/types/8575-13-200.json",
]) {
  it(`keeps native profile refusal explicit for ${part}`, async () => {
    const f = await libraryGangFixture(part, true);
    try {
      expect(
        await prepareSchematicDrawing(f.ir, {
          format: "schematic-view-request/0.1",
          root: { by: "designation", value: "M1" },
          family: "power",
        }),
      ).toMatchObject({
        ok: false,
        error: { code: "R002", reason: "unsupported-symbol-profile" },
      });
    } finally {
      await f.dispose();
    }
  });
  it.each(["left-to-right", "top-to-bottom"] as const)(
    `paints ${part} in a motor view and refuses a forced collision in %s`,
    async (flow) => {
      const f = await libraryGangFixture(part, true);
      try {
        const before = JSON.stringify(f.ir),
          dependencies = { mappings: authoredPowerMapping(f.ir) },
          request = {
            format: "schematic-view-request/0.1",
            root: { by: "designation", value: "M1" },
            family: "power",
            flow,
          } as const;
        const drawing = await prepareSchematicDrawing(
          f.ir,
          request,
          undefined,
          dependencies,
        );
        if (!drawing.ok) throw Error(JSON.stringify(drawing.error));
        const result = await createSchematicRendererWithDependencies(
          dependencies,
        ).render(f.ir, request);
        if (!result.ok) throw Error(JSON.stringify(result.error));
        const p = drawing.value,
          group = f.ir.gangedGroups[0]!;
        expect(
          parseHTML(result.value.svg).document.querySelectorAll(
            `line[data-ganged-group="${group.id}"]`,
          ),
        ).toHaveLength(2);
        const gangs = rootedGangSegments(f.ir, p.graph, p.layout);
        if (!gangs.ok) throw Error(gangs.error.message);
        const link = gangs.value[0]!,
          blocked = structuredClone(p.layout),
          label = blocked.labels.find((l) =>
            p.graph.deviceGroups.some((g) => g.label.id === l.id),
          )!;
        label.x = (link.from.x + link.to.x) / 2 - label.width / 2;
        label.y = (link.from.y + link.to.y) / 2 - label.height / 2;
        const refused = emitSchematicSvg(
          p.graph,
          blocked,
          p.titleContext,
          SYMBOL_CATALOG,
          false,
          undefined,
          f.ir,
        );
        expect(refused).toMatchObject({
          ok: false,
          error: {
            code: "R006",
            details: {
              reason: "mechanical-gang",
              groupId: group.id,
              expectedStrokes: 2,
            },
          },
        });
        expect("value" in refused).toBe(false);
        if (!refused.ok) expect(refused.error.message).toContain(group.id);
        expect(JSON.stringify(f.ir)).toBe(before);
      } finally {
        await f.dispose();
      }
    },
  );
}

it("keeps unknown, absent and mixed roles mandatory for mapped power contacts", async () => {
  const f = await libraryGangFixture(
    "libraries/schneider-pilot/types/lc1-d65p7.json",
  );
  try {
    const rule = authoredPowerMapping(f.ir)
      .find((m) => m.typeId === "schneider-pilot:lc1-d65p7")!
      .functions.find((r) => r.functionKey === "pole1")!;
    for (const roles of [
      ["vendor-feed", "vendor-output"],
      [undefined, undefined],
      ["aux", "line"],
      ["common", "no_contact"],
    ]) {
      const ir = structuredClone(f.ir),
        n = pole(ir, rule);
      for (const [i, p] of n.ports.entries())
        ir.terminals.find(
          (t) =>
            t.id.deviceUid === DUT &&
            t.id.terminalKey === p.terminal.terminalKey,
        )!.role = roles[i];
      expect(isPowerSwitchingPole(n, ir)).toBe(true);
      expect(
        isPowerSwitchingPole(
          { ...n, symbolId: "ais:unknown-power-contact" },
          ir,
        ),
      ).toBe(true);
    }
    const mark = SYMBOL_CATALOG.find((s) => s.id === "ais:switch-no")!;
    expect(
      gangAnchor({
        symbolId: mark.id,
        orientation: "left-to-right",
        symbolSize: mark.size,
      }),
    ).toEqual({ x: 20, y: 12 });
    expect(
      gangAnchor({
        symbolId: mark.id,
        orientation: "top-to-bottom",
        symbolSize: { width: 24, height: 40 },
      }),
    ).toEqual({ x: 12, y: 20 });
  } finally {
    await f.dispose();
  }
});
