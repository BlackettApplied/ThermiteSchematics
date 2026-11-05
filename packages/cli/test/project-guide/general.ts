// Templates, the agent request contract, guarded patches, potentials, packets,
// the library lock, cable cores, report scoping and filters, PLC I/O, semantic
// review, watch and PDF output. Most facts read three shared fixtures (a
// starter "plant", a cabinets "cables" project and the connector-io example)
// or share one run: a single schema-error validate and a single semantic
// validate carry every negative case, each isolated by file and pointer.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import {
  agent,
  agentCommandHere,
  agentHere,
  copyProject,
  ctx,
  describeRun,
  editJson,
  entry,
  freshProject,
  integrity,
  makeProject,
  noteJson,
  observed,
  ok,
  once,
  packet,
  patchRequest,
  readJson,
  rejected,
  repositoryRoot,
  request,
  scratch,
  sharedProject,
  thermite,
  writeJson,
  type AgentRun,
  type FactModule,
  type Run,
} from "./harness.js";
/** Engine fixtures and shared case tables, loaded once a check needs them. */
const engine = () => import("./engine-cases.js");

// ---------------------------------------------------------------------------
// Helpers

const EQUIPMENT = "devices/equipment.json";
const WIRES = "connections/control-power.json";
const POTENTIALS = "potentials/potentials.json";
const LISTED = "devices/listed.json";
const UNLISTED = "devices/extra.json";
const PACKET = "schematic-packet-request/0.1";
const VIEW_01 = "schematic-view-request/0.1";
const VIEW_02 = "schematic-view-request/0.2";
const DOCUMENT_VIEW = "documentation-view-request/0.1";

const designation = (value: string) => ({ by: "designation", value });
const display = (value: string) => ({ by: "display", value });
const device = (name: string, type: string, extra: object = {}) => ({
  uid: randomUUID(),
  kind: "device",
  designation: name,
  type,
  ...extra,
});
/** `"PS1.+"` -> `{device: "PS1", terminal: "+"}`. */
const end = (dotted: string) => {
  const dot = dotted.indexOf(".");
  return { device: dotted.slice(0, dot), terminal: dotted.slice(dot + 1) };
};
let wires = 0;
const wire = (from: string, to: string) => ({
  uid: randomUUID(),
  kind: "wire",
  designation: `W-GEN-${(wires += 1)}`,
  endpoints: [end(from), end(to)],
});
const cable = (name: string, conductors: object[], extra: object = {}) => ({
  uid: randomUUID(),
  kind: "cable",
  designation: name,
  type: "core:cable-2pair-shielded",
  ...extra,
  conductors,
});
const potential = (fields: object) => ({
  uid: randomUUID(),
  kind: "potential",
  ...fields,
});
const validate = (project: string) => thermite(["validate", "."], project);
const output = (run: Run) => run.stdout + run.stderr;
const lastJson = (text: string) => JSON.parse(text.trim().split("\n").at(-1)!);
const byDesignation = (file: any, name: string) =>
  file.objects.find((o: any) => o.designation === name);
const coreDisplays = (core: any) =>
  core.endpoints.map((e: any) => e?.display ?? null);
const messages = (run: AgentRun, code: string) =>
  run.report.diagnostics
    .filter((d: { code: string }) => d.code === code)
    .map((d: { message: string }) => d.message);
/** The one diagnostic with `code` at `file` and `pointer`. */
function diagnosticAt(
  run: AgentRun,
  code: string,
  file: string,
  pointer: string,
) {
  const found = run.report.diagnostics.filter(
    (d: any) => d.code === code && d.file === file && d.jsonPointer === pointer,
  );
  expect(found, JSON.stringify(run.report.diagnostics)).toHaveLength(1);
  return found[0];
}

const inspect = async (project: string, name: string) => {
  const run = await agent(
    "inspect",
    request({ selector: designation(name) }),
    project,
  );
  expect(run.code, describeRun(["agent", "inspect", name], run)).toBe(0);
  return run.result.value.object;
};
const cableJson = async (project: string, name = "CBL1") =>
  JSON.parse((await ok(["cable", name, "--json"], project)).stdout);
/** Every object in the project's listed sources. */
async function sourceObjects(project: string) {
  const manifest = await readJson(join(project, "system.json"));
  return (
    await Promise.all(
      manifest.sources.map((s: string) => readJson(join(project, s))),
    )
  ).flatMap((file: any) => file.objects);
}
/** The core library's types by id, read from the starter template. */
const coreTypes = () =>
  once("general:core-types", async () => {
    const directory = join(ctx.pristine.starter, "libraries/core/types");
    const files = await Promise.all(
      (await readdir(directory)).map((name) => readJson(join(directory, name))),
    );
    return new Map<string, any>(
      files.flatMap((file) => file.types).map((t: any) => [t.id, t]),
    );
  });
/**
 * `thermite report <args> -o <csv>` with the CSV outside the project, and an
 * optional filter on stdin; `selection` is the stderr metadata.
 */
async function report(
  project: string,
  args: readonly string[],
  filter?: unknown,
) {
  const csv = join(await scratch("general-report"), "report.csv");
  const filtering = filter === undefined ? [] : ["--filter", "-"];
  if (filter !== undefined) noteJson(filter);
  const run = await ok(
    ["report", ...args, ...filtering, "-o", csv],
    project,
    filter === undefined ? undefined : JSON.stringify(filter),
  );
  return {
    csv: await readFile(csv, "utf8"),
    selection: lastJson(run.stderr).selection,
  };
}
const rows = (csv: string) => csv.trim().split("\n").slice(1);
/** `thermite continuity --input - --json` with these checks. */
async function continuity(project: string, checks: object[]) {
  const body = { format: "continuity-check-request/0.1", checks };
  noteJson(body);
  const run = await thermite(
    ["continuity", "--input", "-", "--json"],
    project,
    JSON.stringify(body),
  );
  return { ...run, json: JSON.parse(run.stdout) };
}
const packetError = (run: Run) => lastJson(run.stderr).error;
async function review(project: string, before: string) {
  const run = await ok(["review", "--before", before, "--json"], project);
  return JSON.parse(run.stdout).changes as any[];
}
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
/** Records a background process's output the way `thermite` does. */
function record(text: string) {
  for (const m of text.matchAll(/"code":\s*"([A-Z]\d{3})"/g))
    observed.codes.add(m[1]!);
  for (const line of text.split("\n"))
    if (line.startsWith("{"))
      try {
        noteJson(JSON.parse(line));
      } catch {
        // A partial line; its codes were counted above.
      }
}
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
/** The project's manifest, presentation and sources with UIDs masked. */
async function sourcesOf(project: string) {
  const manifest = await readJson(join(project, "system.json"));
  const paths = ["system.json", manifest.presentation, ...manifest.sources];
  return Object.fromEntries(
    await Promise.all(
      paths.map(async (path: string) => [
        path,
        (await readFile(join(project, path), "utf8")).replace(UUID, "<uid>"),
      ]),
    ),
  );
}

// ---------------------------------------------------------------------------
// Shared fixtures. Checks only read them; a check that writes copies one.

const PLC1_IO = {
  addressSpace: "PLC1",
  channels: {
    di0: { address: "%I0.0", signal: "Start", usage: "in-use" },
    di1: { usage: "spare" },
  },
};
/** Byte/bit/word overlap, an input address on an output and bad syntax. */
const PLC2_IO = {
  addressSpace: "PLC2",
  channels: {
    di0: { address: "%IB0" },
    di1: { address: "%I0.0" },
    do0: { address: "%IW0" },
    do1: { address: "NOT-AN-ADDRESS" },
  },
};
/**
 * The starter plus a motor feeder (SRC1, M1), a contactor coil (K1) and a
 * limit switch (LS1) into PLC1, which has `io`; PLC2 with odd addresses; S1 in
 * a new listed source; and an unlisted source whose UID is invalid. The build
 * validates it, so the unlisted file is ignored and PLC2's addresses pass.
 */
const plant = () =>
  sharedProject("general:plant", async (project) => {
    await cp(ctx.pristine.starter, project, { recursive: true });
    await editJson(join(project, EQUIPMENT), (file) => {
      byDesignation(file, "PLC1").io = PLC1_IO;
      // This synthetic plant authors the PSU feed below, completing the starter
      // deferral. Required flags and generic coverage stay on the library types.
      delete byDesignation(file, "PS1").connectionReview;
      file.objects.push(
        device("SRC1", "core:supply-480v-3ph"),
        device("M1", "core:motor-3ph"),
        device("K1", "core:contactor-3p-1no"),
        device("LS1", "core:limit-switch-2wire"),
        device("PLC2", "core:plc-compact", { io: PLC2_IO }),
      );
    });
    await editJson(join(project, WIRES), (file) =>
      file.objects.push(
        wire("SRC1.L1", "M1.U"),
        wire("SRC1.L2", "M1.V"),
        wire("SRC1.L3", "M1.W"),
        wire("SRC1.PE", "M1.PE"),
        wire("PLC1.X2.0", "K1.A1"),
        wire("K1.A2", "PS1.-"),
        wire("PS1.+", "LS1.13"),
        wire("LS1.14", "PLC1.X1.0"),
        wire("PS1.+", "S1.11"),
        wire("S1.12", "PLC2.X1.0"),
        // PLC2 supply stays unwired under the L0 helm decision (#51).
        wire("SRC1.L1", "PS1.L"),
        wire("SRC1.L2", "PS1.N"),
      ),
    );
    await editJson(join(project, "system.json"), (manifest) =>
      manifest.sources.push(LISTED),
    );
    await writeJson(join(project, LISTED), {
      objects: [device("S1", "core:pushbutton-nc")],
    });
    await writeJson(join(project, UNLISTED), {
      objects: [
        {
          ...device("K9", "core:contactor-3p-1no"),
          uid: randomUUID().toUpperCase(),
        },
      ],
    });
    // Source edits only, so the library lock still holds.
    await ok(["validate", "."], project);
  });
/**
 * Cabinets with CBL1's 1+ reversed, 1- without usage, 2+ a spare with two
 * real ends and 2- omitted; CBL2 a single-ended spare; CBL3 an endpoint-free
 * spare; CBL4 a legacy cable (no usage or locations) authored B-then-A on 1+;
 * and PLC1 with exclusive X1.0 wired from TB1.5.
 */
const cables = () =>
  sharedProject("general:cables", async (project) => {
    await cp(ctx.pristine.cabinets, project, { recursive: true });
    await editJson(join(project, EQUIPMENT), (file) => {
      const cbl1 = byDesignation(file, "CBL1");
      cbl1.conductors[0].endpoints.reverse();
      delete cbl1.conductors[1].usage;
      cbl1.conductors[2].endpoints = [end("TB1.3"), end("TB2.3")];
      cbl1.conductors.pop();
      file.objects.push(
        device("PLC1", "core:plc-compact"),
        cable("CBL2", [
          { id: "1+", usage: "spare", endpoints: [null, end("TB2.4")] },
        ]),
        cable("CBL3", [{ id: "1+", usage: "spare", endpoints: [null, null] }]),
        cable("CBL4", [
          { id: "1+", endpoints: [end("TB2.6"), end("TB1.6")] },
          { id: "1-", endpoints: [end("TB1.7"), end("TB2.7")] },
        ]),
      );
    });
    await editJson(join(project, WIRES), (file) =>
      file.objects.push(wire("TB1.5", "PLC1.X1.0")),
    );
    await ok(["validate", "."], project);
  });
/** The source checkout's connector-io example: R1 ports in PLC1's space. */
const connectorIo = () =>
  sharedProject("general:connector-io", async (project) => {
    for (const path of [
      "system.json",
      "source.json",
      "library",
      "electrical-system.lock.json",
    ])
      await cp(
        join(repositoryRoot, "examples/connector-io", path),
        join(project, path),
        { recursive: true },
      );
  });

// ---------------------------------------------------------------------------
// Shared runs

const plcOnly = { types: ["core:plc-compact"] };
const tb2 = { devices: ["TB2"] };
const loads = {
  format: VIEW_02,
  root: designation("PS1"),
  intent: { kind: "loads" },
};
const PLANT_VIEWS = [
  { format: VIEW_01, root: designation("M1"), family: "power" },
  { format: VIEW_01, root: designation("K1"), family: "control" },
  loads,
  {
    format: VIEW_02,
    root: designation("LS1"),
    intent: { kind: "trace", to: designation("PLC1"), includePower: false },
  },
  { format: DOCUMENT_VIEW, kind: "wires", filter: plcOnly },
];
const PLANT_PACKET = {
  format: PACKET,
  page: { size: "letter" },
  layout: "compact",
  index: true,
  views: PLANT_VIEWS,
};
const plantPacket = () =>
  once("general:plant-packet", async () => packet(await plant(), PLANT_PACKET));
const plantValidate = () =>
  once("general:plant-validate", async () =>
    agent("validate", request({}), await plant()),
  );
/**
 * PLC2's required supply is unwired (W903). The coil net (PLC1.X2.0 to
 * K1.A1) joins two rated terminals without a potential and is unassessed (I304).
 */
function expectPlantDiagnostics(diagnostics: readonly any[]) {
  expect(diagnostics.map((d) => [d.code, d.severity, d.jsonPointer])).toEqual([
    ["W903", "warning", "/objects/6"],
    ["I304", "info", "/project"],
  ]);
  expect(diagnostics[0].message).toBe(
    "PLC2: Required terminal PLC2.L+ has no connection. Required terminal PLC2.M has no connection.",
  );
  expect(diagnostics[1].message).toMatch(
    /^Voltage compatibility is unassessed on rated nets without voltage facts in potentials \(1 net: \["K1\.A1, PLC1\.X2\.0 \[net:sha256:[0-9a-f]{64}\]"\]\)\./,
  );
}
/** `project: ".."` from a project root: the parent is not a project. */
const parentValidate = () =>
  once("general:parent-validate", () =>
    agent("validate", request({ project: ".." }), ctx.pristine.starter),
  );
const nameAsUid = () =>
  once("general:name-as-uid", () =>
    agent(
      "resolve",
      request({ target: { by: "uid", value: "PLC1" } }),
      ctx.pristine.starter,
    ),
  );
const plantSnapshot = () =>
  once("general:plant-snapshot", async () => {
    const path = join(await scratch("general-snapshot"), "before.json");
    await ok(["snapshot", "-o", path], await plant());
    return path;
  });
/** S1's NC contact spans 11 and 12; only 11 is wired. */
const plantContinuity = () =>
  once("general:plant-continuity", async () =>
    continuity(await plant(), [
      {
        id: "through-contact",
        reason: "guide check",
        from: display("PS1.+"),
        to: display("S1.12"),
      },
      {
        id: "wired",
        reason: "guide check",
        from: display("PS1.+"),
        to: display("S1.11"),
      },
    ]),
  );
const plantIo = () =>
  once("general:plant-io", async () => report(await plant(), ["io"]));
const pristineCable = () =>
  once("general:pristine-cable", () => cableJson(ctx.pristine.cabinets));
const fixtureCable = () =>
  once("general:fixture-cable", async () => cableJson(await cables()));
const tb2Wires = () =>
  once("general:tb2-wires", async () => report(await cables(), ["wires"], tb2));
const tb2Cables = () =>
  once("general:tb2-cables", async () =>
    report(await cables(), ["cables"], tb2),
  );
const conductorSheets = () =>
  once("general:conductor-sheets", async () =>
    packet(await cables(), {
      format: PACKET,
      views: ["CBL1", "CBL4"].map((name) => ({
        format: VIEW_02,
        root: designation(name),
        intent: { kind: "conductors" },
      })),
    }),
  );
/**
 * One agent validate whose every error is at its own file and pointer:
 * CBL1 (/objects/2) core 1+ with three ends, 1- with one, 2+ usage "unused";
 * CBL5 (/objects/3) with unterminated ends on a core without usage, an
 * in-use core with one null end and an in-use core with two; an uppercase
 * UID in a new listed source; potentials without `electrical` or `name`.
 * The unterminated cases sit on their own cable because an E014 on a cable
 * masks them.
 */
const schemaErrors = () =>
  once("general:schema-errors", async () => {
    const project = await freshProject("cabinets");
    await editJson(join(project, EQUIPMENT), (file) => {
      const cbl1 = byDesignation(file, "CBL1");
      cbl1.conductors[0].endpoints.push(end("TB1.3"));
      cbl1.conductors[1].endpoints.pop();
      cbl1.conductors[2].usage = "unused";
      file.objects.push(
        cable("CBL5", [
          { id: "1+", endpoints: [null, end("TB2.5")] },
          { id: "1-", usage: "in-use", endpoints: [end("TB1.6"), null] },
          { id: "2+", usage: "in-use", endpoints: [null, null] },
        ]),
      );
    });
    await editJson(join(project, "system.json"), (manifest) =>
      manifest.sources.push(LISTED),
    );
    await writeJson(join(project, LISTED), {
      objects: [
        {
          ...device("K1", "core:contactor-3p-1no"),
          uid: randomUUID().toUpperCase(),
        },
      ],
    });
    await editJson(join(project, POTENTIALS), (file) =>
      file.objects.push(
        potential({ name: "NO-ELECTRICAL", at: end("TB1.1") }),
        potential({
          at: end("TB1.2"),
          electrical: { nominal_voltage: 24, voltage_type: "DC" },
        }),
      ),
    );
    return agent("validate", request({}), project);
  });
const SEMANTIC_PLCS = {
  PLC3: { "X1.0": { address: "%I0.0" } },
  PLC4: { di9: { address: "%I0.0" } },
  PLC5: { supply: { address: "%I0.0" } },
  PLC6: { di0: { address: "%I0.0" }, di1: { address: "%i0.0" } },
};
/**
 * One agent validate with every semantic error on its own net or device:
 * 480 V AC (SRC1.L1) and 480 V of no type (SRC1.L2) into PLC1's 24 VDC
 * inputs; `electrical: {}` (SRC1.L3) and no potential at all (SRC2.L1) into
 * PLC2's; a second name on the +24VDC net; and one bad `io` per PLC3-PLC6,
 * since E202 reports one error per device.
 */
const semanticErrors = () =>
  once("general:semantic-errors", async () => {
    const project = await freshProject("starter");
    await editJson(join(project, EQUIPMENT), (file) =>
      file.objects.push(
        device("SRC1", "core:supply-480v-3ph"),
        device("SRC2", "core:supply-480v-3ph"),
        device("PLC2", "core:plc-compact"),
        ...Object.entries(SEMANTIC_PLCS).map(([name, channels]) =>
          device(name, "core:plc-compact", {
            io: { addressSpace: name, channels },
          }),
        ),
      ),
    );
    await editJson(join(project, WIRES), (file) =>
      file.objects.push(
        wire("SRC1.L1", "PLC1.X1.0"),
        wire("SRC1.L2", "PLC1.X1.1"),
        wire("SRC1.L3", "PLC2.X1.0"),
        wire("SRC2.L1", "PLC2.X1.1"),
      ),
    );
    await editJson(join(project, POTENTIALS), (file) =>
      file.objects.push(
        potential({
          name: "480VAC",
          at: end("SRC1.L1"),
          electrical: { nominal_voltage: 480, voltage_type: "AC" },
        }),
        potential({
          name: "480V",
          at: end("SRC1.L2"),
          electrical: { nominal_voltage: 480 },
        }),
        potential({ name: "UNRATED", at: end("SRC1.L3"), electrical: {} }),
        potential({
          name: "24V-ALT",
          at: end("PLC1.L+"),
          electrical: { nominal_voltage: 24, voltage_type: "DC" },
        }),
      ),
    );
    return agent("validate", request({}), project);
  });
/**
 * Dry-run, apply and review one two-file request (K2 and its wire) on a copy
 * of the plant, then regenerate a packet.
 */
const guarded = () =>
  once("general:guarded", async () => {
    const project = await copyProject(await plant(), "general-guarded");
    const before = plantSnapshot();
    const hashOf = async (path: string) =>
      integrity(await readFile(join(project, path)));
    const k2 = device("K2", "core:contactor-3p-1no");
    const coil = wire("PLC1.X2.1", "K2.A1");
    const dry = request({
      patchFormat: "json-patch/0.1",
      dryRun: true,
      files: [
        {
          path: EQUIPMENT,
          expectedIntegrity: await hashOf(EQUIPMENT),
          operations: [
            { op: "test", path: "/objects/1/designation", value: "PLC1" },
            { op: "add", path: "/objects/-", value: k2 },
          ],
        },
        {
          path: WIRES,
          expectedIntegrity: await hashOf(WIRES),
          operations: [{ op: "add", path: "/objects/-", value: coil }],
        },
      ],
    });
    const preview = await agent("apply-source-patch", dry, project);
    const applied = await agent(
      "apply-source-patch",
      { ...dry, dryRun: false },
      project,
    );
    const written = {
      [EQUIPMENT]: await hashOf(EQUIPMENT),
      [WIRES]: await hashOf(WIRES),
    };
    const snapshot = await before;
    const changes = await review(project, snapshot);
    await mkdir(join(project, "drawings"));
    const regenerated = await packet(
      project,
      {
        format: PACKET,
        views: [loads, { format: DOCUMENT_VIEW, kind: "bom" }],
      },
      ["-o", "drawings/packet.html"],
    );
    expect(regenerated.code, describeRun(regenerated.args, regenerated)).toBe(
      0,
    );
    const html = await readFile(join(project, "drawings/packet.html"), "utf8");
    return { preview, applied, written, snapshot, changes, coil, html };
  });
/**
 * On a copy of the plant: presentation edits, reformatted equipment and a
 * changed plc-compact description; validate (E108), lock, validate, review.
 */
const libraryChange = () =>
  once("general:library-change", async () => {
    const project = await copyProject(await plant(), "general-library");
    const before = plantSnapshot();
    await editJson(join(project, "presentation.json"), (presentation) => {
      presentation.titleBlock.lines = ["Changed"];
      presentation.revision = "B";
    });
    const equipment = join(project, EQUIPMENT);
    await writeFile(equipment, JSON.stringify(await readJson(equipment)));
    await editJson(
      join(project, "libraries/core/types/plc-compact.json"),
      (file) => (file.types[0].description = "Edited PLC"),
    );
    const stale = await validate(project);
    const locked = await ok(["lock", "."], project);
    const relocked = await validate(project);
    const changes = await review(project, await before);
    return { stale, locked, relocked, changes };
  });
/** View PS1's loads on A4 portrait with a title the math fallback covers. */
const mathPdf = () =>
  once("general:math-pdf", async () => {
    const project = await freshProject("starter");
    await editJson(join(project, "presentation.json"), (presentation) => {
      presentation.titleBlock.lines = ["Pump ∑ Ω"];
    });
    const args = [
      "view",
      "PS1",
      "--loads",
      "--paper",
      "a4",
      "--orientation",
      "portrait",
      "-o",
      "sheet.pdf",
    ];
    await ok(args, project);
    return (await readFile(join(project, "sheet.pdf"))).toString("latin1");
  });

// ---------------------------------------------------------------------------
// Facts

const module: FactModule = {
  facts: [
    {
      claim:
        "The default `starter` template has PS1, a 24 VDC supply feeding PLC1; `cabinets` has TB1 and TB2 joined by cable CBL1 (two used, two spare cores).",
      async check() {
        // ctx.pristine.starter came from a bare `init`; the named template
        // must match it apart from UIDs.
        const parent = await scratch("init");
        const { starter, cabinets } = ctx.pristine;
        const [, types, starterObjects, cabinetObjects, cable] =
          await Promise.all([
            ok(["init", "named", "--template", "starter"], parent),
            coreTypes(),
            sourceObjects(starter),
            sourceObjects(cabinets),
            pristineCable(),
          ]);
        expect(await sourcesOf(join(parent, "named"))).toEqual(
          await sourcesOf(starter),
        );
        expect(ctx.devices.starter).toEqual(new Set(["PS1", "PLC1"]));
        const ps1 = byDesignation({ objects: starterObjects }, "PS1");
        expect(ps1.type).toBe("core:psu-24vdc");
        expect(types.get(ps1.type).terminals["+"].rating).toMatchObject({
          nominal_voltage: 24,
          voltage_type: "DC",
        });
        const ends = starterObjects
          .filter((o: any) => o.kind === "wire")
          .map((o: any) =>
            o.endpoints.map((e: any) => `${e.device}.${e.terminal}`),
          );
        expect(ends).toEqual(
          expect.arrayContaining([
            ["PS1.+", "PLC1.L+"],
            ["PS1.-", "PLC1.M"],
          ]),
        );

        expect(ctx.devices.cabinets).toEqual(new Set(["TB1", "TB2"]));
        for (const name of ["TB1", "TB2"])
          expect(byDesignation({ objects: cabinetObjects }, name).type).toBe(
            "core:terminal-block-8",
          );
        expect(cable.counts).toEqual({
          total: 4,
          connected: 2,
          spare: 2,
          unassigned: 0,
        });
        expect(
          cable.cores.map((c: any) => [c.id, c.usage, coreDisplays(c)]),
        ).toEqual([
          ["1+", "in-use", ["TB1.1", "TB2.1"]],
          ["1-", "in-use", ["TB1.2", "TB2.2"]],
          ["2+", "spare", [null, null]],
          ["2-", "spare", [null, null]],
        ]);
      },
    },
    {
      claim: "Device functions do not automatically join physical nets.",
      async check() {
        const [types, run] = await Promise.all([
          coreTypes(),
          plantContinuity(),
        ]);
        // S1's normally closed contact11 spans terminals 11 and 12.
        expect(
          types.get("core:pushbutton-nc").functions.contact11.terminals,
        ).toEqual(["11", "12"]);
        const [through, wired] = run.json.checks;
        expect(run.code).toBe(1);
        expect(through.status).toBe("missing-modeled-path");
        expect(through.to.netId).not.toBe(through.from.netId);
        expect(wired.status).toBe("satisfied");
        expect(wired.to.netId).toBe(wired.from.netId);
      },
    },
    {
      claim:
        'Every request has `"format": "agent-tool-request/0.1"` and `"project": "."`.',
      async check() {
        const [wrong, parent, valid] = await Promise.all([
          agent(
            "validate",
            { format: "agent-tool-request/0.2", project: "." },
            ctx.pristine.starter,
          ),
          parentValidate(),
          plantValidate(),
        ]);
        expect(wrong.report.error).toMatchObject({
          code: "A001",
          field: "/format",
          reason: "unsupported-value",
          allowed: ["agent-tool-request/0.1"],
        });
        // `project` is resolved from the working directory, so "." means
        // "run from the project root"; the parent is not a project.
        expect(parent.code).toBe(2);
        expect(parent.report.diagnostics[0]).toMatchObject({
          code: "E001",
          file: "system.json",
        });
        expect(valid.code).toBe(0);
        // A missing format or project fails A001 at its pointer.
        for (const field of ["format", "project"]) {
          const partial: Record<string, unknown> = request({});
          delete partial[field];
          const run = await agentHere(
            "validate",
            partial,
            ctx.pristine.starter,
          );
          expect(run.report.error, field).toMatchObject({
            code: "A001",
            field: `/${field}`,
            reason: "missing",
          });
        }
      },
    },
    {
      claim:
        "stdout carries the result, on success only; stderr always carries the report (diagnostics and error).",
      async check() {
        // `agent` itself requires a report on stderr and an empty stdout on
        // every failure; these add a success, an expected failure and a tool
        // failure.
        const [valid, expected, tool] = await Promise.all([
          plantValidate(),
          nameAsUid(),
          parentValidate(),
        ]);
        expect(valid.result.value.valid).toBe(true);
        expect(valid.report).toMatchObject({ error: null });
        expectPlantDiagnostics(valid.report.diagnostics);
        expect(expected.code).toBe(1);
        expect(expected.report.error.code).toBe("Q001");
        expect(tool.code).toBe(2);
        // The tool failure, and the information that it stopped every check.
        expect(tool.report).toMatchObject({
          diagnostics: [
            { code: "E001", severity: "error" },
            { code: "I208", severity: "info" },
          ],
          error: null,
        });
        // A success with a warning, malformed JSON and an unreadable request
        // through the CLI's agent command, and a usage error from the CLI.
        const starter = ctx.pristine.starter;
        const [warned, malformed, unreadable, usage] = await Promise.all([
          (async () =>
            agentHere(
              "validate",
              request({}),
              await makeProject({
                name: "unmatched-glob",
                json: {
                  "system.json": {
                    format: "electrical-system/0.1",
                    project: { name: "Unmatched glob" },
                    sources: ["missing/**/*.json"],
                  },
                },
              }),
            ))(),
          agentCommandHere("resolve", "-", starter, '{"format":'),
          agentCommandHere("validate", "not-present.json", starter),
          thermite(["agent", "resolve"], starter),
        ]);
        expect(warned.code).toBe(0);
        expect(warned.result.value.valid).toBe(true);
        expect(warned.report).toMatchObject({
          diagnostics: [{ code: "W901", severity: "warning" }],
          error: null,
        });
        for (const [run, exit] of [
          [malformed, 1],
          [unreadable, 2],
        ] as const) {
          expect(run.code, run.stderr).toBe(exit);
          expect(run.stdout).toBe("");
          expect(JSON.parse(run.stderr).format).toBe("agent-tool-report/0.1");
        }
        expect(JSON.parse(malformed.stderr).error).toMatchObject({
          code: "A001",
          reason: "invalid-json",
        });
        expect(JSON.parse(unreadable.stderr).diagnostics[0].code).toBe("E001");
        expect(usage.code).toBe(2);
        expect(usage.stdout).toBe("");
      },
    },
    {
      claim:
        "Diagnostics may carry `allowed`, `allowedCount`, `allowedLookup` (where to read the full list) and `pattern`.",
      async check() {
        const project = await freshProject("starter");
        await editJson(join(project, EQUIPMENT), (file) =>
          file.objects.push(device("K1", "core:nope")),
        );
        const [schema, unknown, types] = await Promise.all([
          schemaErrors(),
          agent("validate", request({}), project),
          coreTypes(),
        ]);
        expect(
          diagnosticAt(
            schema,
            "E014",
            EQUIPMENT,
            "/objects/2/conductors/2/usage",
          ),
        ).toMatchObject({ allowed: ["in-use", "spare"], allowedCount: 2 });

        const type = unknown.report.diagnostics.find(
          (d: { code: string }) => d.code === "E103",
        );
        expect(type, JSON.stringify(unknown.report)).toBeDefined();
        const deviceTypes = [...types.values()]
          .filter((t: any) => t.kind === "device_type")
          .map((t: any) => t.id);
        expect(type.allowedCount).toBe(deviceTypes.length);
        expect([...type.allowed].sort()).toEqual([...deviceTypes].sort());
        expect(type.allowedLookup).toEqual(expect.any(String));
        expect(type.allowedLookup).toContain("libraries/core/library.json");

        expect(
          diagnosticAt(schema, "E013", LISTED, "/objects/0/uid").pattern,
        ).toBe(ctx.uidPattern.source);
      },
    },
    {
      claim:
        "Dry-run first, review the result, then apply the same request with `dryRun: false`.",
      async check() {
        const { preview, applied, written, changes } = await guarded();
        expect(preview.result.value).toMatchObject({
          dryRun: true,
          applied: false,
        });
        expect(applied.result.value.applied).toBe(true);
        // The preview's afterIntegrity is exactly what the apply wrote.
        for (const file of preview.result.value.files)
          expect(written[file.path], file.path).toBe(file.afterIntegrity);
        expect(changes).toContainEqual(
          expect.objectContaining({ operation: "added", label: "K2" }),
        );
      },
    },
    {
      claim: "Per-file atomicity and snapshot guards apply.",
      async check() {
        // A stale second file leaves the first file unwritten too.
        const project = await copyProject(await plant(), "general-stale");
        const hashOf = async (path: string) =>
          integrity(await readFile(join(project, path)));
        const before = {
          equipment: await hashOf(EQUIPMENT),
          wires: await hashOf(WIRES),
        };
        const [stale, { applied, written }] = await Promise.all([
          agent(
            "apply-source-patch",
            request({
              patchFormat: "json-patch/0.1",
              dryRun: false,
              files: [
                {
                  path: EQUIPMENT,
                  expectedIntegrity: before.equipment,
                  operations: [
                    {
                      op: "add",
                      path: "/objects/-",
                      value: device("K2", "core:contactor-3p-1no"),
                    },
                  ],
                },
                {
                  path: WIRES,
                  expectedIntegrity: integrity(Buffer.from("stale")),
                  operations: [
                    { op: "test", path: "/objects/0/kind", value: "wire" },
                  ],
                },
              ],
            }),
            project,
          ),
          guarded(),
        ]);
        expect(stale.report.error).toMatchObject({ code: "A004", file: WIRES });
        expect(await hashOf(EQUIPMENT)).toBe(before.equipment);
        expect(await hashOf(WIRES)).toBe(before.wires);

        // The guarded workflow's two-file apply commits each file.
        expect(applied.result.value.atomicity).toBe("per-file");
        expect(applied.result.value.files).toHaveLength(2);
        for (const file of applied.result.value.files)
          expect(written[file.path], file.path).toBe(file.afterIntegrity);

        // The snapshot guard re-hashes the project just before commit and
        // fails A004 on drift; only a concurrent writer can trip it, so the
        // engine fixture changes each file between staging and precommit.
        const { claimed, PRECOMMIT_CHANGES } = await engine();
        await claimed(PRECOMMIT_CHANGES, {
          manifest: "A004 system.json, at the precommit snapshot",
          "target source": "A004 sources/a.json, at the precommit snapshot",
          "non-target source": "A004 sources/b.json, at the precommit snapshot",
        });
      },
    },
    {
      claim:
        "New files, `system.json` and libraries are ordinary file edits; list new source files in `system.json` `sources`, then validate.",
      async check() {
        const project = await plant();
        const [manifest, unlisted, valid, linked, schema] = await Promise.all([
          readJson(join(project, "system.json")),
          readJson(join(project, UNLISTED)),
          plantValidate(),
          plantContinuity(),
          schemaErrors(),
        ]);
        // Unlisted, a file is invisible: its invalid UID passes validation
        // and the patch tool refuses it.
        expect(manifest.sources).not.toContain(UNLISTED);
        expect(unlisted.objects[0].uid).not.toMatch(ctx.uidPattern);
        expect(valid.result.value.valid).toBe(true);
        expectPlantDiagnostics(valid.report.diagnostics);
        const patch = await agent(
          "apply-source-patch",
          await patchRequest(project, UNLISTED, [
            { op: "test", path: "/objects/0/designation", value: "K9" },
          ]),
          project,
        );
        expect(patch.report.error.code).toBe("A003");
        // Listed, its devices join the model and its content is validated.
        expect(manifest.sources).toContain(LISTED);
        expect(linked.json.checks[1]).toMatchObject({
          status: "satisfied",
          to: { display: "S1.11" },
        });
        diagnosticAt(schema, "E013", LISTED, "/objects/0/uid");
      },
    },
    {
      claim: "Take UIDs and keys from `inspect`, never from names.",
      async check() {
        const project = ctx.pristine.starter;
        const plc = await inspect(project, "PLC1");
        expect(plc.uid).toMatch(ctx.uidPattern);
        expect(plc.terminals.map((t: any) => t.id.terminalKey)).toContain(
          "X2.0",
        );
        expect(plc.functions.map((f: any) => f.key)).toContain("do0");
        const [byUid, byName] = await Promise.all([
          agent(
            "resolve",
            request({ target: { by: "uid", value: plc.uid } }),
            project,
          ),
          nameAsUid(),
        ]);
        expect(byUid.result.value.object.designation).toBe("PLC1");
        expect(byName.report.error).toMatchObject({
          code: "Q001",
          message: 'No project object has uid "PLC1".',
        });
      },
    },
    {
      claim:
        'Voltage checks (E300-E302) run only on nets that carry a `potential` (`{uid, kind: "potential", name, at, electrical: {nominal_voltage, voltage_type}}`).',
      async check() {
        const [semantic, schema] = await Promise.all([
          semanticErrors(),
          schemaErrors(),
        ]);
        expect(messages(semantic, "E301")).toEqual([
          'Effective voltage type "AC" is incompatible with terminal ratings at "PLC1.X1.0".',
        ]);
        expect(messages(semantic, "E302")).toEqual([
          'Effective nominal voltage 480 V is incompatible with terminal ratings at "PLC1.X1.1".',
        ]);
        expect(messages(semantic, "E300")).toEqual([
          'Potential declaration "24V-ALT" conflicts with earlier declarations on the same net in field "name".',
        ]);
        // The same 480 V into PLC2's 24 VDC inputs, with no potential or one
        // without a voltage, gets no voltage check in the same run that
        // checked PLC1: only W303 per net, and both nets listed unassessed.
        const plc2 = semantic.report.diagnostics.filter((d: any) =>
          JSON.stringify(d).includes("PLC2"),
        );
        expect(plc2.map((d: any) => [d.code, d.severity])).toEqual([
          ["W303", "warning"],
          ["W303", "warning"],
          ["W903", "warning"],
          ["I304", "info"],
        ]);
        expect(plc2[2].message).toBe(
          "PLC2: Required terminal PLC2.L+ has no connection. Required terminal PLC2.M has no connection.",
        );
        expect(plc2[3].message).toMatch(
          /\(2 nets: \["PLC2\.X1\.0, SRC1\.L3 \[net:sha256:[0-9a-f]{64}\]", "PLC2\.X1\.1, SRC2\.L1 \[net:sha256:[0-9a-f]{64}\]"\]\)/,
        );
        expect(
          diagnosticAt(schema, "E010", POTENTIALS, "/objects/0/electrical")
            .message,
        ).toBe('Missing required property "electrical".');
        expect(
          diagnosticAt(schema, "E010", POTENTIALS, "/objects/1/name").message,
        ).toBe('Missing required property "name".');
      },
    },
    {
      claim:
        "Info I304 lists rated nets left unassessed and I208 checks that errors skipped; info alone exits 0, even with `--strict`.",
      async check() {
        const [valid, semantic, project] = await Promise.all([
          plantValidate(),
          semanticErrors(),
          plant(),
        ]);
        // Default validation succeeds with the plant's exact warning/info pair;
        // strict fails for PLC2's unwired required supply, retaining both codes.
        expect(valid.code).toBe(0);
        expect(valid.result.value.valid).toBe(true);
        expectPlantDiagnostics(valid.report.diagnostics);
        const strict = await thermite(
          ["validate", ".", "--strict", "--json"],
          project,
        );
        expect(strict.code, describeRun(["validate", "--strict"], strict)).toBe(
          1,
        );
        expect(strict.stderr).toBe("");
        expectPlantDiagnostics(JSON.parse(strict.stdout));
        // The unchanged machine-demo example isolates info-only validation.
        // Keep proving strict exit 0 without suppressing the plant's warning.
        const info = await ok(
          [
            "validate",
            join(repositoryRoot, "examples/machine-demo"),
            "--strict",
            "--json",
          ],
          project,
        );
        expect(info.stderr).toBe("");
        expect(
          JSON.parse(info.stdout).map((d: any) => [d.code, d.severity]),
        ).toEqual([["I304", "info"]]);
        // The second name on +24VDC (E300) skips E301 and E302 on that net,
        // and E301 at PLC1.X1.0 skips E302 there; nothing else is skipped.
        expect(
          semantic.report.diagnostics
            .filter((d: any) => d.code === "I208")
            .map((d: any) => [d.severity, d.message]),
        ).toEqual([
          [
            "info",
            expect.stringMatching(
              /^Checks not completed: E300 potential-conflict gate: skipped E301, E302 on 1 net: \["PLC1\.L\+, PS1\.\+ \[net:sha256:[0-9a-f]{64}\]"\]; E301 voltage-type gate: skipped E302 on 1 terminal: \["PLC1\.X1\.0"\]\.$/,
            ),
          ],
        ]);
      },
    },
    {
      claim:
        'Packet: `format: "schematic-packet-request/0.1"`, optional `page`, `layout: "compact"`, `index: true`, and `views`: `schematic-view-request/0.1` (`family: "power"|"control"`) or `0.2` (loads/conductors/trace).',
      async check() {
        const project = await plant();
        const one = (view: object) => ({ format: PACKET, views: [view] });
        const failures: [object, string, string][] = [
          [
            { ...one(loads), layout: "dense" },
            "R006",
            "A packet requires format",
          ],
          [{ ...one(loads), index: "yes" }, "R006", "A packet requires format"],
          // The listed fields are the whole shape: an extra field is refused.
          [{ ...one(loads), title: "x" }, "R006", "A packet requires format"],
          [
            one({ ...loads, intent: { kind: "power" } }),
            "R001",
            "expected trace, conductors, or loads",
          ],
        ];
        const [full, conductors, ...rejectedRuns] = await Promise.all([
          plantPacket(),
          conductorSheets(),
          ...failures.map(([body]) => packet(project, body)),
        ]);
        expect(full.code, describeRun(full.args, full)).toBe(0);
        // The shared page overrides the presentation's size only.
        expect(full.json.page).toMatchObject({
          size: "letter",
          orientation: "landscape",
          widthMm: 279.4,
        });
        expect(
          full.json.sheets.map(
            (s: any) => s.view.intent ?? s.view.family ?? s.view.kind,
          ),
        ).toEqual([
          "power",
          "control",
          "loads",
          "trace",
          "wires",
          "index",
          "references",
        ]);
        expect(conductors.code, describeRun(conductors.args, conductors)).toBe(
          0,
        );
        expect(conductors.json.sheets.map((s: any) => s.view.intent)).toEqual([
          "conductors",
          "conductors",
        ]);
        failures.forEach(([, code, message], index) => {
          const run = rejectedRuns[index]!;
          expect(run.code, describeRun(run.args, run)).toBe(1);
          expect(packetError(run).code).toBe(code);
          expect(packetError(run).message).toContain(message);
        });
        // A 0.1 family outside the two, and a 0.2 view without an intent
        // object, rendered in this worker.
        const { renderHere } = await engine();
        for (const [view, message] of [
          [
            { format: VIEW_01, root: designation("M1"), family: "bogus" },
            "Invalid family: expected control or power; received 'bogus'.",
          ],
          [{ ...loads, intent: null }, "Invalid intent: expected an object."],
        ] as const) {
          const result = await renderHere(project, one(view));
          expect(result.ok, message).toBe(false);
          if (!result.ok) {
            expect(result.error.code, message).toBe("R001");
            expect(result.error.message).toContain(message);
          }
        }
      },
    },
    {
      claim:
        "Init copies `core@0.2.0` to `libraries/core`; 0.1.0 locks persist. system.json selects path/version; electrical-system.lock.json pins bytes.",
      async check() {
        const project = ctx.pristine.starter;
        expect(
          (await readJson(join(project, "system.json"))).libraries,
        ).toEqual([{ name: "core", version: "0.2.0", path: "libraries/core" }]);
        const lock = (
          await readJson(join(project, "electrical-system.lock.json"))
        ).libraries.core;
        expect(lock).toMatchObject({
          path: "libraries/core",
          resolutionKind: "local",
          version: "0.2.0",
        });
        const pinned = Object.entries(lock.files as Record<string, string>);
        expect(pinned.map(([path]) => path)).toContain(
          "types/plc-compact.json",
        );
        for (const [path, hash] of pinned)
          expect(
            integrity(await readFile(join(project, "libraries/core", path))),
            path,
          ).toBe(hash);
        await ok(["lock", ".", "--check"], project);
        const oldProject = join(repositoryRoot, "examples/motor-starter");
        const oldLock = join(oldProject, "electrical-system.lock.json");
        const before = await readFile(oldLock);
        expect((await readJson(oldLock)).libraries.core.version).toBe("0.1.0");
        await ok(["validate", oldProject], project);
        expect(await readFile(oldLock)).toEqual(before);
        // Observe the new shipped locator as well as the local init inventory.
        const shipped = await freshProject("cabinets");
        await editJson(join(shipped, "system.json"), (m) => {
          delete m.libraries[0].path;
        });
        await ok(["lock", "."], shipped);
        const compiled = JSON.parse(
          (await ok(["compile", "."], shipped)).stdout,
        );
        expect(compiled.libraries[0]).toMatchObject({
          version: "0.2.0",
          path: "ais-shipped:core@0.2.0",
          resolutionKind: "shipped",
        });
      },
    },
    {
      claim:
        "Starter PS1.L/N are required but deferred: strict fails W905; cabinets passes.",
      async check() {
        const strict = await rejected(
          ["validate", ".", "--strict"],
          ctx.pristine.starter,
          "W905",
        );
        expect(strict.stdout).toContain("W905");
        expect(strict.stdout).not.toContain("W904");
        const report = JSON.parse(
          (await ok(["diagnostics", "--json"], ctx.pristine.starter)).stdout,
        );
        for (const key of ["L", "N"]) {
          const psu = report.devices.find((d: any) => d.designation === "PS1");
          expect(psu.connections.find((c: any) => c.key === key)).toMatchObject(
            {
              required: true,
              connection: "unconnected",
              review: { status: "deferred" },
            },
          );
          expect(
            report.findings
              .filter((f: any) => f.designation === "PS1" && f.key === key)
              .map((f: any) => f.code),
          ).toEqual(["W905"]);
        }
        const cabinets = await ok(
          ["validate", ".", "--strict"],
          ctx.pristine.cabinets,
        );
        expect(cabinets.stderr).toBe("");
      },
    },
    {
      claim:
        "After edits run `thermite lock .`, then validate (E107/E108 otherwise).",
      async check() {
        // A new library file: E107, not E108.
        const added = async () => {
          const project = await freshProject("starter");
          const types = join(project, "libraries/core/types");
          const motor = await readJson(join(types, "motor-3ph.json"));
          motor.types[0].id = "core:motor-copy";
          await writeJson(join(types, "motor-copy.json"), motor);
          const run = await validate(project);
          await ok(["lock", "."], project);
          return { run, relocked: await validate(project) };
        };
        const [changed, copy] = await Promise.all([libraryChange(), added()]);
        // Changed bytes of a pinned file: E108.
        expect(changed.stale.code).toBe(1);
        expect(output(changed.stale)).toMatch(
          /plc-compact\.json:\d+:\d+ E108 Library "core" file "types\/plc-compact\.json" integrity does not match the lock/,
        );
        expect(changed.relocked.code, output(changed.relocked)).toBe(0);
        expect(copy.run.code).toBe(1);
        expect(output(copy.run)).toContain(
          'E107 Library "core" file set differs: added ["types/motor-copy.json"]',
        );
        expect(output(copy.run)).not.toContain("E108");
        expect(copy.relocked.code, output(copy.relocked)).toBe(0);
      },
    },
    {
      claim:
        "Invent no pins/ratings; keep manufacturer document/revision and review notes. See `thermite guide libraries` for optional-library limits.",
      async check() {
        const topic = (await ok(["guide", "libraries"], ctx.work)).stdout;
        for (const name of await readdir(join(repositoryRoot, "libraries"))) {
          if (
            !(await readJson(
              join(repositoryRoot, "libraries", name, "library.json"),
            ).catch(() => null))
          )
            continue;
          expect(topic).toContain(`| \`${name}\` | No |`);
        }
        expect(topic).toContain("None of the repository's optional");
        const library = join(repositoryRoot, "libraries/siemens-pilot");
        const manifest = await readJson(join(library, "library.json"));
        noteJson(manifest);
        expect(manifest.name).toBe("siemens-pilot");
        const types = (
          await Promise.all(
            (await readdir(join(library, "types"))).map(
              async (name) =>
                (await readJson(join(library, "types", name))).types,
            ),
          )
        ).flat();
        expect(types.length).toBeGreaterThan(0);
        for (const type of types) {
          expect(type.catalog.document, type.id).toMatchObject({
            url: expect.stringMatching(/^https:\/\//),
            title: expect.any(String),
            revision: expect.any(String),
            pages: expect.any(String),
          });
          expect(type.catalog.modelingNotes.length, type.id).toBeGreaterThan(0);
        }
        expect(
          types.some((t: any) =>
            t.catalog.modelingNotes.some((note: string) =>
              /exclude/i.test(note),
            ),
          ),
        ).toBe(true);
        for (const project of Object.values(ctx.pristine)) {
          expect(await readdir(join(project, "libraries"))).toEqual(["core"]);
          expect(
            (await readJson(join(project, "system.json"))).libraries.map(
              (l: any) => l.name,
            ),
          ).toEqual(["core"]);
        }
      },
    },
    {
      claim: "Cable `fromLocation` / `toLocation` name end A / end B.",
      async check() {
        const [cable, { csv }] = await Promise.all([
          pristineCable(),
          tb2Cables(),
        ]);
        expect(cable).toMatchObject({
          fromLocation: "CONTROL CABINET",
          toLocation: "FIELD CABINET",
        });
        const connected = cable.cores.filter(
          (c: any) => c.status === "connected",
        );
        expect(connected).toHaveLength(2);
        for (const core of connected)
          expect(
            core.endpoints.map((e: any) => e.location),
            core.id,
          ).toEqual([cable.fromLocation, cable.toLocation]);
        expect(csv).toContain('"End A location","End B location"');
        expect(csv).toContain(
          '"CBL1","Shielded two-pair instrumentation cable","CONTROL CABINET","FIELD CABINET"',
        );
      },
    },
    {
      claim: "Conductor `endpoints` has exactly two slots, ordered A then B.",
      async check() {
        const [schema, cable] = await Promise.all([
          schemaErrors(),
          fixtureCable(),
        ]);
        expect(
          diagnosticAt(
            schema,
            "E015",
            EQUIPMENT,
            "/objects/2/conductors/0/endpoints",
          ).message,
        ).toBe("Array has more items than allowed.");
        expect(
          diagnosticAt(
            schema,
            "E015",
            EQUIPMENT,
            "/objects/2/conductors/1/endpoints",
          ).message,
        ).toBe("Array has fewer items than allowed.");
        // The fixture authors CBL1 1+ from TB2 to TB1; that order is kept.
        expect(cable.endOrder).toBe("authored");
        expect(coreDisplays(cable.cores[0])).toEqual(["TB2.1", "TB1.1"]);
      },
    },
    {
      claim: "`usage` is `in-use` or `spare`.",
      async check() {
        expect(
          diagnosticAt(
            await schemaErrors(),
            "E014",
            EQUIPMENT,
            "/objects/2/conductors/2/usage",
          ).message,
        ).toBe('Value is not one of the allowed values: ["in-use", "spare"].');
      },
    },
    {
      claim: "Only an explicitly spare core can have a null endpoint.",
      async check() {
        const [schema, wiresReport] = await Promise.all([
          schemaErrors(),
          tb2Wires(),
        ]);
        // CBL5: no usage, in-use with one null end, in-use with two.
        for (const pointer of [
          "/objects/3/conductors/0/endpoints/0",
          "/objects/3/conductors/1/endpoints/1",
          "/objects/3/conductors/2/endpoints/0",
        ])
          expect(
            diagnosticAt(schema, "E015", EQUIPMENT, pointer).message,
            pointer,
          ).toBe(
            'An unterminated cable endpoint requires explicit usage "spare".',
          );
        // The validated fixture's CBL2 is a spare with one null end.
        expect(wiresReport.csv).toContain(
          '"CBL2/1+","Unterminated","TB2.4","black / 18AWG","spare; partially-terminated"',
        );
      },
    },
    {
      claim:
        "Two real endpoints remain connected even for a spare; one real endpoint still occupies its terminal.",
      async check() {
        const [cable, fixture] = await Promise.all([fixtureCable(), cables()]);
        const spare = cable.cores.find((c: any) => c.id === "2+");
        expect(spare).toMatchObject({ usage: "spare", status: "connected" });
        expect(spare.netId).toEqual(expect.any(String));
        expect(coreDisplays(spare)).toEqual(["TB1.3", "TB2.3"]);

        // PLC1.X1.0 is exclusive and wired from TB1.5. The fixture validates
        // with CBL3's spare unterminated; landing one end there is one
        // conductor too many.
        const project = await copyProject(fixture, "general-landing");
        await editJson(join(project, EQUIPMENT), (file) => {
          const core = byDesignation(file, "CBL3").conductors[0];
          expect(core.endpoints).toEqual([null, null]);
          core.endpoints = [end("PLC1.X1.0"), null];
        });
        await rejected(
          ["validate", "."],
          project,
          "E201",
          'Terminal "PLC1.X1.0" has connection policy "exclusive", but cable "CBL3" conductor "1+" is an excess direct conductive assignment',
        );
      },
    },
    {
      claim: "An omitted core is unassigned, never implicitly spare.",
      async check() {
        const [cable, wiresReport] = await Promise.all([
          fixtureCable(),
          tb2Wires(),
        ]);
        // The fixture omits CBL1 2-.
        expect(cable.cores.find((c: any) => c.id === "2-")).toMatchObject({
          usage: "unassigned",
          status: "unassigned",
        });
        expect(cable.counts).toEqual({
          total: 4,
          connected: 3,
          spare: 1,
          unassigned: 1,
        });
        expect(wiresReport.csv).toContain(
          '"CBL1/2-","Unterminated","Unterminated","green / 18AWG","unassigned; unassigned"',
        );
      },
    },
    {
      claim:
        "A core without usage is unspecified; a cable with no usage or locations uses canonical end order.",
      async check() {
        const [cable, wiresReport, sheets] = await Promise.all([
          fixtureCable(),
          tb2Wires(),
          conductorSheets(),
        ]);
        // CBL1 1- has no usage.
        expect(cable.cores[1].usage).toBe("unspecified");
        expect(cable.endOrder).toBe("authored");
        expect(wiresReport.csv).toContain(
          '"CBL1/1-","TB1.2","TB2.2","white / 18AWG","unspecified; connected"',
        );
        // Legacy CBL4 authors 1+ from TB2.6 to TB1.6 and 1- from TB1.7 to
        // TB2.7; canonical order lists both from the same end. Which end
        // comes first follows the template's random UIDs.
        const row = (core: string) =>
          wiresReport.csv
            .split(/\r?\n/)
            .find((line: string) => line.startsWith(`"CBL4/${core}",`))!
            .split(",")
            .map((cell: string) => cell.replace(/"/g, ""));
        const [plus, minus] = [row("1+"), row("1-")];
        expect([plus[1], plus[2]].sort()).toEqual(["TB1.6", "TB2.6"]);
        expect([minus[1], minus[2]].sort()).toEqual(["TB1.7", "TB2.7"]);
        const strips = (r: string[]) =>
          [r[1], r[2]].map((t) => t!.split(".")[0]);
        expect(strips(plus)).toEqual(strips(minus));
        for (const r of [plus, minus])
          expect(r.slice(3)).toEqual([
            expect.stringMatching(/ \/ 18AWG$/),
            "unspecified; connected",
          ]);
        expect(wiresReport.csv).toContain(
          '"CBL4/2+","Unterminated","Unterminated","red / 18AWG","unassigned; unassigned"',
        );
        const [authored, legacy] = sheets.json.sheets;
        expect(authored.svg).toContain(
          "End A/B follows authored endpoint order.",
        );
        expect(legacy.svg).toContain(
          "Legacy endpoints shown in canonical order.",
        );
      },
    },
    {
      claim: "Shield construction never implies a shield bond.",
      async check() {
        const [cable, { csv }] = await Promise.all([
          pristineCable(),
          tb2Cables(),
        ]);
        expect(cable.shield).toBe(true);
        expect(cable.cores.map((c: any) => c.id)).toEqual([
          "1+",
          "1-",
          "2+",
          "2-",
        ]);
        expect(csv).toMatch(/"CBL1",.*"Shielded; bonds not modeled"/);
      },
    },
    {
      claim: "`--device PLC1` scopes `terminals`, `io` and `io-ports`.",
      async check() {
        const [cabinetsDir, plantDir, connectors] = await Promise.all([
          cables(),
          plant(),
          connectorIo(),
        ]);
        const [terminals, plcTerminals, io, ioPlc1, plcPorts, r1Ports] =
          await Promise.all([
            report(cabinetsDir, ["terminals"]),
            report(cabinetsDir, ["terminals", "--device", "PLC1"]),
            plantIo(),
            report(plantDir, ["io", "--device", "PLC1"]),
            report(connectors, ["io-ports", "--device", "PLC1"]),
            report(connectors, ["io-ports", "--device", "R1"]),
          ]);
        // Unscoped, `terminals` lists the terminal blocks' 16 terminals.
        expect(rows(terminals.csv)).toHaveLength(16);
        for (const row of rows(terminals.csv))
          expect(row).toMatch(/^"TB[12]",/);
        expect(rows(plcTerminals.csv)).toHaveLength(6);
        for (const row of rows(plcTerminals.csv))
          expect(row).toMatch(/^"PLC1",/);
        expect(io.csv).toContain('"PLC2"');
        expect(ioPlc1.csv).toContain('"PLC1"');
        expect(ioPlc1.csv).not.toContain('"PLC2"');
        // Each io-ports row starts with its module and location. R1's ports
        // use PLC1's address space but belong to R1, so `--device PLC1`
        // drops them.
        const r1Rows = (csv: string) =>
          (csv.match(/"R1\nMain machine"/g) ?? []).length;
        expect(r1Rows(r1Ports.csv)).toBe(4);
        expect(r1Ports.csv).toContain('"PLC1\n%IW64"');
        expect(r1Rows(plcPorts.csv)).toBe(0);
      },
    },
    {
      claim:
        "Filters keep whole incident rows, peer details, cable inventories and endpoint-free records; CSV selection metadata is on stderr, packets expose `documentationSelections`.",
      async check() {
        const [wiresReport, cablesReport, full, objects] = await Promise.all([
          tb2Wires(),
          tb2Cables(),
          plantPacket(),
          cables().then(sourceObjects),
        ]);
        const uidOf = (name: string) =>
          byDesignation({ objects }, name).uid as string;
        // Rows incident to TB2 keep their TB1 ends; TB1 is a boundary peer.
        expect(wiresReport.csv).toContain(
          '"CBL1/1+","TB2.1","TB1.1","black / 18AWG","in-use; connected"',
        );
        expect(wiresReport.selection).toMatchObject({
          format: "documentation-selection/0.1",
          boundaryDeviceUids: [uidOf("TB1")],
        });
        // The wire TB1.5 -> PLC1.X1.0 does not touch TB2.
        expect(wiresReport.csv).not.toContain("PLC1.X1.0");
        expect(wiresReport.selection.omittedRowKeys).toHaveLength(1);
        // Retained cables keep every core and their whole inventory.
        expect(wiresReport.csv).toContain('"CBL1/2-","Unterminated"');
        expect(cablesReport.csv).toContain(
          '"CBL1","Shielded two-pair instrumentation cable","CONTROL CABINET","FIELD CABINET","4","3","1","1"',
        );
        // CBL3 has no endpoint at all, so no filter can scope it.
        expect(cablesReport.csv).toContain('"CBL3"');
        expect(cablesReport.selection.unscopedRowKeys).toEqual([uidOf("CBL3")]);
        expect(full.json.documentationSelections).toEqual([
          expect.objectContaining({ view: 5, filter: plcOnly }),
        ]);
      },
    },
    {
      claim:
        'With `index: true`, `references: {"appearances": "drawings", "filter": {...}}` scopes only the reference index; `references: false` omits reference pages.',
      async check() {
        const project = await plant();
        const [full, scoped, off, noIndex] = await Promise.all([
          plantPacket(),
          packet(project, {
            ...PLANT_PACKET,
            references: {
              appearances: "drawings",
              filter: { devices: ["PLC1"] },
            },
          }),
          packet(project, { ...PLANT_PACKET, references: false }),
          packet(project, {
            format: PACKET,
            references: false,
            views: [loads],
          }),
        ]);
        const kinds = (run: any) =>
          run.json.sheets.map(
            (s: any) => s.view.intent ?? s.view.family ?? s.view.kind,
          );
        const drawings = ["power", "control", "loads", "trace", "wires"];
        expect(kinds(full)).toEqual([...drawings, "index", "references"]);
        expect(kinds(scoped)).toEqual(kinds(full));
        // Every sheet but the reference index is unchanged.
        full.json.sheets.slice(0, -1).forEach((sheet: any, index: number) => {
          expect(scoped.json.sheets[index].svg, kinds(full)[index]).toBe(
            sheet.svg,
          );
        });
        expect(scoped.json.referenceSelection).toMatchObject({
          enabled: true,
          appearances: "drawings",
        });
        expect(scoped.json.sheets.at(-1).svg).toMatch(
          /Filtered reference index: \d+ of \d+ device\/function groups retained/,
        );
        expect(kinds(off)).toEqual([...drawings, "index"]);
        expect(off.json.referenceSelection.enabled).toBe(false);
        expect(off.json.sheets.at(-1).svg).toContain(
          "Device/function reference index omitted by request",
        );
        expect(noIndex.code).toBe(1);
        expect(packetError(noIndex)).toMatchObject({ code: "R006" });
        expect(packetError(noIndex).message).toContain(
          "Reference options require index: true",
        );
      },
    },
    {
      claim:
        "PLC addresses and spare usage live in the device's `io` object; never infer spare from a missing connection.",
      async check() {
        const { csv } = await plantIo();
        // PLC1's io gives di0 an address and signal and di1 spare usage.
        expect(csv).toContain(
          '"PLC1","di0","input","PLC1","%I0.0","Start","PLC1.X1.0","LS1.14","in-use; terminated"',
        );
        expect(csv).toContain(
          '"PLC1","di1","input","PLC1","","","PLC1.X1.1","None","spare; unconnected"',
        );
        // do1 has no io entry and no connection: unspecified, not spare.
        expect(csv).toContain(
          '"PLC1","do1","output","PLC1","","","PLC1.X2.1","None","Unspecified; unconnected"',
        );
        expect(csv.match(/spare/g)).toHaveLength(1);
      },
    },
    {
      claim:
        "E202 checks channel keys and duplicate addresses (case-insensitive), not PLC byte/word overlap or programming validity.",
      async check() {
        const [semantic, valid, objects] = await Promise.all([
          semanticErrors(),
          plantValidate(),
          plant().then(sourceObjects),
        ]);
        expect(messages(semantic, "E202").sort()).toEqual(
          [
            "Address %i0.0 in PLC6 is assigned to both PLC6.di0 and PLC6.di1.",
            "PLC3.X1.0 is not a declared I/O channel.",
            "PLC4.di9 is not a declared I/O channel.",
            "PLC5.supply is not a declared I/O channel.",
          ].sort(),
        );
        // The plant's PLC2 overlaps %IB0, %I0.0 and %IW0, gives an output an
        // input address and has an invalid one, without address findings.
        // Only its unwired supply and the unassessed coil net are reported.
        expect(byDesignation({ objects }, "PLC2").io).toEqual(PLC2_IO);
        expectPlantDiagnostics(valid.report.diagnostics);
      },
    },
    {
      claim:
        "Snapshot before a change; review after the guarded workflow, then regenerate the packet.",
      async check() {
        const { snapshot, changes, coil, html } = await guarded();
        expect((await readJson(snapshot)).format).toBe("thermite-snapshot/0.1");
        expect(
          changes.map((c) => `${c.kind}:${c.operation}:${c.label}`).sort(),
        ).toEqual(["device:added:K2", `wire:added:${coil.designation}`]);
        expect(html).toContain("K2");
      },
    },
    {
      claim:
        "Semantic review does not replace source/lock/presentation review or engineering judgment.",
      async check() {
        // Presentation edits, reformatted source and the relock are
        // invisible; the library change shows only as the type field.
        const { changes } = await libraryChange();
        expect(changes).toEqual([
          expect.objectContaining({
            kind: "type",
            id: "core:plc-compact",
            operation: "changed",
            fields: ["/description"],
          }),
        ]);
      },
    },
    {
      claim: "UIDs identify devices; page numbers may change.",
      async check() {
        const [project, before] = await Promise.all([
          plant().then((p) => copyProject(p, "general-uids")),
          plantSnapshot(),
        ]);
        const plc2Wires = (await sourceObjects(project))
          .filter(
            (o: any) =>
              o.kind === "wire" &&
              o.endpoints.some((e: any) => e.device === "PLC2"),
          )
          .map((o: any) => o.designation);
        expect(plc2Wires).toHaveLength(1); // S1.12 to PLC2.X1.0; supply is unwired.
        let plcUid = "";
        // Rename PLC1 to PLC9 (and its wire ends), and give PLC2 a new UID.
        await editJson(join(project, EQUIPMENT), (file) => {
          const plc = byDesignation(file, "PLC1");
          plcUid = plc.uid;
          plc.designation = "PLC9";
          byDesignation(file, "PLC2").uid = randomUUID();
        });
        await editJson(join(project, WIRES), (file) => {
          for (const o of file.objects)
            for (const e of o.endpoints)
              if (e.device === "PLC1") e.device = "PLC9";
        });
        const changes = await review(project, before);
        expect(
          changes.map((c) => `${c.kind}:${c.operation}:${c.label}`).sort(),
        ).toEqual(
          [
            "device:added:PLC2",
            "device:changed:PLC9",
            "device:removed:PLC2",
            ...plc2Wires.map((label: string) => `wire:changed:${label}`),
          ].sort(),
        );
        expect(changes).toContainEqual(
          expect.objectContaining({
            id: plcUid,
            operation: "changed",
            fields: ["/designation"],
          }),
        );
      },
    },
    {
      claim:
        "`thermite watch --input packet.json -o drawings/packet.html` (macOS) checks declared inputs once per second and preserves the previous packet on failure.",
      async check() {
        const project = await freshProject("starter");
        const bom = {
          format: PACKET,
          views: [{ format: DOCUMENT_VIEW, kind: "bom" }],
        };
        await writeJson(join(project, "packet.json"), bom);
        await mkdir(join(project, "drawings"));
        // Both flags are required: an output file, and a request file.
        await Promise.all(
          (
            [
              [["--input", "packet.json"], "Watch requires an output file."],
              [
                ["--input", "-", "-o", "drawings/packet.html"],
                "Watch requires a request file, not stdin.",
              ],
            ] as const
          ).map(([args, message]) =>
            rejected(["watch", ...args], project, "T001", message, 2),
          ),
        );

        const child = spawn(
          process.execPath,
          [
            entry,
            "watch",
            "--input",
            "packet.json",
            "-o",
            "drawings/packet.html",
          ],
          { cwd: project },
        );
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk: Buffer) => (stdout += chunk));
        child.stderr.on("data", (chunk: Buffer) => (stderr += chunk));
        const closed = new Promise((done) => child.on("close", done));
        const builds = () => (stdout.match(/^Wrote /gm) ?? []).length;
        // The deterministic alpha-watch test separately pins both 1000 ms
        // schedules. Keep the original 2500 ms bound on macOS, the guide's
        // scoped platform. Windows exceeded it in run 42038869517; Ubuntu
        // exceeded it in run 42072555353 (7552 ms whole fact, one Wrote).
        // Their poll-plus-render work gets machine-demo's existing 15 s bound.
        const changeCeiling = process.platform === "darwin" ? 2500 : 15000;
        const until = (done: () => boolean, ceiling = 4000): Promise<void> =>
          new Promise((resolve, reject) => {
            const finish = (error?: Error) => {
              clearTimeout(timer);
              child.stdout.off("data", check);
              child.stderr.off("data", check);
              child.off("close", ended);
              if (error) reject(error);
              else resolve();
            };
            const check = () => {
              if (done()) finish();
            };
            const ended = () => finish(new Error(stdout + stderr));
            const timer = setTimeout(ended, ceiling);
            child.stdout.on("data", check);
            child.stderr.on("data", check);
            child.once("close", ended);
            if (child.exitCode !== null || child.signalCode !== null) ended();
            else check();
          });
        const html = join(project, "drawings/packet.html");
        try {
          await until(() => builds() === 1);
          expect(builds()).toBe(1);
          expect(stderr).toContain(
            "Checking declared source, libraries and the request every second",
          );
          // An undeclared file is not an input.
          await writeJson(join(project, "notes.json"), {});
          await sleep(1600);
          expect(builds()).toBe(1);
          await editJson(join(project, EQUIPMENT), (file) => {
            file.objects[0].description = "Edited supply";
          });
          await until(() => builds() === 2, changeCeiling);
          expect(builds()).toBe(2);
          const kept = integrity(await readFile(html));
          // A broken request fails the build and keeps the last packet.
          await writeJson(join(project, "packet.json"), { ...bom, views: [] });
          await until(() => stderr.includes('"R006"'), changeCeiling);
          expect(stderr).toContain('"R006"');
          expect(builds()).toBe(2);
          expect(integrity(await readFile(html))).toBe(kept);
        } finally {
          child.kill("SIGKILL");
          await closed;
          record(stdout + stderr);
        }
      },
    },
    {
      claim:
        "`.pdf` is direct vector PDF with physical paper dimensions and fonts.",
      async check() {
        const pdf = await mathPdf();
        expect(pdf.startsWith("%PDF-")).toBe(true);
        // A4 portrait: 210 x 297 mm at 72 pt/in.
        expect(pdf).toContain("/MediaBox [0 0 595.275591 841.889764]");
        expect(pdf).toMatch(/\/BaseFont \/[A-Z]{6}\+NotoSans-Regular/);
        expect(pdf).toContain("/FontFile2");
        expect(pdf).not.toContain("/Subtype /Image");
        // The starter presentation's tabloid landscape, 17 x 11 in.
        const tabloid = join(await scratch("tabloid"), "loads.pdf");
        await ok(
          ["view", "PS1", "--loads", "-o", tabloid],
          ctx.pristine.starter,
        );
        expect(await readFile(tabloid, "latin1")).toContain(
          "/MediaBox [0 0 1224 792]",
        );
      },
    },
    {
      claim:
        "Unsupported PDF glyphs fail explicitly; use supported labels or SVG/HTML.",
      async check() {
        const project = await freshProject("starter");
        await editJson(join(project, "presentation.json"), (presentation) => {
          presentation.titleBlock.lines = ["Pump 電"];
        });
        const view = (name: string) => ["view", "PS1", "--loads", "-o", name];
        const [failed, , math] = await Promise.all([
          rejected(view("sheet.pdf"), project, "T001", undefined, 2),
          ok(view("sheet.html"), project),
          // Symbols covered by the bundled fallback font are supported.
          mathPdf(),
        ]);
        expect(lastJson(failed.stderr).error.message).toBe(
          "PDF font does not support U+96FB (letter) on sheet 1. Use SVG/HTML or a supported label.",
        );
        expect(existsSync(join(project, "sheet.pdf"))).toBe(false);
        expect(await readFile(join(project, "sheet.html"), "utf8")).toContain(
          "電",
        );
        expect(math).toMatch(/\/BaseFont \/[A-Z]{6}\+NotoSansMath-Regular/);
      },
    },
  ],
  unexecuted: new Map([
    [
      "Keep streams separate.",
      "Advice to callers; the stream split itself is checked with the previous sentence.",
    ],
    [
      "See `thermite guide report-filtering`.",
      "Offline topic pointer; the pointer test executes it.",
    ],
  ]),
};
export default module;
