import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileProject } from "../src/index.js";
import {
  device,
  end,
  node,
  potential,
  project,
  wire,
  type Json,
} from "./validation-fixture.js";

const ac = { nominal_voltage: 480, voltage_type: "AC" };
const dc = { nominal_voltage: 24, voltage_type: "DC" };
async function pair(a: Json, b: Json, potentials: Json[] = []) {
  const root = await project(
    [
      device(1, "PWR1"),
      wire(2, end("PWR1", "a"), end("PWR1", "b")),
      ...potentials,
    ],
    [node({ a, b })],
  );
  return compileProject(root);
}
describe("ratings without potential assessment", () => {
  it.each(["digital_input_4", "coil"])(
    "warns for the conveyor %s probe with rating sources and no inferred intent",
    async (role) => {
      const r = await pair(
        { role: "phase_1_source", rating: ac },
        { role, rating: dc },
      );
      expect(r.ok).toBe(true);
      const d = r.diagnostics.find((d) => d.code === "W303");
      expect(d).toMatchObject({
        severity: "warning",
        related: [
          expect.objectContaining({ file: "library/types.json" }),
          expect.objectContaining({ file: "library/types.json" }),
        ],
      });
      expect(d?.message).toMatch(/declared ratings disagree/i);
      expect(d?.message).toContain("PWR1.a");
      expect(d?.message).toContain("PWR1.b");
      expect(d?.message).toContain("library/types.json:");
      expect(r.diagnostics.filter((d) => d.code === "I304")).toHaveLength(1);
      if (r.ok) expect(r.ir.potentials).toEqual([]);
    },
  );
  it.each(["digital_input_4", "coil"])(
    "retains E301 with an authored potential for %s",
    async (role) => {
      const r = await pair(
        { role: "phase_1_source", rating: ac },
        { role, rating: dc },
        [potential(3, end("PWR1", "a"), ac)],
      );
      expect(r.ok).toBe(false);
      expect(r.diagnostics.map((d) => d.code)).toContain("E301");
      expect(r.diagnostics.map((d) => d.code)).not.toContain("W303");
      expect(r.diagnostics.map((d) => d.code)).not.toContain("I304");
    },
  );
  it("compares unequal positive DC nominal classes without changing E302", async () => {
    expect(
      (
        await pair({ rating: dc }, { rating: { ...dc, nominal_voltage: 48 } })
      ).diagnostics.map((d) => d.code),
    ).toContain("W303");
    const r = await pair(
      { rating: dc },
      { rating: { ...dc, nominal_voltage: 48 } },
      [potential(3, end("PWR1", "a"), dc)],
    );
    expect(r.diagnostics.map((d) => d.code)).toEqual(["E302"]);
  });
  it.each([
    "neutral",
    "protective_earth",
    "dc_return_output",
    "common",
    "coil_return",
    "0V",
    "0 V",
  ])("does not compare a reference or return role %s", async (role) => {
    const r = await pair({ rating: ac }, { role, rating: dc });
    expect(r.diagnostics.map((d) => d.code)).not.toContain("W303");
    expect(r.diagnostics.map((d) => d.code)).toContain("I304");
  });
  it.each([
    [
      { rating: { nominal_voltage: 480, voltage_type: "AC" } },
      { rating: { nominal_voltage: 277, voltage_type: "AC" } },
    ],
    [{ rating: { nominal_voltage: 0, voltage_type: "AC" } }, { rating: dc }],
    [{ rating: { nominal_voltage: 24 } }, { rating: ac }],
    [{ role: "mixed", rating: ac }, { rating: dc }],
    [{ role: "multi_rated", rating: ac }, { rating: dc }],
  ])(
    "leaves ambiguous, partial and multi-rated facts unassessed",
    async (a, b) => {
      const r = await pair(a, b);
      expect(r.diagnostics.map((d) => d.code)).not.toContain("W303");
      expect(r.diagnostics.map((d) => d.code)).toContain("I304");
    },
  );
  it("reports matching connected DC ratings as unassessed without potential voltage facts", async () => {
    const r = await pair({ rating: dc }, { rating: dc });
    expect(r.diagnostics.map((d) => d.code)).toEqual(["I304"]);
  });
  it("does not emit a summary for singleton, unrated or potential-covered nets", async () => {
    const root = await project(
      [device(1, "N")],
      [node({ a: { rating: dc }, b: {} })],
    );
    expect((await compileProject(root)).diagnostics).toEqual([]);
    const r = await pair({}, {});
    expect(r.diagnostics).toEqual([]);
    expect(
      (
        await pair({ rating: dc }, { rating: dc }, [
          potential(3, end("PWR1", "a"), { voltage_type: "DC" }),
        ])
      ).diagnostics,
    ).toEqual([]);
  });
  it("summarizes connected rated nets once, naturally sorted and capped at ten", async () => {
    const terminals: Json = {},
      objects: Json[] = [device(1, "N")];
    for (let i = 12; i >= 1; i--) {
      terminals[`T${i}`] = { rating: dc };
      terminals[`U${i}`] = { rating: dc };
      objects.push(wire(i + 1, end("N", `T${i}`), end("N", `U${i}`)));
    }
    const r = await compileProject(await project(objects, [node(terminals)]));
    const ds = r.diagnostics.filter((d) => d.code === "I304");
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ severity: "info" });
    expect(ds[0]?.message).toContain("12 nets:");
    expect(ds[0]?.message).toContain("and 2 more");
    expect(ds[0]?.message.indexOf("N.T2")).toBeLessThan(
      ds[0]!.message.indexOf("N.T10"),
    );
    expect(ds[0]?.message).not.toContain("N.T11");
    expect(ds[0]?.message).toContain(
      "Ratings describe equipment capability; potentials declare net intent",
    );
  });
});

it.each([
  "declared-ratings-conflict",
  "unassessed-rated-nets",
  "blocked-validation",
])(
  "matches the complete %s fixture including informational reports",
  async (name) => {
    const root = fileURLToPath(
      new URL(`../fixtures/rules/${name}/`, import.meta.url),
    );
    const expected = JSON.parse(
      await readFile(
        new URL(`../fixtures/rules/${name}/expected.json`, import.meta.url),
        "utf8",
      ),
    );
    const r = await compileProject(root);
    expect(r.diagnostics).toEqual(expected);
  },
);

describe("round 3 assessment controls", () => {
  async function keyedPair(key: string, role?: string) {
    const root = await project(
      [device(1, "N"), wire(2, end("N", "live"), end("N", key))],
      [
        node({
          live: { rating: ac },
          [key]: { rating: dc, ...(role === undefined ? {} : { role }) },
        }),
      ],
    );
    return compileProject(root);
  }
  it.each([
    "N",
    "PE",
    "FE",
    "GND",
    "0V",
    "0 V",
    "0VDC",
    "0VAC",
    "COM",
    "COMMON",
    "RETURN",
    "M",
    "-",
  ])("excludes conventional key %s without a declared role", async (key) => {
    const r = await keyedPair(key);
    expect(r.ok).toBe(true);
    expect(r.diagnostics.map((d) => d.code)).toEqual(["I304"]);
  });
  it.each([
    "neutral",
    "earth",
    "ground",
    "pe",
    "fe",
    "gnd",
    "common",
    "com",
    "return",
    "0v",
    "supply_0v",
    "mixed",
    "multi",
    "multirated",
    "dual",
  ])("pins explicit excluded role token %s", async (role) => {
    const r = await pair({ rating: ac }, { role, rating: dc });
    expect(r.diagnostics.map((d) => d.code)).toEqual(["I304"]);
  });
  it.each(["ac_dc", "AC/DC", "ac dc", "supply_ac_dc"])(
    "excludes the mixed AC+DC role %s without another exclusion token",
    async (role) => {
      const r = await pair({ rating: ac }, { role, rating: dc });
      expect(r.diagnostics.map((d) => d.code)).toEqual(["I304"]);
    },
  );
  it.each(["digital_input", "contact", "motor_output"])(
    "lets explicit %s roles take precedence over ambiguous signal keys",
    async (role) => {
      for (const key of ["N", "M", "1M", "2M", "100M", "COM", "COMMON"]) {
        const r = await keyedPair(key, role);
        expect(
          r.diagnostics.map((d) => d.code),
          `${role} ${key}`,
        ).toEqual(["W303", "I304"]);
      }
    },
  );
  it.each([
    "V-",
    "-V",
    "L-",
    "-L",
    "-",
    "0V",
    "0V.1",
    "0V 2",
    "0VDC",
    "GND",
    "GND1",
    "PE",
    "FE",
    "RETURN",
  ])("keeps reference key %s excluded despite generic roles", async (key) => {
    for (const role of ["output", "dc_output", "supply"]) {
      const r = await keyedPair(key, role);
      expect(r.ok, `${key} ${role}`).toBe(true);
      expect(
        r.diagnostics.map((d) => d.code),
        `${key} ${role}`,
      ).toEqual(["I304"]);
    }
  });
  it.each([
    "negative",
    "dc_negative",
    "output_negative",
    "minus",
    "dc_minus",
    "neg",
    "supply_neg",
  ])("does not compare shared DC returns with role %s", async (role) => {
    const r = await pair(
      { role, rating: dc },
      { role, rating: { ...dc, nominal_voltage: 5 } },
    );
    expect(r.diagnostics.map((d) => d.code)).toEqual(["I304"]);
  });
  it.each([
    "V-",
    "-V",
    "L-",
    "-L",
    "0V.1",
    "0V.2",
    "0V 1",
    "0V 2",
    "0 VDC.1",
    "1M",
    "2M",
    "GND1",
  ])(
    "does not compare a DC return named %s when no role is declared",
    async (key) => {
      const root = await project(
        [device(1, "N"), wire(2, end("N", "a"), end("N", key))],
        [
          node({
            a: { rating: dc },
            [key]: { rating: { ...dc, nominal_voltage: 5 } },
          }),
        ],
      );
      const r = await compileProject(root);
      expect(r.diagnostics.map((d) => d.code)).toEqual(["I304"]);
    },
  );
  it.each(["dc_negative", "output", "dc_output", "supply"])(
    "keeps bonded 24 V/5 V V- returns with role %s clean, including an explicit 0 V potential",
    async (role) => {
      const types = [
        node({ "V-": { role, rating: dc } }),
        {
          ...node({
            "V-": { role, rating: { ...dc, nominal_voltage: 5 } },
          }),
          id: "assessment:low",
        },
      ];
      const objects = [
        device(1, "G1"),
        device(2, "G2", "assessment:low"),
        wire(3, end("G1", "V-"), end("G2", "V-")),
      ];
      const r = await compileProject(await project(objects, types));
      expect(r.diagnostics.map((d) => d.code)).toEqual(["I304"]);
      const declared = await compileProject(
        await project(
          [
            ...objects,
            potential(4, end("G1", "V-"), {
              voltage_type: "DC",
              nominal_voltage: 0,
            }),
          ],
          types,
        ),
      );
      expect(declared.diagnostics).toEqual([]);
    },
  );
  it.each([
    [{ current: 10 }, { current: 16 }],
    [{ power: 5 }, { frequency: 60 }],
    [dc, { current: 10 }],
  ])(
    "distinguishes single-rated nets from nets without voltage ratings",
    async (a, b) => {
      const r = await pair({ rating: a }, { rating: b });
      expect(r.diagnostics.map((d) => d.code)).toEqual(
        a === dc ? ["I305"] : [],
      );
    },
  );
  it.each([
    [{ voltage_type: "AC" }, { voltage_type: "DC" }],
    [{ nominal_voltage: 24 }, { nominal_voltage: 48 }],
  ])(
    "includes nets with either explicit voltage-rating field",
    async (a, b) => {
      const r = await pair({ rating: a }, { rating: b });
      expect(r.diagnostics.filter((d) => d.code === "I304")).toHaveLength(1);
    },
  );
  it.each([{}, { polarity: "positive" }, { current: 3 }, { frequency: 60 }])(
    "does not treat voltage-free potential %j as voltage assessment",
    async (electrical) => {
      const r = await pair({ rating: ac }, { rating: dc }, [
        potential(3, end("PWR1", "a"), electrical),
      ]);
      expect(r.ok).toBe(true);
      expect(r.diagnostics.map((d) => d.code)).toEqual(["W303", "I304"]);
      if (r.ok) expect(r.ir.potentials[0]?.electrical).toEqual(electrical);
    },
  );
  it("recognizes voltage facts across compatible partial potential declarations", async () => {
    const r = await pair({ rating: dc }, { rating: dc }, [
      potential(3, end("PWR1", "a"), { polarity: "positive" }, "P"),
      potential(4, end("PWR1", "b"), { voltage_type: "DC" }, "P"),
    ]);
    expect(r.diagnostics).toEqual([]);
  });
  it("retains E300 with conflicting voltage-free declarations without hiding the rating obligation", async () => {
    const r = await pair({ rating: ac }, { rating: dc }, [
      potential(3, end("PWR1", "a"), {}, "A"),
      potential(4, end("PWR1", "b"), {}, "B"),
    ]);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.map((d) => d.code)).toEqual([
      "W303",
      "E300",
      "I208",
      "I304",
    ]);
  });
});

describe("partial potential assessment (#37)", () => {
  it.each([
    [
      "voltage_type",
      { nominal_voltage: 24 },
      { ...dc, voltage_type: "AC" },
      dc,
    ],
    [
      "nominal_voltage",
      { voltage_type: "DC" },
      dc,
      { ...dc, nominal_voltage: 5 },
    ],
  ])(
    "compares the undeclared %s with rating sources",
    async (field, electrical, a, b) => {
      const r = await pair({ rating: a }, { rating: b }, [
        potential(3, end("PWR1", "a"), electrical),
      ]);
      expect(r.ok).toBe(true);
      expect(r.diagnostics.map((d) => d.code)).toEqual(["W303"]);
      const warning = r.diagnostics[0]!;
      expect(warning.message).toContain(`does not declare ${field}`);
      if (r.ok) {
        expect(warning.message).toContain(r.ir.nets[0]!.id);
        expect(r.ir.potentials[0]!.electrical).toEqual(electrical);
        for (const t of r.ir.terminals) {
          expect(warning.message).toContain(`PWR1.${t.id.terminalKey}`);
          expect(warning.message).toContain(
            `${t.source.file}:${t.source.line}:${t.source.column} ${t.source.jsonPointer}`,
          );
        }
      }
      expect(warning.related).toHaveLength(2);
      expect(warning.related?.map((x) => x.file)).toEqual([
        "library/types.json",
        "library/types.json",
      ]);
    },
  );
  it("keeps a fully declared potential's diagnostics byte-identical", async () => {
    const r = await pair({ rating: ac }, { rating: dc }, [
      potential(3, end("PWR1", "a"), ac),
    ]);
    // Pinned before the fix, including message and related declaration sites.
    expect(r.diagnostics).toEqual([
      {
        code: "E301",
        severity: "error",
        file: "objects.json",
        line: 24,
        column: 5,
        jsonPointer: "/objects/2",
        uid: "7f000000-0000-4000-8000-000000000003",
        message:
          'Effective voltage type "AC" is incompatible with terminal ratings at "PWR1.b".',
        related: [
          {
            file: "library/types.json",
            line: 13,
            column: 14,
            note: 'Terminal "PWR1.b" is rated for voltage type "DC" here.',
          },
        ],
      },
      {
        code: "I208",
        severity: "info",
        file: "system.json",
        line: 3,
        column: 14,
        jsonPointer: "/project",
        message:
          'Checks not completed: E301 voltage-type gate: skipped E302 on 1 terminal: ["PWR1.b"].',
      },
    ]);
  });
  it.each([
    [{ voltage_type: "AC" }, ac, dc, "E301"],
    [{ nominal_voltage: 24 }, dc, { ...dc, nominal_voltage: 5 }, "E302"],
  ])(
    "leaves declared-field compatibility to the existing rule (%j)",
    async (electrical, a, b, code) => {
      const r = await pair({ rating: a }, { rating: b }, [
        potential(3, end("PWR1", "a"), electrical),
      ]);
      expect(r.diagnostics.map((d) => d.code)).toEqual(
        code === "E301" ? ["E301", "I208"] : [code],
      );
    },
  );
  it("combines compatible partial declarations without W303", async () => {
    const r = await pair(
      { rating: dc },
      { rating: { ...dc, nominal_voltage: 5 } },
      [
        potential(3, end("PWR1", "a"), { voltage_type: "DC" }, "P"),
        potential(4, end("PWR1", "b"), { nominal_voltage: 24 }, "P"),
      ],
    );
    expect(r.diagnostics.map((d) => d.code)).toEqual(["E302"]);
  });
  it.each([
    "neutral",
    "protective_earth",
    "0 V",
    "common",
    "return",
    "multi_rated",
    "AC/DC",
  ])("keeps the %s exclusion with either partial potential", async (role) => {
    for (const [electrical, a, b] of [
      [{ nominal_voltage: 24 }, { ...dc, voltage_type: "AC" }, dc],
      [{ voltage_type: "DC" }, dc, { ...dc, nominal_voltage: 5 }],
    ]) {
      const r = await pair({ rating: a }, { role, rating: b }, [
        potential(3, end("PWR1", "a"), electrical),
      ]);
      expect(r.diagnostics).toEqual([]);
    }
  });
  it("keeps zero-reference and line-to-line/line-to-neutral exclusions", async () => {
    for (const [electrical, a, b] of [
      [{ voltage_type: "DC" }, dc, { ...dc, nominal_voltage: 0 }],
      [{ voltage_type: "AC" }, ac, { ...ac, nominal_voltage: 277 }],
    ]) {
      expect(
        (
          await pair({ rating: a }, { rating: b }, [
            potential(3, end("PWR1", "a"), electrical),
          ])
        ).diagnostics,
      ).toEqual([]);
    }
  });
  it.each(["N", "PE", "0V", "COM"])(
    "keeps the reference-key %s exclusion with a partial potential",
    async (key) => {
      const root = await project(
        [
          device(1, "N1"),
          wire(2, end("N1", "a"), end("N1", key)),
          potential(3, end("N1", "a"), { voltage_type: "DC" }),
        ],
        [
          node({
            a: { rating: dc },
            [key]: { rating: { ...dc, nominal_voltage: 5 } },
          }),
        ],
      );
      expect((await compileProject(root)).diagnostics).toEqual([]);
    },
  );
});
