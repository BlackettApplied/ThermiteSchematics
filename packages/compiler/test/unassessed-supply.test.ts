import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileProject, serializeIr } from "../src/index.js";
import { evaluateRules } from "../src/rules/evaluate.js";
import { createRuleContext } from "../src/rules/context.js";
import { unassessedSingleRatedNetsRule } from "../src/rules/potential-assessment.js";
import {
  device,
  end,
  node,
  potential,
  project,
  wire,
  type Json,
} from "./validation-fixture.js";

it("repro86 reports K1.A1 without identifying a supply or joining functions", async () => {
  const root = await mkdtemp(join(tmpdir(), "thermite-repro86-"));
  try {
    await cp("packages/core-library/test/fixtures/dol-starter", root, {
      recursive: true,
    });
    const path = join(root, "source.json");
    const source = JSON.parse(await readFile(path, "utf8"));
    for (const wire of source.objects.filter((o: any) =>
      ["W30", "W40", "W41", "W42"].includes(o.designation),
    )) {
      const terminal = wire.designation === "W30" ? "X1" : "X2";
      for (const end of wire.endpoints) {
        if (end.device === "PS1")
          Object.assign(end, { device: "T1", terminal });
      }
    }
    await writeFile(path, JSON.stringify(source, null, 2) + "\n");
    const result = await compileProject(root);
    expect(result.ok).toBe(true);
    const info = result.diagnostics.filter((d) => d.code === "I305");
    expect(info).toHaveLength(1);
    expect(info[0]).toMatchObject({
      severity: "info",
      file: "system.json",
      jsonPointer: "/project",
    });
    expect(info[0]!.message).toContain("K1.A1 rating");
    expect(info[0]!.message).toContain("No supply path was assessed.");
    expect(info[0]!.message).not.toContain("T1");
    if (result.ok) {
      const id = (tag: string, key: string) =>
        result.ir.terminals.find(
          (t) =>
            t.id.deviceUid ===
              result.ir.devices.find((d) => d.designation === tag)!.uid &&
            t.id.terminalKey === key,
        )!.id;
      const net = (tag: string, key: string) =>
        result.ir.nets.find((n) =>
          n.terminalIds.some(
            (t) => JSON.stringify(t) === JSON.stringify(id(tag, key)),
          ),
        )!.id;
      expect(net("K1", "A1")).not.toBe(net("T1", "X1"));
      expect(result.ir.potentials).toEqual([]);
      // A supply-looking name cannot create a rating, supply path or net join.
      source.objects.find((o: any) => o.designation === "T1").designation =
        "DC-SUPPLY";
      for (const object of source.objects)
        for (const endpoint of object.endpoints ?? []) {
          if (endpoint?.device === "T1") endpoint.device = "DC-SUPPLY";
        }
      await writeFile(path, JSON.stringify(source, null, 2) + "\n");
      const renamed = await compileProject(root);
      expect(renamed.diagnostics.filter((d) => d.code === "I305")).toEqual(
        info,
      );
      if (!renamed.ok) throw Error(JSON.stringify(renamed.diagnostics));
      expect(renamed.ir.nets).toEqual(result.ir.nets);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const dc = { nominal_voltage: 24, voltage_type: "DC" };
async function single(a: Json = { rating: dc }, b: Json = {}, facts?: Json) {
  return compileProject(
    await project(
      [
        device(1, "K1"),
        wire(2, end("K1", "A1"), end("K1", "other")),
        ...(facts === undefined
          ? []
          : [potential(3, end("K1", "other"), facts)]),
      ],
      [node({ A1: a, other: b })],
    ),
  );
}
const codes = (r: Awaited<ReturnType<typeof single>>) =>
  r.diagnostics.map((d) => d.code);

describe("single-rated connected-net assessment", () => {
  it.each([dc, { voltage_type: "AC" }, { nominal_voltage: 24 }])(
    "reports exactly one authored voltage rating %j",
    async (rating) => {
      const r = await single({ rating });
      expect(codes(r)).toEqual(["I305"]);
      expect(r.diagnostics[0]).toMatchObject({
        file: "system.json",
        jsonPointer: "/project",
        severity: "info",
        related: [
          {
            file: "library/types.json",
            line: expect.any(Number),
            column: expect.any(Number),
            note: `Terminal "K1.A1" declares rating ${JSON.stringify(rating)} here.`,
          },
        ],
      });
      expect(r.diagnostics[0]!.message).toContain(
        JSON.stringify(`K1.A1 rating ${JSON.stringify(rating)}`).slice(1, -1),
      );
    },
  );
  it("moves a second voltage rating into unchanged I304 membership, even if excluded", async () => {
    for (const b of [{ rating: dc }, { role: "return", rating: dc }]) {
      expect(codes(await single({ rating: dc }, b))).toEqual(["I304"]);
    }
    expect(
      codes(await single({ rating: dc }, { rating: { voltage_type: "AC" } })),
    ).toEqual(["W303", "I304"]);
  });
  it.each([
    "return",
    "neutral",
    "protective_earth",
    "negative",
    "common",
    "mixed",
    "multi_rated",
    "AC/DC",
  ])("excludes %s ratings", async (role) => {
    expect(codes(await single({ role, rating: dc }))).toEqual([]);
  });
  it.each(["N", "PE", "M", "1M", "COM", "V-", "0V.1", "GND1"])(
    "excludes conventional reference key %s",
    async (key) => {
      const root = await project(
        [device(1, "N1"), wire(2, end("N1", key), end("N1", "b"))],
        [node({ [key]: { rating: dc }, b: {} })],
      );
      expect((await compileProject(root)).diagnostics).toEqual([]);
    },
  );
  it.each([
    {},
    { rating: { nominal_voltage: 0, voltage_type: "DC" } },
    { rating: { current: 10 } },
    { rating: { power: 5 } },
  ])("excludes zero or voltage-free rating %j", async (a) => {
    expect(codes(await single(a))).toEqual([]);
  });
  it.each([{}, { polarity: "positive" }, { current: 3 }])(
    "keeps voltage-free potential %j unassessed",
    async (facts) => {
      const r = await single({ rating: dc }, {}, facts);
      expect(codes(r)).toEqual(["I305"]);
      if (r.ok) expect(r.ir.potentials[0]!.electrical).toEqual(facts);
    },
  );
  it.each([{ voltage_type: "DC" }, { nominal_voltage: 24 }, dc])(
    "excludes any potential voltage fact %j",
    async (facts) => {
      expect(codes(await single({ rating: dc }, {}, facts))).toEqual([]);
    },
  );
  it("excludes isolated terminals and one-ended cable cores", async () => {
    const root = await project(
      [
        device(1, "K1"),
        {
          uid: "7f000000-0000-4000-8000-000000000002",
          kind: "cable",
          designation: "CBL1",
          type: "assessment:cable",
          conductors: [
            { id: "1", usage: "spare", endpoints: [end("K1", "A1"), null] },
          ],
        },
      ],
      [
        node({ A1: { rating: dc } }),
        {
          kind: "cable_type",
          id: "assessment:cable",
          conductors: [{ id: "1", color: "black" }],
        },
      ],
    );
    expect((await compileProject(root)).diagnostics).toEqual([]);
  });
  it.each(["E200", "E201"])(
    "gates only the %s net, retaining a disjoint I305",
    async (gate) => {
      const bad =
        gate === "E200"
          ? [
              {
                uid: "7f000000-0000-4000-8000-000000000004",
                kind: "cable",
                designation: "CBL1",
                type: "assessment:cable",
                conductors: [
                  {
                    id: "missing",
                    endpoints: [end("N", "bad"), end("N", "b")],
                  },
                ],
              },
            ]
          : [
              wire(4, end("N", "bad"), end("N", "b")),
              wire(5, end("N", "bad"), end("N", "c")),
            ];
      const root = await project(
        [device(1, "N"), wire(2, end("N", "good"), end("N", "a")), ...bad],
        [
          node({
            good: { rating: dc },
            a: {},
            bad: { rating: dc, connection_policy: "exclusive" },
            b: {},
            c: {},
          }),
          {
            kind: "cable_type",
            id: "assessment:cable",
            conductors: [{ id: "1", color: "black" }],
          },
        ],
      );
      const r = await compileProject(root);
      expect(codes(r)).toEqual([gate, "I208", "I305"]);
      expect(r.diagnostics.find((d) => d.code === "I208")!.message).toContain(
        "W303, I304, I305 on",
      );
      const info = r.diagnostics.find((d) => d.code === "I305")!;
      expect(info.message).toContain("N.good rating");
      expect(info.message).not.toContain("N.bad");
    },
  );
  it.each(["load", "lock", "reference"])(
    "reports I305 as skipped on a %s failure",
    async (gate) => {
      const root = await project(
        [device(1, "K1"), wire(2, end("K1", "A1"), end("K1", "other"))],
        [node({ A1: { rating: dc }, other: {} })],
      );
      if (gate === "load") await writeFile(join(root, "objects.json"), "{");
      else if (gate === "lock")
        await writeFile(
          join(root, "library/types.json"),
          (await readFile(join(root, "library/types.json"), "utf8")) + "\n",
        );
      else {
        const path = join(root, "objects.json");
        await writeFile(
          path,
          (await readFile(path, "utf8")).replace('"other"', '"missing"'),
        );
      }
      const r = await compileProject(root);
      expect(r.ok).toBe(false);
      expect(codes(r)).not.toContain("I305");
      expect(r.diagnostics.find((d) => d.code === "I208")!.message).toContain(
        "I304, I305 for the whole project",
      );
    },
  );
  it("bounds twelve naturally ordered entries and rating locations without mutating IR", async () => {
    const terminals: Json = {},
      objects: Json[] = [device(1, "N")];
    for (let i = 12; i >= 1; i--) {
      terminals[`T${i}`] = {
        rating: {
          frequency: 50,
          voltage_type: "DC",
          power: 12,
          current: 0.5,
          nominal_voltage: 24,
        },
      };
      terminals[`U${i}`] = {};
      objects.push(wire(i + 1, end("N", `T${i}`), end("N", `U${i}`)));
    }
    const root = await project(objects, [node(terminals)]);
    const r = await compileProject(root);
    if (!r.ok) throw Error(JSON.stringify(r.diagnostics));
    const before = serializeIr(r.ir);
    const ds = evaluateRules(r.ir);
    expect(ds).toHaveLength(1);
    const d = ds[0]!;
    expect(d.message).toContain("12 nets:");
    expect(d.message).toContain("and 2 more");
    expect(d.message.indexOf("N.T2")).toBeLessThan(d.message.indexOf("N.T10"));
    expect(d.message).not.toContain("N.T11");
    expect(d.related).toHaveLength(10);
    expect(d.related?.[0]?.note).toBe(
      'Terminal "N.T1" declares rating {"current":0.5,"frequency":50,"nominal_voltage":24,"power":12,"voltage_type":"DC"} here.',
    );
    expect(serializeIr(r.ir)).toBe(before);
    r.ir.nets.reverse();
    r.ir.terminals.reverse();
    r.ir.wires.reverse();
    for (const terminal of r.ir.terminals) {
      if (terminal.rating)
        terminal.rating = Object.fromEntries(
          Object.entries(terminal.rating).reverse(),
        );
    }
    for (const net of r.ir.nets) {
      net.terminalIds.reverse();
      net.conductiveElementIds.reverse();
    }
    expect(evaluateRules(r.ir)).toEqual(ds);
    expect(serializeIr(r.ir)).toBe(before);
    // The rule uses authored source refs only, without requiring source files
    // or an ambient cwd/locale lookup during evaluation.
    await rm(join(root, "library/types.json"));
    expect(
      unassessedSingleRatedNetsRule.evaluate(createRuleContext(r.ir)),
    ).toEqual(ds);
  });
});
