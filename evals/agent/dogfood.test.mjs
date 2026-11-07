import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  SYMBOL_PROFILES,
  symbolProfile,
} from "../../packages/schema/dist/index.js";
import { listedFiles } from "./source-files.mjs";
import { assessDogfood, fitsRole } from "./dogfood.mjs";
const core = (name) =>
  JSON.parse(
    readFileSync(
      new URL(
        `../../packages/core-library/library/types/${name}.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  ).types[0];
function fixture(taskName = "D-conveyor") {
  const task = JSON.parse(
    readFileSync(
      new URL(`./tasks/${taskName}/task.json`, import.meta.url),
      "utf8",
    ),
  );
  const corePairs = [
    ["SRC1", "supply-480v-3ph"],
    ["CB2", "breaker-3p"],
    ["K1", "contactor-3p-1no"],
    ["OL1", "overload-3p-1nc"],
    ["M1", "motor-3ph"],
    ["PS1", "psu-24vdc"],
    ["PLC1", "plc-compact"],
    ["TB1", "terminal-block-8"],
    ["JB1", "junction-box-8"],
    ["S1", "limit-switch-2wire"],
    ["S2", "pushbutton-nc"],
    ["LS1", "limit-switch-2wire"],
    ["B1", "prox-pnp-3wire"],
  ];
  const types = corePairs.map(([, name]) => ({
    ...core(name),
    library: "core",
  }));
  const extras = [
    {
      id: "test:pressure",
      symbol: "thermite:pressure-transmitter",
      functions: {},
    },
    {
      id: "test:analog",
      functions: {
        channel: {
          kind: "channel",
          direction: "input",
          terminals: ["abstract+", "abstract-"],
        },
      },
    },
    { id: "test:hmi", ports: { ETH: { medium: "ethernet" } }, functions: {} },
    {
      id: "test:lamp",
      symbol: "thermite:lamp",
      functions: {
        load: { kind: "load", terminals: ["abstract+", "abstract-"] },
      },
    },
  ];
  types.push(...extras.map((t) => ({ ...t, library: "test" })));
  const start = {
    ...core("limit-switch-2wire"),
    id: "test:start",
    symbol: "thermite:pushbutton",
    library: "test",
  };
  const level = {
    ...core("limit-switch-2wire"),
    id: "test:level",
    symbol: "thermite:level-switch",
    library: "test",
  };
  types.push(start, level);

  const sourceObjects = [
    ...corePairs.map(([designation, name]) => ({
      uid: designation,
      kind: "device",
      designation,
      type: core(name).id,
    })),
    ...["PT1", "AI1", "HMI1", "H1"].map((designation, i) => ({
      uid: designation,
      kind: "device",
      designation,
      type: extras[i].id,
    })),
    { uid: "CBL1", kind: "cable", designation: "CBL1" },
    {
      uid: "w1",
      kind: "wire",
      designation: "W-PSU-L",
      endpoints: [
        { device: "CB2", terminal: "2/T1" },
        { device: "PS1", terminal: "L" },
      ],
    },
    {
      uid: "w2",
      kind: "wire",
      designation: "W-PSU-N",
      endpoints: [
        { device: "CB2", terminal: "4/T2" },
        { device: "PS1", terminal: "N" },
      ],
    },
  ];
  sourceObjects.find((o) => o.designation === "S1").type = start.id;
  sourceObjects.find((o) => o.designation === "LS1").type = level.id;
  const roleTags = {
    supply: "SRC1",
    breaker: "CB2",
    contactor: "K1",
    overload: "OL1",
    motor: "M1",
    psu: "PS1",
    plc: "PLC1",
    terminal: "TB1",
    junction: "JB1",
    cable: "CBL1",
    "start-button": "S1",
    "stop-button": "S2",
    "level-switch": "LS1",
    "pnp-sensor": "B1",
    "pressure-transmitter": "PT1",
    "analog-input": "AI1",
    hmi: "HMI1",
    indicator: "H1",
  };
  const matrix = task.deliverables.requirements.map((r) => ({
    id: r.id,
    status: "satisfied",
    designations: r.roles.map((role) => roleTags[role]),
    requirement: r.id.toLowerCase(),
    evidence: {
      summary: "Validated source and sheet 1 show the specified role.",
    },
  }));
  const files = Object.fromEntries(
    [
      ...task.deliverables.views.map((name) => `drawings/${name}`),
      ...task.deliverables.reports.map((name) => `drawings/${name}.csv`),
      ...[
        "packet.json",
        "packet.html",
        "packet.pdf",
        "before.json",
        "review.json",
        "diagnostics.json",
        "cable.json",
      ].map((name) => `drawings/${name}`),
    ].map((path) => [path, true]),
  );
  const packet = {
    sheets: [
      {
        view: { format: "documentation-view/0.1", kind: "circuit" },
        references: sourceObjects
          .filter((o) => o.kind === "device")
          .map((o) => ({ designation: o.designation })),
      },
      {
        view: {
          format: "schematic-view/0.2",
          intent: "conductors",
          root: { kind: "cable", designation: "CBL1" },
        },
        references: [],
      },
      { view: { kind: "index" }, references: [] },
    ],
    coverage: {
      conductors: ["W-PSU-L", "W-PSU-N"].map((designation) => ({
        designation,
        appearances: [{ sheet: 1 }],
      })),
    },
  };
  return {
    task,
    validationExit: 0,
    files,
    packet,
    sourceObjects,
    types,
    calls: [
      {
        argv: ["agent", "apply-source-patch"],
        exit: 0,
        request: '{"dryRun":false}',
        editsByThisCall: [{ path: "source.json" }],
      },
    ],
    matrix,
    drawEvidence: {
      format: "thermite-agent-draw-evidence/1.0",
      V1: true,
      V5: true,
    },
    counts: { localTypes: 4, sourceReads: 0, failedCalls: 0 },
    diagnostics: [],
  };
}
for (const name of ["D-pump", "D-conveyor"]) {
  it(`${name} rejects unrelated PS1 diagnostics, including empty deferral subjects`, () => {
    for (const all of [false, true])
      for (const empty of [false, true]) {
        const x = fixture(name);
        x.diagnostics = [
          { code: "W905", designation: "PS1", severity: "warning" },
        ];
        for (const row of x.matrix.filter(
          (r) => all || r.id.endsWith("-MOTOR"),
        )) {
          row.status = "deferred";
          if (empty) row.designations = [];
          row.evidence = {
            summary: "Deferred pending requirement review",
            diagnostic: { code: "W905", designation: "PS1" },
          };
        }
        expect(assessDogfood(x).pass).toBe(false);
      }
  });
  it(`${name} complete synthetic deliverables pass all eight items`, () => {
    const r = assessDogfood(fixture(name));
    expect(r.pass, JSON.stringify(r.requirements)).toBe(true);
    expect(Object.values(r.checks).every((v) => v === true)).toBe(true);
  });
  it(`${name} capitalized display wording passes, met/gap statuses fail, blanket deferral fails`, () => {
    const x = fixture(name);
    for (const row of x.matrix) row.requirement = row.requirement.toUpperCase();
    expect(assessDogfood(x).pass).toBe(true);
    for (const row of x.matrix) row.status = "met";
    expect(assessDogfood(x).pass).toBe(false);
    for (const row of x.matrix) row.status = "gap";
    expect(assessDogfood(x).pass).toBe(false);
    for (const row of x.matrix) {
      row.status = "deferred";
      row.evidence = { summary: "n/a" };
    }
    expect(assessDogfood(x).pass).toBe(false);
  });
}
it("a contact or a mention of a lamp does not make the required device", () => {
  for (const [type, role] of [
    ["contactor-3p-1no", "start-button"],
    ["overload-3p-1nc", "stop-button"],
    ["breaker-3p", "level-switch"],
    ["pushbutton-nc", "indicator"],
  ])
    expect(fitsRole({ kind: "device" }, core(type), role)).toBe(false);
});
it("start, stop and level cannot be replaced by power contacts or share a pushbutton", () => {
  const x = fixture("D-pump"),
    replacements = { "P-START": "K1", "P-STOP": "OL1", "P-LEVEL": "CB2" };
  x.sourceObjects = x.sourceObjects.filter(
    (o) => !["S1", "S2", "LS1"].includes(o.designation),
  );
  for (const row of x.matrix)
    if (replacements[row.id]) row.designations = [replacements[row.id]];
  expect(assessDogfood(x).pass).toBe(false);
  const shared = fixture("D-pump");
  for (const r of shared.matrix)
    if (["P-START", "P-LEVEL"].includes(r.id)) r.designations = ["S2"];
  expect(assessDogfood(shared).pass).toBe(false);
});
it("the PLC's own analog input shares its designation across PLC, coil and network rows", () => {
  const x = fixture("D-pump"),
    plc = x.sourceObjects.find((o) => o.designation === "PLC1"),
    type = x.types.find((t) => t.id === plc.type);
  type.functions.analog = {
    kind: "channel",
    direction: "input",
    terminals: ["AI0+", "AI0-"],
  };
  x.matrix.find((r) => r.id === "P-ANALOG").designations = ["PLC1"];
  const result = assessDogfood(x);
  expect(result.pass, JSON.stringify(result.requirements)).toBe(true);
  for (const id of ["P-PLC", "P-COIL", "P-ANALOG", "P-NETWORK"])
    expect(result.requirements.find((r) => r.id === id).pass, id).toBe(true);
});
it("a separate analog device gets a non-failing integration note", () => {
  const result = assessDogfood(fixture("D-pump"));
  expect(result.pass).toBe(true);
  expect(result.pending).toContainEqual(
    expect.stringContaining("Separate analog input AI1"),
  );
});
it("an unrelated role pair still cannot share even a multifunction device", () => {
  const x = fixture("D-pump"),
    k = x.sourceObjects.find((o) => o.designation === "K1"),
    type = x.types.find((t) => t.id === k.type);
  type.functions.di = {
    kind: "channel",
    direction: "input",
    terminals: ["DI"],
  };
  type.functions.do = {
    kind: "channel",
    direction: "output",
    terminals: ["DO"],
  };
  x.matrix.find((r) => r.id === "P-PLC").designations = ["K1"];
  expect(fitsRole(k, type, "plc")).toBe(true);
  expect(fitsRole(k, type, "contactor")).toBe(true);
  const result = assessDogfood(x);
  expect(result.pass).toBe(false);
  expect(result.requirements.find((r) => r.id === "P-PLC").pass).toBe(false);
});
it("overlapping roles cannot hide K1's PLC and contactor conflict", () => {
  const x = fixture("D-pump"),
    k = x.sourceObjects.find((o) => o.designation === "K1"),
    type = x.types.find((t) => t.id === k.type);
  type.terminals.DI = { role: "digital_input" };
  type.terminals.DO = { role: "digital_output" };
  type.functions.di = {
    kind: "channel",
    direction: "input",
    terminals: ["DI"],
  };
  type.functions.do = {
    kind: "channel",
    direction: "output",
    terminals: ["DO"],
  };
  x.matrix.find((r) => r.id === "P-COIL").designations = ["K1"];
  expect(fitsRole(k, type, "plc")).toBe(true);
  expect(fitsRole(k, type, "contactor")).toBe(true);
  const result = assessDogfood(x);
  expect(result.pass).toBe(false);
  for (const id of ["P-COIL", "P-STARTER"])
    expect(result.requirements.find((r) => r.id === id).pass, id).toBe(false);
});
it.each(["satisfied", "deferred"])(
  "PS1 cannot stand in for a transmitter (%s)",
  (status) => {
    const x = fixture("D-pump"),
      row = x.matrix.find((r) => r.id === "P-TRANSMITTER");
    Object.assign(row, {
      status,
      designations: ["PS1"],
      evidence: {
        summary: "Pressure interface claimed on the power supply",
        diagnostic: { code: "W905", designation: "PS1" },
      },
    });
    x.diagnostics = [{ code: "W905", designation: "PS1", severity: "warning" }];
    expect(
      assessDogfood(x).requirements.find((r) => r.id === row.id).pass,
    ).toBe(false);
  },
);
it("a library-gap row names its own component, not an unrelated supply", () => {
  const x = fixture("D-pump"),
    row = x.matrix.find((r) => r.id === "P-TRANSMITTER"),
    req = x.task.deliverables.requirements.find((r) => r.id === row.id);
  // External task catalogs can still declare a genuine capability gap.
  req.allowedGap = { library: "core", capability: "pressure-transmitter" };
  row.status = "deferred";
  row.designations = ["PS1"];
  row.evidence = {
    summary: "Pressure model is missing from core",
    libraryGap: req.allowedGap,
  };
  expect(assessDogfood(x).pass).toBe(false);
});
it("catalog aliases and unspecified switch normal states are accepted", () => {
  const motor = core("motor-3ph");
  motor.symbol = "thermite:motor-3ph";
  expect(fitsRole({ kind: "device" }, motor, "motor")).toBe(true);
  expect(
    fitsRole(
      { kind: "device" },
      {
        symbol: "thermite:two-wire-transmitter",
        functions: { loop: { kind: "other", terminals: ["+", "-"] } },
      },
      "pressure-transmitter",
    ),
  ).toBe(true);
  expect(
    fitsRole(
      { kind: "device" },
      { ...core("pushbutton-nc"), symbol: "thermite:level-switch" },
      "level-switch",
    ),
  ).toBe(true);
});
for (const directory of ["library", "versions/0.2.0"])
  it(`every D role uses installed core ${directory} and catalog aliases`, () => {
    const dir = fileURLToPath(
      new URL(`../../packages/core-library/${directory}/`, import.meta.url),
    );
    const manifest = JSON.parse(
      readFileSync(join(dir, "library.json"), "utf8"),
    );
    const types = listedFiles(dir, manifest.sources).flatMap(
      (p) => JSON.parse(readFileSync(join(dir, p), "utf8")).types,
    );
    const absent = new Set();
    for (const name of ["D-pump", "D-conveyor"]) {
      const task = fixture(name).task;
      for (const req of task.deliverables.requirements)
        for (const role of req.roles) {
          if (role === "cable") {
            expect(fitsRole({ kind: "cable" }, null, role)).toBe(true);
            continue;
          }
          const candidates = types.filter((t) =>
            fitsRole({ kind: "device" }, t, role),
          );
          if (!candidates.length) {
            absent.add(role);
            expect(
              directory,
              `${name} ${role}: current core must supply every D capability`,
            ).toBe("library");
            continue;
          }
          for (const type of candidates) {
            const profile = SYMBOL_PROFILES.find(
              (p) => p.id === symbolProfile(type),
            );
            if (!profile) continue;
            for (const symbol of [
              profile.id,
              ...profile.aliases,
              ...profile.coreAliases.map((a) => a.symbol),
            ])
              expect(
                fitsRole({ kind: "device" }, { ...type, symbol }, role),
                `${role} ${symbol}`,
              ).toBe(true);
          }
        }
    }
    expect([...absent].sort()).toEqual(
      directory === "library"
        ? [
            "analog-input",
            "hmi",
            "indicator",
            "level-switch",
            "pressure-transmitter",
            "start-button",
          ]
        : [],
    );
    if (directory === "versions/0.2.0")
      expect(
        Math.max(
          ...types.map(
            (t) =>
              Object.values(t.functions ?? {}).filter(
                (f) =>
                  f.kind === "channel" &&
                  f.direction === "input" &&
                  f.terminals?.length === 1,
              ).length,
          ),
        ),
      ).toBeGreaterThanOrEqual(3);
  });
for (const [oldTag, newTag] of [
  ["TB1", "XT1"],
  ["CB2", "Q2"],
  ["H1", "HL1"],
  ["B1", "PX1"],
])
  it(`role coverage accepts ${oldTag} renamed to ${newTag}`, () => {
    const x = JSON.parse(
      JSON.stringify(fixture()).replaceAll(
        '"' + oldTag + '"',
        '"' + newTag + '"',
      ),
    );
    expect(assessDogfood(x).pass).toBe(true);
  });
it("an undrawn brief device or index-only mention fails coverage", () => {
  const x = fixture();
  x.packet.sheets[0].references = x.packet.sheets[0].references.filter(
    (r) => r.designation !== "B1",
  );
  x.packet.sheets[2].references = [{ designation: "B1" }];
  expect(assessDogfood(x).checks.coverage).toBe(false);
});
it("extra modeled equipment must also be drawn", () => {
  const x = fixture();
  x.sourceObjects.push({
    uid: "extra",
    kind: "device",
    designation: "EXTRA",
    type: "core:contactor-3p-1no",
  });
  expect(assessDogfood(x).checks.coverage).toBe(false);
});
it("a declared forged packet artifact fails even with real schematic coverage", () => {
  const x = fixture();
  x.files["drawings/packet.json"] = false;
  expect(assessDogfood(x).pass).toBe(false);
});
it("D deferral can retain W905 per designation instead of reference W904", () => {
  const x = fixture(),
    row = x.matrix.find((r) => r.id === "C-STOP");
  row.status = "deferred";
  row.evidence = {
    summary: "PLC monitoring remains deferred pending reviewed input hardware.",
    diagnostic: { code: "W905", designation: "S2" },
  };
  x.diagnostics = [
    {
      code: "W905",
      uid: "S2",
      severity: "warning",
      message: "S2: deferred work",
    },
  ];
  const r = assessDogfood(x);
  expect(r.pass).toBe(true);
  expect(r.expectedWarnings).toContainEqual({
    anyOf: ["W903", "W904", "W905"].map((code) => ({
      code,
      designation: "S2",
    })),
  });
});
it("a may item can be deferred with a reason but missing PDF review stays pending", () => {
  const x = fixture(),
    row = x.matrix.find((r) => r.id === "C-INDICATOR");
  row.status = "deferred";
  row.designations = [];
  row.evidence = {
    summary: "No supported indicator is available in this installed library.",
  };
  delete x.drawEvidence;
  const r = assessDogfood(x);
  expect(r.pass).toBe(true);
  expect(r.checks.pdfV1V5).toBe(null);
  expect(r.pending).toHaveLength(1);
});
for (const item of [
  "validation",
  "viewsAndPacket",
  "guardedChange",
  "reports",
  "coverage",
  "pdfV1V5",
  "requirementMatrix",
  "counts",
])
  it(`detects missing deliverable item ${item}`, () => {
    const x = fixture();
    if (item === "validation") x.validationExit = 1;
    if (item === "viewsAndPacket") x.files["drawings/packet.pdf"] = false;
    if (item === "guardedChange") x.calls = [];
    if (item === "reports") x.files["drawings/io.csv"] = false;
    if (item === "coverage") x.packet.coverage.conductors = [];
    if (item === "pdfV1V5") x.drawEvidence.V5 = false;
    if (item === "requirementMatrix") x.matrix = [];
    if (item === "counts") delete x.counts.localTypes;
    expect(assessDogfood(x).pass).toBe(false);
  });

it("published gap objects exactly match task metadata in both appendices", () => {
  for (const name of ["D-pump", "D-conveyor"]) {
    const dir = new URL(`./tasks/${name}/`, import.meta.url);
    const task = JSON.parse(readFileSync(new URL("task.json", dir), "utf8"));
    const prompt = readFileSync(new URL("prompt.md", dir), "utf8");
    const format = readFileSync(new URL("deliverable-format.md", dir), "utf8");
    expect(task.prompt).toBe(prompt);
    expect(prompt.endsWith(format)).toBe(true);
    expect(task.version).toBe("1.4.0");
    expect(task.deliverables.requirements.filter((r) => r.allowedGap)).toEqual(
      [],
    );
    expect(format).not.toContain("absent level capability");
    expect(format).not.toContain("; gap:");
    expect(format).toContain(
      "plc and analog-input roles may share a designation",
    );
    for (const row of task.deliverables.requirements.filter(
      (r) => r.allowedGap,
    )) {
      const line = format
        .split("\n")
        .find((line) => line.includes(`**${row.id} (`));
      expect(line).toContain(JSON.stringify(row.allowedGap));
    }
    if (name === "D-conveyor")
      expect(format).not.toMatch(/LS1|pressure transmitter/);
  }
});
