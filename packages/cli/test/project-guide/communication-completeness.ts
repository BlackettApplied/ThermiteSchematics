// Facts for the guide's communication connections, connection completeness
// and communication cable record sections.
import { randomUUID } from "node:crypto";
import { cp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import {
  copyProject,
  ctx,
  describeRun,
  editJson,
  lockAndValidate,
  noteJson,
  ok,
  once,
  packet,
  readJson,
  rejected,
  repositoryRoot,
  scratch,
  sharedProject,
  thermite,
  writeJson,
  type FactModule,
} from "./harness.js";

const schema = (name: string) =>
  readJson(join(repositoryRoot, `packages/schema/schemas/${name}.schema.json`));
/** Engine fixtures and shared case tables, loaded once a check needs them. */
const engine = () => import("./engine-cases.js");

/** RFC 4180 rows; cells may hold quoted newlines. */
function csv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") cell += ch;
  }
  if (cell !== "" || row.length) rows.push([...row, cell]);
  return rows;
}
const readCsv = async (path: string) => csv(await readFile(path, "utf8"));
/** An absolute output path outside every shared project. */
const outside = async (file: string) =>
  join(await scratch("communication-completeness-out"), file);
const byDesignation = (source: any, name: string) =>
  source.objects.find((o: any) => o.designation === name);

type Edits = {
  readonly source?: (source: any) => void;
  readonly types?: (types: any) => void;
};
/** A writable copy of `shared` with `edits` applied to its source or library. */
async function editedCopy(shared: string, typesFile: string, edits: Edits) {
  const project = await copyProject(shared, "communication-completeness");
  if (edits.source) await editJson(join(project, "source.json"), edits.source);
  if (edits.types) await editJson(join(project, typesFile), edits.types);
  return project;
}

// ---------------------------------------------------------------------------
// Communication base, built once:
//   PLC1 -NET1- RIO1 -NET2- SW1 -NET3- HMI1 (Ethernet), PLC1 -NET4- RIO1 (NRG bus).
// The cable records cover every optional field once: NET1 has all three,
// NET2 has no length, NET4 sits on the 0.001 m minimum and NET3 has none.
// NET4's protocol is invented and marked verified, and the node type has a
// terminal named like its ETH1 port.

function communicationJson() {
  const device = (
    designation: string,
    extra: Record<string, unknown> = {},
  ) => ({
    uid: randomUUID(),
    kind: "device",
    designation,
    type: "test:node",
    location: "Cabinet",
    ...extra,
  });
  const link = (
    designation: string,
    [from, fromPort]: [string, string],
    [to, toPort]: [string, string],
    connection: Record<string, unknown> = {},
  ) => ({
    uid: randomUUID(),
    kind: "relation",
    designation,
    relation: "associated_with",
    from: { device: from },
    to: { device: to },
    connection: {
      fromPort,
      toPort,
      medium: "ethernet",
      protocol: "PROFINET",
      ...connection,
    },
  });
  return {
    "system.json": {
      format: "electrical-system/0.1",
      project: { name: "Communication" },
      sources: ["source.json"],
      libraries: [{ name: "test", version: "1.0.0", path: "lib" }],
    },
    "lib/library.json": {
      name: "test",
      version: "1.0.0",
      sources: ["types.json"],
    },
    "lib/types.json": {
      types: [
        {
          kind: "device_type",
          id: "test:node",
          description: "Communication node",
          terminals: { P: {}, M: {}, ETH1: {} },
          functions: {},
          ports: {
            ETH1: { medium: "ethernet", connector: "RJ45" },
            ETH2: { medium: "ethernet", connector: "RJ45" },
            BUS: { medium: "nrg-bus", connector: "Proprietary" },
          },
        },
      ],
    },
    "source.json": {
      objects: [
        device("PLC1", {
          // A reviewed-unused port must still not be reported as spare.
          connectionReview: {
            ports: {
              ETH2: { status: "intentionally-unused", reason: "Spare" },
            },
          },
        }),
        device("RIO1"),
        device("SW1"),
        device("HMI1"),
        link("NET1", ["PLC1", "ETH1"], ["RIO1", "ETH1"], {
          status: "planned",
          cable: {
            specification: "Cat6A S/FTP",
            lengthM: 12.5,
            route: "Tray T1",
          },
        }),
        link("NET2", ["RIO1", "ETH2"], ["SW1", "ETH1"], {
          status: "verified",
          cable: { specification: "Cat5e", route: "Conduit C7" },
        }),
        link("NET3", ["SW1", "ETH2"], ["HMI1", "ETH1"]),
        link("NET4", ["PLC1", "BUS"], ["RIO1", "BUS"], {
          medium: "nrg-bus",
          protocol: "NotARealProtocol",
          status: "verified",
          cable: { specification: "Bus cable", lengthM: 0.001 },
        }),
      ],
    },
  };
}
/** Locked and validated once; every fact that uses it starts from a valid base. */
const communication = () =>
  sharedProject("communication:base", async (project) => {
    for (const [file, value] of Object.entries(communicationJson()))
      await writeJson(join(project, file), value);
    await lockAndValidate(project);
  });
const communicationSource = () =>
  once("communication:source", async () =>
    readJson(join(await communication(), "source.json")),
  );
const communicationCopy = async (edits: Edits) =>
  editedCopy(await communication(), "lib/types.json", edits);
const rio1Neighbors = () =>
  once("communication:neighbors", async () =>
    JSON.parse(
      (await ok(["neighbors", "RIO1", "--json"], await communication())).stdout,
    ),
  );
const networkReport = () =>
  once("communication:network", async () => {
    const file = await outside("network.csv");
    await ok(["report", "network", "-o", file], await communication());
    const [header, ...rows] = await readCsv(file);
    return { header: header!, rows };
  });
const networkCell = (rows: string[][], link: string) =>
  rows.find((r) => r[0] === link)![1];

// ---------------------------------------------------------------------------
// Completeness base: the repository's completeness fixture, copied once.

const FIXTURE = "packages/cli/fixtures/completeness";
const audit = () =>
  sharedProject("completeness:base", async (project) => {
    for (const entry of [
      "system.json",
      "source.json",
      "library",
      "electrical-system.lock.json",
    ])
      await cp(join(repositoryRoot, FIXTURE, entry), join(project, entry), {
        recursive: true,
      });
    for (const file of [
      "system.json",
      "source.json",
      "library/library.json",
      "library/types.json",
      "electrical-system.lock.json",
    ])
      noteJson(await readJson(join(project, file)));
  });
const auditCopy = async (edits: Edits) =>
  editedCopy(await audit(), "library/types.json", edits);
/** `diagnostics --json`: the report from stdout, compiler output from stderr. */
async function diagnostics(project: string, ...args: string[]) {
  const run = await ok(["diagnostics", "--json", ...args], project);
  return { report: JSON.parse(run.stdout), compiler: JSON.parse(run.stderr) };
}
const auditReport = () =>
  once("completeness:report", async () => diagnostics(await audit()));
const auditValidate = () =>
  once("completeness:validate", async () => {
    const run = await ok(["validate", "."], await audit());
    return run.stdout + run.stderr;
  });
/** The guide's own focus commands, in text mode. */
const auditFocus = (flag: "--device" | "--location", value: string) =>
  once(`completeness:focus:${flag}`, async () =>
    ok(["diagnostics", flag, value], await audit()),
  );
/**
 * Library edits, one per point: HMI1.ETH1 becomes library-required (its
 * project review removed, so ETH2 is a plain optional port), and a declared
 * connector port X1 carries a deferred review.
 */
const libraryEdits = () =>
  once("completeness:library-edits", async () => {
    const project = await auditCopy({
      source: (s) =>
        (byDesignation(s, "HMI1").connectionReview = {
          connectorPorts: {
            X1: { status: "deferred", reason: "Power cordset pending." },
          },
        }),
      types: (t) => {
        t.types[2].ports.ETH1.required = true;
        t.types[2].connectorPorts = { X1: { connector: "M12" } };
      },
    });
    await ok(["lock", "."], project);
    return (await diagnostics(project)).report;
  });
/**
 * Rewiring, one change per point: CB1/1's loose far end lands on D2.SP, which
 * completes D1.N and contradicts D2.SP's unused review, and a new spare core
 * CB2/1 is left single-ended on the optional D1.SP.
 */
const rewired = () =>
  once("completeness:rewired", async () => {
    const project = await auditCopy({
      source: (s) => {
        byDesignation(s, "CB1").conductors[0].endpoints[1] = {
          device: "D2",
          terminal: "SP",
        };
        s.objects.push({
          kind: "cable",
          uid: randomUUID(),
          designation: "CB2",
          type: "audit:pair",
          conductors: [
            {
              id: "1",
              usage: "spare",
              endpoints: [{ device: "D1", terminal: "SP" }, null],
            },
          ],
        });
      },
    });
    return (await diagnostics(project)).report;
  });
const point = (report: any, designation: string, key: string) =>
  report.devices
    .find((d: any) => d.designation === designation)
    .connections.find((c: any) => c.key === key);
const findings = (
  report: any,
  code: string,
  designation: string,
  key?: string,
): any[] =>
  report.findings.filter(
    (f: any) =>
      f.code === code &&
      f.designation === designation &&
      (key === undefined || f.key === key),
  );

const module: FactModule = {
  facts: [
    {
      claim:
        'Types may declare `ports` with `medium: "ethernet"|"nrg-bus"` and a `connector`.',
      async check() {
        const port = (await schema("device-type")).properties.ports
          .patternProperties["^.+$"];
        expect(port.required).toEqual(["medium", "connector"]);
        expect(port.properties.medium.enum).toEqual(["ethernet", "nrg-bus"]);
        // The validated base declares both media and links its NRG bus ports.
        expect(
          byDesignation(await communicationSource(), "NET4").connection.medium,
        ).toBe("nrg-bus");
        await rejected(
          ["lock", "."],
          await communicationCopy({
            types: (t) => delete t.types[0].ports.ETH2.connector,
          }),
          "E010",
          'Missing required property "connector"',
        );
      },
    },
    {
      claim:
        'An `associated_with` relation can carry `connection` with `fromPort`, `toPort`, `medium`, `protocol`, and optional `status: "planned"|"verified"`.',
      async check() {
        const connection = (await schema("relation")).properties.connection;
        expect(connection.required).toEqual([
          "fromPort",
          "toPort",
          "medium",
          "protocol",
        ]);
        expect(connection.properties.medium.enum).toEqual([
          "ethernet",
          "nrg-bus",
        ]);
        expect(connection.properties.status.enum).toEqual([
          "planned",
          "verified",
        ]);
        // The validated base uses planned, verified and no status at all.
        const source = await communicationSource();
        expect(
          ["NET1", "NET2", "NET3"].map(
            (n) => byDesignation(source, n).connection.status,
          ),
        ).toEqual(["planned", "verified", undefined]);
        await rejected(
          ["validate", "."],
          await communicationCopy({
            source: (s) =>
              (byDesignation(s, "NET1").connection.status = "live"),
          }),
          "E014",
          'Value is not one of the allowed values: ["planned", "verified"]',
        );
        // A connection on another verb fails E204, on the engine's fixture.
        const { claimed, CONNECTION_FAULTS } = await engine();
        await claimed(CONNECTION_FAULTS, { verb: "E204" });
      },
    },
    {
      claim: "E204 checks declared ports, media and exclusive port occupancy.",
      async check() {
        // One fault per relation: each E204 keeps its own source pointer.
        const project = await communicationCopy({
          source: (s) => {
            byDesignation(s, "NET3").connection.toPort = "ETH9";
            byDesignation(s, "NET4").connection.fromPort = "ETH2";
            byDesignation(s, "NET2").connection.fromPort = "ETH1";
          },
        });
        const run = await rejected(
          ["validate", "."],
          project,
          "E204",
          "E204 HMI1.ETH9 is not a declared communication port.",
        );
        const output = run.stdout + run.stderr;
        expect(output).toContain("E204 PLC1.ETH2 uses ethernet, not nrg-bus.");
        expect(output).toMatch(
          /E204 RIO1\.ETH1 is occupied by both (NET1 and NET2|NET2 and NET1)\./,
        );
      },
    },
    {
      claim:
        "These links never join nets; protocol and status are author claims, implying no pinouts, shielding, PoE or live communications.",
      async check() {
        const around = await rio1Neighbors();
        expect(around.conductive).toEqual([]);
        expect(
          around.relations.map((r: any) => r.relation.designation).sort(),
        ).toEqual(["NET1", "NET2", "NET4"]);
        // NET1 links PLC1.ETH1 to RIO1.ETH1; the same-named terminals stay apart.
        const net = await ok(
          ["net", "PLC1.ETH1", "--json"],
          await communication(),
        );
        expect(
          JSON.parse(net.stdout).net.terminals.map((t: any) => t.display),
        ).toEqual(["PLC1.ETH1"]);
        // An invented protocol marked verified compiles unchecked.
        const net4 = around.relations.find(
          (r: any) => r.relation.designation === "NET4",
        );
        expect(net4.relation.connection).toMatchObject({
          protocol: "NotARealProtocol",
          status: "verified",
        });
      },
    },
    {
      claim:
        'Packets draw them with `{"format": "communication-view-request/0.1", "medium": "ethernet"}`, optionally `devices: ["PLC1", "RIO1"]`: links touching a listed device, with each far end as a boundary device without its other links.',
      async check() {
        const project = await communication();
        const source = await communicationSource();
        const uid = (name: string) => byDesignation(source, name).uid;
        // A view may split into parts; read every sheet it produced.
        const draw = async (view: Record<string, unknown>) => {
          const run = await packet(project, {
            format: "schematic-packet-request/0.1",
            views: [{ format: "communication-view-request/0.1", ...view }],
          });
          expect(run.code, describeRun(run.args, run)).toBe(0);
          const svg = run.json.sheets.map((s: any) => s.svg).join("\n");
          return {
            json: run.json,
            titles: run.json.sheets.map((s: any) => s.view.title),
            devices: [
              ...new Set(
                run.json.sheets.flatMap((s: any) =>
                  s.references.map((r: any) => r.designation),
                ),
              ),
            ].sort(),
            links: [...svg.matchAll(/data-communication-link="([^"]*)"/g)]
              .map((m) => m[1])
              .sort(),
            boundaries: svg.split("Boundary (schedule)").length - 1,
            svg,
          };
        };
        const [whole, focused] = await Promise.all([
          draw({ medium: "ethernet" }),
          draw({ medium: "ethernet", devices: ["PLC1", "RIO1"] }),
        ]);
        for (const title of whole.titles)
          expect(title).toMatch(/^Ethernet connections/);
        expect(whole.devices).toEqual(["HMI1", "PLC1", "RIO1", "SW1"]);
        expect(whole.links).toEqual(["NET1", "NET2", "NET3"].map(uid).sort());
        expect(whole.boundaries).toBe(0);
        // SW1 is the far end of NET2: a boundary, without NET3 or HMI1.
        expect(focused.devices).toEqual(["PLC1", "RIO1", "SW1"]);
        expect(focused.links).toEqual(["NET1", "NET2"].map(uid).sort());
        expect(focused.boundaries).toBe(1);
        expect(focused.svg).not.toContain("NET3");
        const net3 = focused.json.coverage.topology.communicationLinks.find(
          (l: any) => l.designation === "NET3",
        );
        expect(net3.appearances).toEqual([]);
      },
    },
    {
      claim:
        "A `network` report lists every link and unconnected port; an unconnected port is not automatically spare.",
      async check() {
        const { header, rows } = await networkReport();
        expect(header).toEqual([
          "Link",
          "Protocol / medium",
          "End A / location",
          "End B / location",
          "Status",
        ]);
        const status = (link: string) =>
          rows.filter((r) => r[0] === link).map((r) => r[4]);
        expect(
          ["NET1", "NET2", "NET3", "NET4"].map((link) => status(link)),
        ).toEqual([["planned"], ["verified"], ["Unspecified"], ["verified"]]);
        const unconnected = rows.filter((r) => r[3] === "Unconnected");
        expect(unconnected.map((r) => r[2]!.split("\n")[0]).sort()).toEqual([
          "HMI1.BUS",
          "HMI1.ETH2",
          "PLC1.ETH2",
          "SW1.BUS",
        ]);
        // PLC1.ETH2 is even reviewed as intentionally unused.
        expect(unconnected.every((r) => r[4] === "Unspecified")).toBe(true);
        expect(rows.flat().join(" ")).not.toMatch(/spare/i);
      },
    },
    {
      claim:
        "Run `thermite diagnostics --json` for all declared terminals/ports, required connections, incomplete models and review dispositions.",
      async check() {
        const { report } = await auditReport();
        expect(report.format).toBe("electrical-completeness/0.1");
        expect(report.counts).toMatchObject({
          devices: 4,
          terminals: 10,
          ports: 2,
          requiredMissing: 4,
          partialModels: 1,
          unreviewedModels: 1,
        });
        // Connected points are inventoried too, not only findings.
        expect(point(report, "PS1", "+")).toMatchObject({
          connection: "connected",
          connections: ["W1"],
        });
        expect(point(report, "D1", "N")).toMatchObject({
          required: true,
          connection: "dangling",
        });
        expect(point(report, "D1", "P").review.status).toBe("deferred");
        expect(point(report, "D2", "SP").review.status).toBe(
          "intentionally-unused",
        );
        expect(point(report, "HMI1", "ETH1")).toMatchObject({
          kind: "port",
          required: true,
        });
      },
    },
    {
      claim:
        '`--device HMI1` or `--location "HMI console"` focuses it; `-o audit.csv` writes the full connection table.',
      async check() {
        const project = await copyProject(await audit(), "completeness-csv");
        const [byDevice, byLocation, file, { report }] = await Promise.all([
          auditFocus("--device", "HMI1"),
          auditFocus("--location", "HMI console"),
          ok(["diagnostics", "-o", "audit.csv"], project),
          auditReport(),
        ]);
        expect(byDevice.stdout).toContain(
          "Scope: HMI1\n1 devices; 0 terminals; 2 ports",
        );
        expect(byDevice.stdout).toContain("WARNING W903 HMI1 [HMI console]");
        expect(byDevice.stdout).not.toMatch(/ (D1|D2|PS1) \[/);
        expect(byLocation.stdout).toContain(
          "Scope: HMI console\n2 devices; 4 terminals; 2 ports",
        );
        expect(byLocation.stdout).toMatch(/ D2 \[HMI console\]/);
        expect(byLocation.stdout).not.toMatch(/ (D1|PS1) \[/);
        expect(file.stdout).toMatch(/^Wrote .*audit\.csv\n$/);
        const [header, ...rows] = await readCsv(join(project, "audit.csv"));
        expect(header!.slice(0, 6)).toEqual([
          "Device",
          "Location",
          "Kind",
          "Connection",
          "Required",
          "State",
        ]);
        // One model-coverage row per device plus every terminal and port.
        expect(rows).toHaveLength(
          report.devices.reduce(
            (n: number, d: any) => n + 1 + d.connections.length,
            0,
          ),
        );
        const lead = (r: string[]) => r.slice(0, 6).join("|");
        expect(rows.map(lead)).toEqual(
          expect.arrayContaining([
            "HMI1|HMI console|model|||partial",
            "D1|Main cabinet|terminal|N|true|dangling",
            "PS1|Main cabinet|terminal|'+|false|connected",
          ]),
        );
        // An unknown device, or filters that match nothing together, fail
        // instead of printing a clean report.
        const [unknown, disjoint] = await Promise.all([
          thermite(
            ["diagnostics", "--device", "DOES-NOT-EXIST", "--json"],
            project,
          ),
          thermite(
            ["diagnostics", "--device", "D1", "--location", "HMI console"],
            project,
          ),
        ]);
        expect(unknown.code, unknown.stderr).toBe(1);
        expect(unknown.stdout).toBe("");
        expect(disjoint.code, disjoint.stderr).toBe(1);
      },
    },
    {
      claim: "Compiler diagnostics remain on stderr.",
      async check() {
        const [filtered, { report, compiler }] = await Promise.all([
          auditFocus("--device", "HMI1"),
          auditReport(),
        ]);
        // Text on stdout; the whole project's compiler output on stderr, even
        // when the inventory is filtered to HMI1.
        expect(filtered.stdout).toContain("connection completeness");
        expect(filtered.stdout).not.toContain('"diagnostics"');
        const stderr = JSON.parse(filtered.stderr);
        expect(stderr.error).toBeNull();
        expect(
          stderr.diagnostics.map(
            (d: any) => `${d.code} ${d.message.split(":")[0]}`,
          ),
        ).toEqual(expect.arrayContaining(["W903 D1", "W905 D2", "W904 HMI1"]));
        expect(report.format).toBe("electrical-completeness/0.1");
        expect(compiler.diagnostics).toEqual(stderr.diagnostics);
      },
    },
    {
      claim: "Library terminals and ports can declare `required: true`.",
      async check() {
        const types = await schema("device-type");
        expect(types.$defs.terminal.properties.required.type).toBe("boolean");
        expect(
          types.properties.ports.patternProperties["^.+$"].properties.required
            .type,
        ).toBe("boolean");
        const [{ report }, edited] = await Promise.all([
          auditReport(),
          libraryEdits(),
        ]);
        expect(point(report, "D1", "N").required).toBe(true);
        expect(findings(report, "W903", "D1", "N")).toHaveLength(1);
        // With no project review, only the library flag separates ETH1 from ETH2.
        expect(point(edited, "HMI1", "ETH1").required).toBe(true);
        expect(findings(edited, "W903", "HMI1", "ETH1")[0].message).toBe(
          "Required port HMI1.ETH1 has no connection.",
        );
        expect(point(edited, "HMI1", "ETH2").required).toBe(false);
        expect(findings(edited, "I001", "HMI1", "ETH2")).toHaveLength(1);
        // A non-boolean flag is rejected, on the engine's fixture.
        const { claimed, METADATA_FAULTS } = await engine();
        await claimed(METADATA_FAULTS, { "required-string": "E011" });
      },
    },
    {
      claim:
        'Give new device types `connectionCoverage: {status: "complete"|"partial"|"generic", notes: "..."}` with nonblank notes.',
      async check() {
        const coverage = (await schema("device-type")).properties
          .connectionCoverage;
        expect(coverage.required).toEqual(["status", "notes"]);
        expect(coverage.properties.status.enum).toEqual([
          "complete",
          "partial",
          "generic",
        ]);
        expect(coverage.properties.notes.pattern).toBe("\\S");
        const { report } = await auditReport();
        expect(
          report.devices.map((d: any) => [d.designation, d.coverage.status]),
        ).toEqual([
          ["D1", "complete"],
          ["D2", "complete"],
          ["HMI1", "partial"],
          ["PS1", "unreviewed"],
        ]);
        await rejected(
          ["lock", "."],
          await auditCopy({
            types: (t) => (t.types[0].connectionCoverage.status = "probably"),
          }),
          "E014",
          'Value is not one of the allowed values: ["complete", "partial", "generic"]',
        );
        // Missing notes are rejected as well, on the engine's fixture.
        const { claimed, METADATA_FAULTS } = await engine();
        await claimed(METADATA_FAULTS, { "coverage-notes": "E010" });
        await rejected(
          ["lock", "."],
          await auditCopy({
            types: (t) => {
              t.types[0].connectionCoverage = {
                status: "generic",
                notes: "  ",
              };
            },
          }),
          "E013",
        );
      },
    },
    {
      claim:
        "Complete reviews all an exact part's physical connections; generic reviews an abstract interface without exact-part catalog facts (E014 otherwise).",
      async check() {
        const types = await schema("device-type");
        expect(types.properties.catalog.required).toEqual([
          "manufacturer",
          "orderNumber",
          "document",
        ]);
        expect(
          types.dependentSchemas.catalog.properties.connectionCoverage
            .properties.status.enum,
        ).toEqual(["complete", "partial"]);
        await rejected(
          ["lock", "."],
          await auditCopy({
            types: (t) => {
              t.types[0].connectionCoverage.status = "generic";
              t.types[0].catalog = {
                manufacturer: "Synthetic",
                orderNumber: "TEST-ONLY",
                document: {
                  url: "https://example.invalid/test",
                  title: "Synthetic",
                  revision: "A",
                  pages: "1",
                },
              };
            },
          }),
          "E014",
          'cannot be combined with exact-part catalog facts in "catalog" (manufacturer, order number)',
        );
      },
    },
    {
      claim: "I005 reports generic limits and notes once per device.",
      async check() {
        const { report } = await diagnostics(ctx.pristine.starter);
        expect(
          report.findings.filter(
            (f: any) => f.code === "I003" || f.code === "W904",
          ),
        ).toEqual([]);
        const generic = report.findings.filter((f: any) => f.code === "I005");
        expect(generic.map((f: any) => [f.designation, f.severity])).toEqual([
          ["PLC1", "info"],
          ["PS1", "info"],
        ]);
        for (const device of report.devices) {
          expect(device.coverage.status).toBe("generic");
          expect(
            generic.find((f: any) => f.designation === device.designation)
              .message,
          ).toBe(
            `Generic connection interface: terminals of an actual part beyond this abstract interface cannot be checked. ${device.coverage.notes}`,
          );
        }
      },
    },
    {
      claim:
        "Missing coverage is unreviewed; a model omitting its own interface's connections stays partial.",
      async check() {
        const { report } = await auditReport();
        // PS1's type declares no coverage at all.
        const ps1 = report.devices.find((d: any) => d.designation === "PS1");
        expect(ps1.coverage.status).toBe("unreviewed");
        expect(findings(report, "I003", "PS1")[0].severity).toBe("info");
        expect(findings(report, "W904", "PS1")).toEqual([]);
        expect(findings(report, "W904", "HMI1")[0].message).toBe(
          "Incomplete connection model: Power connector and protective bonding are not modeled.",
        );
      },
    },
    {
      claim:
        'On a device, `connectionReview.terminals`, `.ports` and `.connectorPorts` map declared keys to `{status: "required"|"intentionally-unused"|"deferred", reason: "..."}` with a nonblank reason.',
      async check() {
        const devices = await schema("device");
        expect(
          Object.keys(devices.properties.connectionReview.properties),
        ).toEqual(["terminals", "ports", "connectorPorts"]);
        const entry = devices.$defs.connectionReviewEntry;
        expect(entry.required).toEqual(["status", "reason"]);
        expect(entry.properties.status.enum).toEqual([
          "required",
          "intentionally-unused",
          "deferred",
        ]);
        expect(entry.properties.reason.pattern).toBe("\\S");
        const [{ report }, edited] = await Promise.all([
          auditReport(),
          libraryEdits(),
        ]);
        expect(point(report, "D1", "P").review.status).toBe("deferred");
        expect(point(report, "D2", "S").review.status).toBe("required");
        expect(point(report, "HMI1", "ETH2")).toMatchObject({
          kind: "port",
          review: { status: "intentionally-unused" },
        });
        expect(point(edited, "HMI1", "X1")).toMatchObject({
          kind: "connector-port",
          review: { status: "deferred" },
        });
        expect(findings(edited, "W905", "HMI1", "X1")[0].message).toBe(
          "HMI1.X1 has deferred work: Power cordset pending.",
        );
        await rejected(
          ["validate", "."],
          await auditCopy({
            source: (s) =>
              (byDesignation(s, "D1").connectionReview.terminals.P.reason =
                "  "),
          }),
          "E013",
          "String value does not match the required pattern",
        );
        // A missing reason or an unknown status fails too, on the engine's
        // fixture.
        const { claimed, METADATA_FAULTS } = await engine();
        await claimed(METADATA_FAULTS, {
          "missing-reason": "E010",
          "unknown-status": "E014",
        });
      },
    },
    {
      claim: "Use required for application-specific connections.",
      async check() {
        const { report } = await auditReport();
        // D1 and D2 share a type whose S is optional; only D2's review requires it.
        expect(point(report, "D2", "S").required).toBe(true);
        expect(findings(report, "W903", "D2", "S")[0].message).toBe(
          "Required terminal D2.S has no connection. Review: required: This application uses the signal input.",
        );
        expect(point(report, "D1", "S").required).toBe(false);
        expect(findings(report, "W903", "D1", "S")).toEqual([]);
        expect(findings(report, "I001", "D1", "S")).toHaveLength(1);
      },
    },
    {
      claim:
        "Deferred work remains visible even on connected terminals, and unused notes cannot waive a library requirement.",
      async check() {
        const { report } = await auditReport();
        expect(point(report, "D1", "P")).toMatchObject({
          connection: "connected",
          connections: ["W1"],
        });
        expect(findings(report, "W905", "D1", "P")[0].message).toBe(
          "D1.P has deferred work: Protection selection is pending.",
        );
        // The same terminal on D2 is connected without a deferred review.
        expect(point(report, "D2", "P").connection).toBe("connected");
        expect(findings(report, "W905", "D2", "P")).toEqual([]);
        // D2.N is library-required and reviewed as unused: both warnings stay.
        expect(findings(report, "W903", "D2", "N")).toHaveLength(1);
        expect(findings(report, "W905", "D2", "N")[0].message).toMatch(
          /^D2\.N is marked intentionally unused but is required\./,
        );
      },
    },
    {
      claim: "Unknown keys fail E205.",
      async check() {
        // E205 is one diagnostic per device that names every unknown key.
        const project = await auditCopy({
          source: (s) => {
            byDesignation(s, "D1").connectionReview.terminals.TYPO = {
              status: "required",
              reason: "Typo.",
            };
            const hmi = byDesignation(s, "HMI1").connectionReview;
            hmi.ports.ETH9 = { status: "required", reason: "Typo." };
            hmi.connectorPorts = {
              X9: { status: "required", reason: "Typo." },
            };
          },
        });
        const run = await rejected(
          ["validate", "."],
          project,
          "E205",
          'E205 D1 connectionReview references undeclared terminal "TYPO".',
        );
        expect(run.stdout + run.stderr).toContain(
          'E205 HMI1 connectionReview references undeclared port "ETH9", connector port "X9".',
        );
        // `diagnostics --json` refuses such a project with empty stdout.
        const refused = await thermite(["diagnostics", "--json"], project);
        expect(refused.code, refused.stderr).toBe(1);
        expect(refused.stdout).toBe("");
        expect(refused.stderr).toContain("E205");
      },
    },
    {
      claim:
        "W903 flags non-deferred required points not fully connected, W904 partial models, and W905 deferred or contradictory reviews; preserve them.",
      async check() {
        const [validated, moved] = await Promise.all([
          auditValidate(),
          rewired(),
        ]);
        for (const line of [
          "W903 D1: Required terminal D1.N has only a cable core with an unfinished far end.",
          "W903 HMI1: Required port HMI1.ETH1 has no connection.",
          "W904 HMI1: Incomplete connection model: Power connector and protective bonding are not modeled.",
          "W905 D1: D1.P has deferred work: Protection selection is pending.",
          "W905 D2: D2.N is marked intentionally unused but is required.",
        ])
          expect(validated).toContain(line);
        // An unused review that acquires a conductor is contradictory too.
        expect(findings(moved, "W905", "D2", "SP")[0].message).toMatch(
          /^D2\.SP is marked intentionally unused but has an attached connection\./,
        );
      },
    },
    {
      claim:
        "Optional unconnected points, spares and unreviewed models stay visible as information.",
      async check() {
        const [{ report, compiler }, validated, moved] = await Promise.all([
          auditReport(),
          auditValidate(),
          rewired(),
        ]);
        expect(findings(report, "I001", "D1", "S")[0]).toMatchObject({
          severity: "info",
          message:
            "D1.S has no connection; no requirement or unused disposition is declared.",
        });
        expect(findings(report, "I002", "D2", "SP")[0]).toMatchObject({
          severity: "info",
          message: "D2.SP is intentionally unused: Reserved for expansion.",
        });
        expect(findings(report, "I003", "PS1")[0].severity).toBe("info");
        expect(report.counts.information).toBe(5);
        // Information never becomes a compiler warning.
        expect(
          compiler.diagnostics.filter((d: any) => d.code.startsWith("I")),
        ).toEqual([]);
        expect(validated).not.toMatch(/ I00\d /);
        // A spare core left single-ended on an optional point is information.
        expect(findings(moved, "I001", "D1", "SP")[0]).toMatchObject({
          severity: "info",
          message:
            "D1.SP has an unfinished cable core; no requirement or unused disposition is declared.",
        });
      },
    },
    {
      claim:
        "A single-ended cable core does not satisfy a required connection.",
      async check() {
        const [{ report }, moved] = await Promise.all([
          auditReport(),
          rewired(),
        ]);
        expect(point(report, "D1", "N")).toMatchObject({
          required: true,
          connection: "dangling",
          connections: ["CB1/1"],
        });
        expect(findings(report, "W903", "D1", "N")[0].message).toBe(
          "Required terminal D1.N has only a cable core with an unfinished far end.",
        );
        // Terminating the same core's far end completes D1.N.
        expect(point(moved, "D1", "N")).toMatchObject({
          connection: "connected",
          connections: ["CB1/1"],
        });
        expect(findings(moved, "W903", "D1")).toEqual([]);
      },
    },
    {
      claim:
        "Connected does not prove an upstream supply, correct voltage, protection, bonding or safety.",
      async check() {
        const { report } = await auditReport();
        expect(report.limitations[0]).toBe(
          "Connected means a modeled connection exists, not that supply, return, protective bonding, voltage, protection or operation is adequate.",
        );
        // D2.P (supply_positive) is fed from PS1.- and is still just connected.
        expect(point(report, "D2", "P")).toMatchObject({
          role: "supply_positive",
          connection: "connected",
          connections: ["CB1/2"],
        });
        expect(point(report, "PS1", "-").connections).toEqual(["CB1/2"]);
        expect(
          report.findings.filter(
            (f: any) => f.designation === "D2" && f.key === "P",
          ),
        ).toEqual([]);
      },
    },
    {
      claim:
        "A communication relation's `connection.cable` requires `specification` and may add `lengthM` (at least 0.001 m) and `route`, shown in network schedules and reviews apart from electrical cable inventories.",
      async check() {
        const cable = (await schema("relation")).properties.connection
          .properties.cable;
        expect(cable.required).toEqual(["specification"]);
        expect(Object.keys(cable.properties)).toEqual([
          "specification",
          "lengthM",
          "route",
        ]);
        expect(cable.properties.lengthM.minimum).toBe(0.001);
        const base = await communication();
        const [{ rows }, short, cables, bom, snapshot] = await Promise.all([
          networkReport(),
          communicationCopy({
            source: (s) =>
              (byDesignation(s, "NET4").connection.cable.lengthM = 0.0009),
          }),
          outside("cables.csv"),
          outside("bom.csv"),
          outside("before.json"),
        ]);
        // The validated base holds a 0.001 m record; just below fails E015.
        expect(networkCell(rows, "NET4")).toBe(
          "NotARealProtocol\nBus cable\n0.001 m",
        );
        expect(networkCell(rows, "NET1")).toBe(
          "PROFINET\nCat6A S/FTP\n12.5 m\nTray T1",
        );
        await Promise.all([
          rejected(
            ["validate", "."],
            short,
            "E015",
            "Number is smaller than allowed.",
          ),
          ok(["report", "cables", "-o", cables], base),
          ok(["report", "bom", "-o", bom], base),
          ok(["snapshot", "-o", snapshot], base),
        ]);
        // Zero and negative lengths are below the minimum; non-numeric ones
        // are the wrong type, on the engine's fixture.
        const { claimed, CABLE_LENGTHS } = await engine();
        await claimed(CABLE_LENGTHS, {
          "0": "E015",
          "-1": "E015",
          '"eight"': "E011",
          null: "E011",
        });
        // A communication relation is not an electrical cable: `cable`
        // refuses it with Q002.
        await rejected(["cable", "NET1"], base, "Q002");
        const materials = await readFile(bom, "utf8");
        for (const specification of ["Cat6A", "Cat5e", "Bus cable"])
          expect(materials).not.toContain(specification);
        expect(await readCsv(cables)).toEqual([
          [
            "Cable",
            "Description / type",
            "End A location",
            "End B location",
            "Cores",
            "Connected",
            "Spare",
            "Unassigned",
            "Shield construction",
          ],
        ]);
        const changed = await communicationCopy({
          source: (s) =>
            Object.assign(byDesignation(s, "NET1").connection.cable, {
              lengthM: 20,
              route: "Conduit C8",
            }),
        });
        const review = await ok(["review", "--before", snapshot], changed);
        expect(review.stdout).toContain(
          "CHANGED relation NET1: /connection/cable/lengthM: 12.5 -> 20; /connection/cable/route: Tray T1 -> Conduit C8",
        );
      },
    },
    {
      claim: "A conduit route does not imply a shield or protective bond.",
      async check() {
        // The record has no field to declare one.
        const cable = (await schema("relation")).properties.connection
          .properties.cable;
        expect(cable.additionalProperties).toBe(false);
        const [around, { rows }] = await Promise.all([
          rio1Neighbors(),
          networkReport(),
        ]);
        // NET2 runs in conduit, yet RIO1 still has no conductive neighbor.
        expect(around.conductive).toEqual([]);
        const net2 = around.relations.find(
          (r: any) => r.relation.designation === "NET2",
        );
        expect(net2.relation.connection.cable).toEqual({
          route: "Conduit C7",
          specification: "Cat5e",
        });
        expect(networkCell(rows, "NET2")).toBe("PROFINET\nCat5e\nConduit C7");
      },
    },
  ],
  unexecuted: new Map([
    [
      "Never invent pins for completeness.",
      "Authoring advice: the engine can only check declared terminals and ports.",
    ],
    [
      "Never mark points unused just to clear a finding.",
      "Authoring advice about review honesty; the engine cannot judge intent.",
    ],
  ]),
};
export default module;
