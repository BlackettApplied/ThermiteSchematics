import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { format as formatJson } from "prettier";
import type { ElectricalIr } from "@thermite/compiler";
import {
  renderSchematic,
  createSchematicRendererWithDependencies,
} from "../src/renderer.js";
import { createElkEngine } from "../src/layout/elk-runtime.js";
import * as layoutValidation from "../src/layout/validate-output.js";
import { normalizeSchematicView } from "../src/view-spec.js";
import { selectSemanticSubgraph } from "../src/selection.js";
import { buildPresentationGraph } from "../src/presentation.js";
import { projectDeviceTypeSymbolMappings } from "../src/symbols/mappings.js";
import { renderSchematicPacket } from "../src/sheets.js";
import type { RenderSummary } from "../src/types.js";
import {
  byDesignation,
  robustnessFixture,
} from "./render-robustness-fixture.js";

let fixture: Awaited<ReturnType<typeof robustnessFixture>>;
beforeAll(async () => {
  fixture = await robustnessFixture();
});
afterAll(async () => {
  await fixture.close();
});

function topology(ir: ElectricalIr, summary: RenderSummary) {
  const name = (uid: string) =>
    ir.devices.find((d) => d.uid === uid)!.designation;
  const terminal = (t: { deviceUid: string; terminalKey: string }) =>
    `${name(t.deviceUid)}.${t.terminalKey}`;
  return {
    terminals: summary.terminalIds.map(terminal).sort(),
    functions: summary.functionIds
      .map((f) => `${name(f.deviceUid)}.${f.functionKey}`)
      .sort(),
    conductors: summary.conductiveElementIds
      .map((id) => {
        if (id.kind !== "wire") throw Error("Expected fixture wire");
        const w = ir.wires.find((w) => w.uid === id.uid)!;
        return [
          w.designation,
          ...w.endpoints.map((e) => terminal(e.terminal)).sort(),
        ];
      })
      .sort(),
  };
}
const flows = ["left-to-right", "top-to-bottom"] as const;
const loads = {
  format: "schematic-view-request/0.2",
  root: byDesignation("PS1"),
  intent: { kind: "loads" },
} as const;

// The golden migration manifest is closed; test-only fixtures use native Vitest
// byte snapshots outside that inventory. Review SVG/JSON diffs
// after: VITEST_MAX_WORKERS=2 bun run test -- packages/render/test/render-robustness.test.ts -t 'direct pair golden|#60' --update
it.each(["external", "same-location"] as const)(
  "locks the %s direct pair golden in both flows",
  async (location) => {
    const { ir } = await fixture.compile(
      "minimal",
      undefined,
      location === "same-location" ? { plc2Location: "MAIN-PANEL" } : {},
    );
    for (const flow of flows) {
      const r = await renderSchematic(ir, { ...loads, flow });
      if (!r.ok) throw Error(JSON.stringify(r.error));
      await expect(r.value.svg).toMatchFileSnapshot(
        fileURLToPath(
          new URL(
            `snapshots/render-robustness/${location}-${flow}.svg`,
            import.meta.url,
          ),
        ),
      );
    }
  },
);

/** Remove identities, retaining every input ordering decision ELK can observe. */
function semanticIdentities(ir: ElectricalIr, value: unknown): unknown {
  const names = new Map(
    [...ir.devices, ...ir.wires].map((o) => [o.uid, o.designation]),
  );
  ir.nets.forEach((net) =>
    names.set(
      net.id,
      JSON.stringify(
        net.terminalIds
          .map((t) => [names.get(t.deviceUid), t.terminalKey])
          .sort(),
      ),
    ),
  );
  const visit = (v: unknown): unknown => {
    if (typeof v === "string") {
      if (names.has(v)) return names.get(v);
      if (v.startsWith("[")) {
        try {
          const section = /_s[0-9]+$/u.exec(v)?.[0] ?? "";
          return (
            JSON.stringify(
              visit(JSON.parse(section ? v.slice(0, -section.length) : v)),
            ) + section
          );
        } catch {}
      }
      return v;
    }
    if (Array.isArray(v)) return v.map(visit);
    if (v && typeof v === "object")
      return Object.fromEntries(
        // GWT's allocation hash is bookkeeping, not ELK geometry or identity.
        Object.entries(v)
          .filter(([k]) => k !== "$H")
          .map(([k, v]) => [k, visit(v)]),
      );
    return v;
  };
  return visit(value);
}

it("renders issue #51's fixed failing UIDs in both flows", async () => {
  const { ir } = await fixture.compile("minimal");
  for (const flow of flows) {
    const r = await renderSchematic(ir, { ...loads, flow });
    expect(r.ok, JSON.stringify(r)).toBe(true);
  }
});

it.each(["minimal", "plant", "same-location"] as const)(
  "renders the %s loads topology for 30 seeded UID assignments",
  async (variant) => {
    let expected: ReturnType<typeof topology> | undefined;
    const inputs = new Map<string, unknown>();
    const outputs = new Map<string, unknown>();
    for (let seed = 0; seed < 30; seed++) {
      const { ir } = await fixture.compile(
        variant === "same-location" ? "minimal" : variant,
        seed,
        variant === "same-location" ? { plc2Location: "MAIN-PANEL" } : {},
      );
      for (const flow of flows) {
        const engine = createElkEngine(),
          layout = engine.layout.bind(engine);
        const attempts: unknown[] = [],
          geometry: unknown[] = [];
        engine.layout = async (...args) => {
          attempts.push(semanticIdentities(ir, args[0]));
          const output = await layout(...args);
          geometry.push(semanticIdentities(ir, output));
          return output;
        };
        const r = await createSchematicRendererWithDependencies({
          layoutEngine: engine,
        }).render(ir, { ...loads, flow });
        expect(
          r.ok,
          `${variant} seed=${seed} flow=${flow}: ${JSON.stringify(r)}`,
        ).toBe(true);
        if (!r.ok) return;
        const drawn = topology(ir, r.value.summary);
        expected ??= drawn;
        expect(drawn).toEqual(expected);
        expect(drawn.conductors).toHaveLength(4);
        if (!inputs.has(flow)) {
          inputs.set(flow, attempts);
          outputs.set(flow, geometry);
        }
        expect(attempts).toEqual(inputs.get(flow));
        expect(geometry).toEqual(outputs.get(flow));
        if (variant === "same-location")
          expect(attempts.length).toBeGreaterThan(1);
      }
      if (variant === "plant") {
        const packet = await renderSchematicPacket(ir, {
          format: "schematic-packet-request/0.1",
          page: { size: "a3" },
          layout: "compact",
          index: true,
          views: [
            {
              format: "schematic-view-request/0.1",
              root: byDesignation("M1"),
              family: "power",
            },
            {
              format: "schematic-view-request/0.1",
              root: byDesignation("K1"),
              family: "control",
            },
            loads,
            {
              format: "schematic-view-request/0.2",
              root: byDesignation("LS1"),
              intent: {
                kind: "trace",
                to: byDesignation("PLC1"),
                includePower: false,
              },
            },
            {
              format: "documentation-view-request/0.1",
              kind: "wires",
              filter: { types: ["core:plc-compact"] },
            },
          ],
        });
        expect(
          packet.ok,
          `${variant} packet seed=${seed}: ${JSON.stringify(packet.ok ? "ok" : packet)}`,
        ).toBe(true);
      }
    }
  },
  30000,
);

it.each(["loads_via_k2", "trace_via_k2", "power_via_k2"] as const)(
  "identifies the intermediate terminal consistently in %s",
  async (variant) => {
    const { ir } = await fixture.compile(variant, 0);
    for (const flow of flows) {
      const request =
        variant === "loads_via_k2"
          ? loads
          : variant === "power_via_k2"
            ? ({
                format: "schematic-view-request/0.1",
                root: byDesignation("M1"),
                family: "power",
              } as const)
            : ({
                format: "schematic-view-request/0.2",
                root: byDesignation("LS1"),
                intent: {
                  kind: "trace",
                  to: byDesignation("PLC1"),
                  includePower: true,
                },
              } as const);
      const r = await renderSchematic(ir, { ...request, flow });
      expect(r).toMatchObject({
        ok: false,
        error: {
          code: "R003",
          details: {
            reason: "unrepresented-terminal",
            designation: "K2",
            terminalIds: [
              { terminalKey: variant === "loads_via_k2" ? "A2" : "A1" },
            ],
            alternative: { format: "circuit-view-request/0.1" },
          },
        },
      });
      if (!r.ok) {
        expect(r.error.message).toContain("thermite packet --input");
        expect(r.error.message).not.toContain("pole1");
        expect(r.error.message).not.toContain("Path stopped at");
        expect(r.error.unsupported).toBeUndefined();
        expect(r.error.details?.profileNote).toBeUndefined();
      }
    }
  },
);

// Keep RB's exact refusal payloads as compatibility controls even though these
// topologies now draw. A forced routing exhaustion must append the same advice.
async function forcedLoadRefusal(
  ir: ElectricalIr,
  variant: string,
  flow: (typeof flows)[number],
) {
  const old = JSON.parse(
    await readFile(
      new URL(
        `snapshots/render-robustness/${variant}-${flow}.r004.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  );
  old.message = old.message.slice(0, old.message.indexOf(" Selected loads:"));
  delete old.details.loads;
  const spy = vi
    .spyOn(layoutValidation, "normalizeAndValidateLayout")
    .mockReturnValue({
      ok: false,
      error: old,
      failureKind: "collinear-overlap",
    });
  const engine = createElkEngine();
  engine.layout = async (graph) => graph;
  try {
    return await createSchematicRendererWithDependencies({
      layoutEngine: engine,
    }).render(ir, { ...loads, flow });
  } finally {
    spy.mockRestore();
  }
}

it.each([
  ["plc3", ["PLC1", "PLC2", "PLC3"]],
  ["plc4", ["PLC1", "PLC2", "PLC3", "PLC4"]],
  ["daisy", ["PLC1", "PLC2"]],
  ["pnp", ["B1", "PLC1", "PLC2"]],
] as const)(
  "keeps exhausted %s routing as an actionable R004 (#60)",
  async (variant, names) => {
    const { ir } = await fixture.compile(variant, 0);
    for (const flow of flows) {
      const r = await forcedLoadRefusal(ir, variant, flow);
      expect(r).toMatchObject({
        ok: false,
        error: {
          code: "R004",
          family: "control",
          root: "PS1",
          netId: expect.stringMatching(/^net:sha256:/u),
          details: {
            loads: names.map((designation) => ({ designation })),
            originalMessage: expect.any(String),
            conductors: expect.any(Array),
          },
        },
      });
      if (!r.ok) {
        const suffix = ` Selected loads: ${names.join(", ")}. Draw these loads in a circuit view built from details.loads with thermite packet --input.${variant === "pnp" ? " A trace can also start at B1; choose its connected input target with --to and add --include-power." : ""}`;
        expect(r.error.message.endsWith(suffix)).toBe(true);
        await expect(
          await formatJson(JSON.stringify(r.error), { parser: "json" }),
        ).toMatchFileSnapshot(
          fileURLToPath(
            new URL(
              `snapshots/render-robustness/${variant}-${flow}.r004.json`,
              import.meta.url,
            ),
          ),
        );
      }
    }
  },
);

it("keeps an independent PS1 profile limitation beside the K2 terminal diagnosis", async () => {
  const { ir: original } = await fixture.compile("trace_via_k2", 0);
  const ir = {
    ...original,
    deviceTypes: original.deviceTypes.map((t) =>
      t.id === "core:psu-24vdc" ? { ...t, symbol: "thermite:lamp" } : t,
    ),
  };
  for (const flow of flows) {
    const request = {
      format: "schematic-view-request/0.2",
      root: byDesignation("LS1"),
      intent: {
        kind: "trace",
        to: byDesignation("PLC1"),
        includePower: true,
      },
      flow,
    } as const;
    const primary = await renderSchematic(original, request);
    const compound = await renderSchematic(ir, request);
    expect(compound).toMatchObject({
      ok: false,
      error: {
        code: "R003",
        unsupported: {
          designation: "PS1",
          profile: "thermite:lamp",
          functionKey: "dc_output",
        },
        details: {
          reason: "unrepresented-terminal",
          designation: "K2",
          profileNote: expect.stringContaining('device "PS1"'),
        },
      },
    });
    if (primary.ok || compound.ok) throw Error("Expected terminal refusal");
    expect(compound.error).toMatchObject({
      ...primary.error,
      message: `${primary.error.message} Additional profile limitation: device "PS1" uses profile "thermite:lamp", which is unsupported for this view.`,
    });
  }
});

it.each(["plc3", "pnp"] as const)(
  "executes the %s load advice: circuit from details.loads and eligible trace only",
  async (variant) => {
    const { ir } = await fixture.compile(variant, 0);
    for (const flow of flows) {
      const failure = await forcedLoadRefusal(ir, variant, flow);
      if (failure.ok) throw Error("Expected routing refusal");
      const selectedLoads = failure.error.details!.loads as {
        designation: string;
        deviceUid: string;
        functionIds: ElectricalIr["functions"][number]["id"][];
      }[];
      const source = ir.devices.find((d) => d.designation === "PS1")!;
      const selectedUids = new Set([
        source.uid,
        ...selectedLoads.map((load) => load.deviceUid),
      ]);
      const conductors = ir.wires
        .filter((wire) =>
          wire.endpoints.every((e) => selectedUids.has(e.terminal.deviceUid)),
        )
        .map((wire) => wire.designation!);
      const request = join(fixture.root, "loads-packet.json");
      await writeFile(
        request,
        JSON.stringify({
          format: "schematic-packet-request/0.1",
          views: [
            {
              format: "circuit-view-request/0.1",
              title: "Selected loads",
              flow,
              groups: [
                {
                  id: "loads",
                  functions: [
                    ...ir.functions
                      .filter(
                        (f) =>
                          f.id.deviceUid === source.uid && f.kind === "source",
                      )
                      .map((f) => ({
                        device: byDesignation("PS1"),
                        key: f.id.functionKey,
                      })),
                    ...selectedLoads.flatMap((load) =>
                      load.functionIds.map((f) => ({
                        device: byDesignation(load.designation),
                        key: f.functionKey,
                      })),
                    ),
                  ],
                  conductors,
                },
              ],
            },
          ],
        }),
      );
      const circuit = spawnSync(
        process.execPath,
        [
          resolve("thermite.mjs"),
          "packet",
          "--project",
          fixture.root,
          "--input",
          request,
          "--json",
        ],
        { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
      );
      expect(circuit.status, circuit.stderr).toBe(0);
      const packet = JSON.parse(circuit.stdout);
      expect(packet.sheets).toHaveLength(1);
      for (const conductor of conductors)
        expect(packet.sheets[0].svg).toContain(conductor);
      if (variant === "plc3") {
        expect(failure.error.message).not.toContain("trace");
      } else {
        expect(failure.error.message).toContain(
          "A trace can also start at B1;",
        );
        const trace = spawnSync(
          process.execPath,
          [
            resolve("thermite.mjs"),
            "view",
            "B1",
            "--to",
            "PLC1",
            "--include-power",
            "--flow",
            flow,
            "--project",
            fixture.root,
            "--json",
          ],
          { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
        );
        expect(trace.status, trace.stderr).toBe(0);
        expect(JSON.parse(trace.stdout).sheets).toHaveLength(1);
      }
    }
  },
);

it("reports the unsupported intermediate PLC1.M terminal as R003 (#50)", async () => {
  const { ir } = await fixture.compile("actuation");
  for (const flow of flows) {
    const r = await renderSchematic(ir, {
      format: "schematic-view-request/0.1",
      root: byDesignation("K1"),
      family: "control",
      flow,
    });
    expect(r).toMatchObject({
      ok: false,
      error: {
        code: "R003",
        details: { reason: "unrepresented-terminal", designation: "PLC1" },
      },
    });
    if (!r.ok)
      for (const text of ["PLC1.M", "W-K1-2", "W-CTL-002", "circuit view"])
        expect(r.error.message).toContain(text);
  }
});

it.each([false, true])(
  "never accepts missing conductors during bounded route recovery; retry=%s",
  async (retry) => {
    const { ir } = await fixture.compile("minimal", 0, {
      plc2Location: "MAIN-PANEL",
    });
    const engine = createElkEngine(),
      layout = engine.layout.bind(engine);
    let calls = 0;
    engine.layout = async (...args) => {
      calls++;
      const output = await layout(...args);
      if (!retry || calls > 1) output.edges!.pop();
      return output;
    };
    const r = await createSchematicRendererWithDependencies({
      layoutEngine: engine,
    }).render(ir, loads);
    expect(r).toMatchObject({ ok: false, error: { code: "R004" } });
    // Loads retry every R004, including malformed-output contract failures.
    // Full validation must still reject every candidate missing a conductor.
    expect(calls).toBe(16);
  },
);

it("recovers using the structured routing failure kind after message wording changes", async () => {
  const { ir } = await fixture.compile("minimal", 0, {
    plc2Location: "MAIN-PANEL",
  });
  const normalize = layoutValidation.normalizeAndValidateLayout;
  const kinds: string[] = [];
  const spy = vi
    .spyOn(layoutValidation, "normalizeAndValidateLayout")
    .mockImplementation((...args) => {
      const r = normalize(...args);
      if (r.ok) return r;
      kinds.push(r.failureKind);
      return {
        ...r,
        error: { ...r.error, message: "Reworded validator refusal." },
      };
    });
  try {
    const r = await renderSchematic(ir, loads);
    expect(r.ok, JSON.stringify(r.ok ? "ok" : r)).toBe(true);
    expect(spy.mock.calls.length).toBeGreaterThan(1);
    expect(kinds[0]).toBe("ambiguous-intersection");
  } finally {
    spy.mockRestore();
  }
});

it("keeps load advice after all 16 direct-pair routes fail validation", async () => {
  const { ir } = await fixture.compile("minimal", 0, {
    plc2Location: "MAIN-PANEL",
  });
  const normalize = layoutValidation.normalizeAndValidateLayout;
  let first: ReturnType<typeof normalize> | undefined;
  const spy = vi
    .spyOn(layoutValidation, "normalizeAndValidateLayout")
    .mockImplementation((...args) => (first ??= normalize(...args)));
  try {
    const failure = await renderSchematic(ir, loads);
    expect(spy).toHaveBeenCalledTimes(16);
    expect(failure).toMatchObject({
      ok: false,
      error: {
        code: "R004",
        details: { loads: [{ designation: "PLC1" }, { designation: "PLC2" }] },
      },
    });
    if (failure.ok || !first || first.ok)
      throw Error("Expected routing refusal");
    expect(failure.error.message).toBe(
      `${first.error.message} Selected loads: PLC1, PLC2. Draw these loads in a circuit view built from details.loads with thermite packet --input.`,
    );
    expect(failure.error).toMatchObject({
      ...first.error,
      message: expect.any(String),
    });
  } finally {
    spy.mockRestore();
  }
});

it.each(["K2.A2", "PS1.-", "TB1.1"])(
  "handles other intermediate ownership cases: %s",
  async (returnVia) => {
    const { ir } = await fixture.compile("actuation", undefined, { returnVia });
    for (const flow of flows) {
      const r = await renderSchematic(ir, {
        format: "schematic-view-request/0.1",
        root: byDesignation("K1"),
        family: "control",
        flow,
      });
      if (returnVia === "K2.A2") {
        expect(r).toMatchObject({
          ok: false,
          error: {
            code: "R003",
            details: { reason: "unrepresented-terminal", designation: "K2" },
          },
        });
        if (!r.ok)
          for (const text of ["K2.A2", "W-K1-2", "W-VIA"])
            expect(r.error.message).toContain(text);
      } else expect(r.ok, JSON.stringify(r)).toBe(true);
    }
  },
);

it.each([
  { plc2Designation: "A0", plc2Location: "MAIN-PANEL" },
  { plc2Designation: "Z9", plc2Location: "MAIN-PANEL" },
  { plc2Designation: "A0", plc2Location: "FIELD" },
  { plc2Designation: "Z9", plc2Location: "FIELD" },
  { plc2Designation: "A0", noPotentials: true, reverseAuthoredOrder: true },
])(
  "routes direct load forks using locations and catalog ports: %j",
  async (options) => {
    for (const seed of [0, 1, 2]) {
      const { ir } = await fixture.compile("minimal", seed, options);
      for (const flow of flows) {
        const r = await renderSchematic(ir, { ...loads, flow });
        expect(r.ok, JSON.stringify(r.ok ? "ok" : r)).toBe(true);
      }
    }
  },
);

it("draws #50's unchanged conductors in a circuit view with real terminal boundaries", async () => {
  const { ir } = await fixture.compile("actuation");
  for (const flow of flows) {
    const r = await renderSchematicPacket(ir, {
      format: "schematic-packet-request/0.1",
      views: [
        {
          format: "circuit-view-request/0.1",
          title: "K1 actuation conductors",
          flow,
          groups: [
            {
              id: "coil",
              functions: [{ device: byDesignation("K1"), key: "coil" }],
              conductors: ["W-K1-1", "W-K1-2", "W-CTL-002"],
            },
          ],
        },
      ],
    });
    expect(r.ok, JSON.stringify(r.ok ? "ok" : r)).toBe(true);
  }
});

it("executes the #50 message's literal packet instructions", async () => {
  const { ir } = await fixture.compile("actuation");
  const failure = await renderSchematic(ir, {
    format: "schematic-view-request/0.1",
    root: byDesignation("K1"),
    family: "control",
  });
  if (failure.ok) throw Error("Expected terminal display refusal");
  const instruction =
    /Put details\.alternative in the views array of a (schematic-packet-request\/0\.1) file and run (thermite packet --input) <file>\./u.exec(
      failure.error.message,
    );
  expect(instruction).not.toBeNull();
  if (!instruction) throw Error("Expected executable packet instructions");
  const alternative = failure.error.details!.alternative;
  expect(alternative).toMatchObject({
    format: "circuit-view-request/0.1",
    groups: [
      {
        functions: [{ device: byDesignation("K1"), key: "coil" }],
        conductors: ["W-CTL-002", "W-K1-1", "W-K1-2"],
      },
    ],
  });
  const request = join(fixture.root, "alternative.json");
  await writeFile(
    request,
    JSON.stringify({
      format: instruction[1],
      views: [alternative],
    }),
  );
  const command = instruction[2]!.split(" ").slice(1);
  const run = spawnSync(
    process.execPath,
    [resolve("thermite.mjs"), ...command, request, "--json"],
    { cwd: fixture.root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  expect(run.status, run.stderr).toBe(0);
  const packet = JSON.parse(run.stdout);
  expect(packet.format).toBe("schematic-packet/0.1");
  expect(packet.sheets).toHaveLength(1);
  for (const name of ["W-CTL-002", "W-K1-1", "W-K1-2"])
    expect(packet.sheets[0].svg).toContain(name);
});

it("keeps a display mapping removed after selection as an internal invariant", async () => {
  const { ir } = await fixture.compile("actuation", undefined, {
    returnVia: "TB1.1",
  });
  const normalized = normalizeSchematicView(ir, {
    format: "schematic-view-request/0.1",
    root: byDesignation("K1"),
    family: "control",
  });
  if (!normalized.ok || normalized.value.view.format !== "schematic-view/0.1")
    throw Error("Expected legacy view");
  const selected = selectSemanticSubgraph({
    ir,
    view: normalized.value.view,
    engine: normalized.value.engine,
  });
  if (!selected.ok) throw Error(JSON.stringify(selected.error));
  const broken = projectDeviceTypeSymbolMappings(ir).map((mapping) =>
    mapping.typeId === "core:terminal-block-8"
      ? {
          ...mapping,
          functions: mapping.functions.filter(
            (f) => f.functionKey !== "terminal1",
          ),
        }
      : mapping,
  );
  expect(() =>
    buildPresentationGraph({ ir, selected: selected.value, mappings: broken }),
  ).toThrow(/Selected conductor endpoint .* has no visible owner/u);
});
