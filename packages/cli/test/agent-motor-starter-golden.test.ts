import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import {
  createMotorStarterPnpExperiment,
  type MotorStarterPnpExperiment,
} from "../../render/test/motor-starter-pnp-fixture.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const cliPath = join(packageRoot, "dist", "bin.js");
const goldenRoot = join(packageRoot, "test", "goldens", "motor-starter-agent");
const rendererGoldenRoot = join(
  repositoryRoot,
  "packages",
  "render",
  "test",
  "goldens",
);
const cliGoldenRoot = join(packageRoot, "test", "goldens");

const LS1_UID = "596f728b-1445-4c4b-8974-a3b4ea703636";
const PLC1_UID = "81148ad3-8c03-4c8d-8c70-6b33bb3b0266";
const EQUIPMENT_INTEGRITY =
  "sha256-NORh7LZPQdPLk7cGwHOwZjAjADVy+YVsJJEU13oOx7Y=";
const CONNECTIONS_INTEGRITY =
  "sha256-uH5wquZl1n/aAVaxmhG7cdvaUl7sOUBVYKjQOaYKvmE=";

const BASE_REQUEST = {
  format: "agent-tool-request/0.1",
  project: ".",
} as const;

const VIEW_SPEC = {
  format: "schematic-view-request/0.2",
  root: { by: "designation", value: "LS1" },
  intent: {
    kind: "trace",
    to: { by: "designation", value: "PLC1" },
    includePower: true,
  },
  flow: "left-to-right",
} as const;

const TYPE_OPERATIONS = [
  { op: "test", path: "/objects/8/uid", value: LS1_UID },
  {
    op: "test",
    path: "/objects/8/type",
    value: "core:limit-switch-2wire",
  },
  {
    op: "replace",
    path: "/objects/8/type",
    value: "core:prox-pnp-3wire",
  },
] as const;

const REQUESTS = Object.freeze({
  validate: BASE_REQUEST,
  search: {
    ...BASE_REQUEST,
    target: { by: "text", value: "LS1" },
  },
  inspect: {
    ...BASE_REQUEST,
    selector: { by: "uid", value: LS1_UID },
  },
  net: {
    ...BASE_REQUEST,
    query: {
      operation: "net",
      selector: {
        by: "parts",
        deviceDesignation: "LS1",
        terminalKey: "14",
      },
    },
  },
  view: { ...BASE_REQUEST, spec: VIEW_SPEC },
  typeOnlyPatch: {
    ...BASE_REQUEST,
    patchFormat: "json-patch/0.1",
    dryRun: true,
    files: [
      {
        path: "devices/equipment.json",
        expectedIntegrity: EQUIPMENT_INTEGRITY,
        operations: TYPE_OPERATIONS,
      },
    ],
  },
  completePatch: {
    ...BASE_REQUEST,
    patchFormat: "json-patch/0.1",
    dryRun: false,
    files: [
      {
        path: "devices/equipment.json",
        expectedIntegrity: EQUIPMENT_INTEGRITY,
        operations: [
          ...TYPE_OPERATIONS,
          {
            op: "test",
            path: "/objects/8/description",
            value: "Normally open field limit switch permissive",
          },
          {
            op: "replace",
            path: "/objects/8/description",
            value: "Three-wire PNP field proximity sensor permissive",
          },
        ],
      },
      {
        path: "connections/field-terminations.json",
        expectedIntegrity: CONNECTIONS_INTEGRITY,
        operations: [
          {
            op: "test",
            path: "/objects/1/uid",
            value: "4f3f64e8-af7c-4b5d-9cbc-250368ad3e75",
          },
          {
            op: "test",
            path: "/objects/1/endpoints/1/terminal",
            value: "13",
          },
          {
            op: "replace",
            path: "/objects/1/endpoints/1/terminal",
            value: "1",
          },
          {
            op: "test",
            path: "/objects/2/uid",
            value: "c2dccef7-ec9d-48dc-b58b-6e0dd990dd51",
          },
          {
            op: "test",
            path: "/objects/2/endpoints/0/terminal",
            value: "14",
          },
          {
            op: "replace",
            path: "/objects/2/endpoints/0/terminal",
            value: "4",
          },
          {
            op: "test",
            path: "/objects/2/properties/label",
            value: "LS1-SWITCHED-RETURN",
          },
          {
            op: "replace",
            path: "/objects/2/properties/label",
            value: "LS1-PNP-OUT-PLC1-DI0",
          },
          {
            op: "test",
            path: "/objects/3/uid",
            value: "7bdee01c-ec15-4747-9208-ee650da1e681",
          },
          {
            op: "add",
            path: "/objects/3",
            value: {
              uid: "4afbc8b2-5bd7-4b92-8f9d-dcf124b85d01",
              kind: "wire",
              designation: "W-FLD-004",
              endpoints: [
                { device: "JB1", terminal: "X1.3" },
                { device: "LS1", terminal: "3" },
              ],
              properties: {
                label: "0V-JB1-LS1",
                size: "18AWG",
                color: "blue/white",
              },
            },
          },
        ],
      },
    ],
  },
});

const GOLDEN_SLUGS = [
  "baseline-validate",
  "search-ls1",
  "inspect-ls1",
  "net-ls1-14",
  "baseline-view",
  "type-only-patch",
  "complete-patch",
  "final-validate",
  "pnp-inspect",
  "pnp-view",
] as const;

type GoldenSlug = (typeof GOLDEN_SLUGS)[number];
type AgentTool =
  | "resolve"
  | "inspect"
  | "query"
  | "validate"
  | "create-view"
  | "apply-source-patch";

interface Invocation {
  readonly exitCode: number;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
}

interface SplitGolden {
  readonly stdout: Buffer;
  readonly stderr: Buffer;
}

interface ExpectedArtifacts {
  readonly agent: ReadonlyMap<GoldenSlug, SplitGolden>;
  readonly baselineRendererSvg: Buffer;
  readonly baselineCliSvg: Buffer;
  readonly pnpRendererSvg: Buffer;
  readonly pnpCliSvg: Buffer;
}

interface JsonResultEnvelope {
  readonly format: string;
  readonly tool: string;
  readonly value: unknown;
}

interface JsonReportEnvelope {
  readonly format: string;
  readonly tool: string;
  readonly diagnostics: readonly unknown[];
  readonly error: unknown;
}

let artifacts: ExpectedArtifacts;
function requestBytes(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value, undefined, 2) + "\n", "utf8");
}

function hash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseJson<Value>(bytes: Buffer): Value {
  expect(bytes.byteLength).toBeGreaterThan(0);
  const text = bytes.toString("utf8");
  expect(Buffer.from(text, "utf8")).toEqual(bytes);
  return JSON.parse(text) as Value;
}

function expectPortableStream(
  bytes: Buffer,
  allowEmpty: boolean,
  experiment: MotorStarterPnpExperiment,
): void {
  expect(bytes.includes(0x0d)).toBe(false);
  if (bytes.byteLength === 0) {
    expect(allowEmpty).toBe(true);
    return;
  }

  expect(bytes.at(-1)).toBe(0x0a);
  expect(bytes.at(-2)).not.toBe(0x0a);
  const text = bytes.toString("utf8");
  expect(text).not.toMatch(/\u001b\[[0-?]*[ -/]*[@-~]/u);
  for (const path of [
    repositoryRoot,
    experiment.root,
    experiment.projectRoot,
    experiment.libraryRoot,
  ].flatMap((path) => [path, path.replaceAll("\\", "/")])) {
    expect(text).not.toContain(path);
  }
  expect(text).not.toMatch(
    /(?:^|[^A-Za-z])[A-Za-z]:[\\/]|\\\\[^\\]|\/(?:home|tmp|Users)\//u,
  );
}

function expectSuccess(
  invocation: Invocation,
  tool: AgentTool,
  experiment: MotorStarterPnpExperiment,
): unknown {
  expect(invocation.exitCode).toBe(0);
  const result = parseJson<JsonResultEnvelope>(invocation.stdout);
  expect(result).toMatchObject({
    format: "agent-tool-result/0.1",
    tool,
  });
  expect(Object.keys(result)).toEqual(["format", "tool", "value"]);

  const report = parseJson<JsonReportEnvelope>(invocation.stderr);
  expect(report).toEqual({
    format: "agent-tool-report/0.1",
    tool,
    diagnostics: [],
    error: null,
  });
  expectPortableStream(invocation.stdout, false, experiment);
  expectPortableStream(invocation.stderr, false, experiment);
  return result.value;
}

function expectExpectedFailure(
  invocation: Invocation,
  tool: AgentTool,
  experiment: MotorStarterPnpExperiment,
): JsonReportEnvelope {
  expect(invocation.exitCode).toBe(1);
  expect(invocation.stdout.byteLength).toBe(0);
  const report = parseJson<JsonReportEnvelope>(invocation.stderr);
  expect(report).toMatchObject({
    format: "agent-tool-report/0.1",
    tool,
  });
  expect(Object.keys(report)).toEqual([
    "format",
    "tool",
    "diagnostics",
    "error",
  ]);
  expectPortableStream(invocation.stdout, true, experiment);
  expectPortableStream(invocation.stderr, false, experiment);
  return report;
}

function expectGolden(
  slug: GoldenSlug,
  invocation: Invocation,
  exitCode: 0 | 1,
): void {
  const golden = artifacts.agent.get(slug);
  if (golden === undefined) throw new Error("Missing golden " + slug + ".");
  expect(invocation).toEqual({ exitCode, ...golden });
}

async function invokeAgent(
  projectRoot: string,
  tool: AgentTool,
  request: unknown,
): Promise<Invocation> {
  return new Promise((resolveInvocation, rejectInvocation) => {
    const child = spawn(
      process.execPath,
      [cliPath, "agent", tool, "--input", "-"],
      {
        cwd: projectRoot,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", rejectInvocation);
    child.once("close", (exitCode, signal) => {
      if (signal !== null || exitCode === null) {
        rejectInvocation(
          new Error("Agent CLI subprocess failed with signal " + signal + "."),
        );
      } else {
        resolveInvocation({
          exitCode,
          stdout: Buffer.concat(stdout),
          stderr: Buffer.concat(stderr),
        });
      }
    });
    child.stdin.end(requestBytes(request));
  });
}

function isChildProcessDenied(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EPERM"
  );
}

interface InspectValue {
  readonly command: string;
  readonly object: {
    readonly kind: string;
    readonly uid: string;
    readonly designation: string;
    readonly typeId: string;
    readonly description: string;
    readonly terminals: readonly {
      readonly id: { readonly terminalKey: string };
      readonly display: string;
      readonly net: {
        readonly id: string;
        readonly potentials: readonly { readonly name: string }[];
      };
      readonly elements: readonly { readonly designation: string }[];
    }[];
    readonly functions: readonly {
      readonly key: string;
      readonly kind: string;
      readonly normalState?: string;
      readonly terminals: readonly {
        readonly id: { readonly terminalKey: string };
      }[];
    }[];
    readonly gangedGroups: readonly unknown[];
    readonly internalRelations: readonly unknown[];
    readonly projectRelations: readonly unknown[];
  };
}

function expectBaselineInspect(value: unknown): void {
  const result = value as InspectValue;
  expect(result.command).toBe("inspect");
  expect(result.object).toMatchObject({
    kind: "device",
    uid: LS1_UID,
    designation: "LS1",
    typeId: "core:limit-switch-2wire",
    description: "Normally open field limit switch permissive",
  });
  expect(
    result.object.terminals.map(({ id, display, net, elements }) => ({
      terminalKey: id.terminalKey,
      display,
      netId: net.id,
      potentials: net.potentials.map(({ name }) => name),
      elements: elements.map(({ designation }) => designation),
    })),
  ).toEqual([
    {
      terminalKey: "13",
      display: "LS1.13",
      netId:
        "net:sha256:3d137761e58b445ed267e091f04cad782acdcec2f6a9f762594531476d54202a",
      potentials: ["+24VDC"],
      elements: ["W-FLD-002"],
    },
    {
      terminalKey: "14",
      display: "LS1.14",
      netId:
        "net:sha256:af8c9ba2461a98df6aae2bc32934bfb43e00d202ef9d6a0b4f8c8be8409877b9",
      potentials: [],
      elements: ["W-FLD-003"],
    },
  ]);
  expect(result.object.functions).toMatchObject([
    {
      key: "contact13",
      kind: "contact",
      normalState: "open",
      terminals: [{ id: { terminalKey: "13" } }, { id: { terminalKey: "14" } }],
    },
  ]);
  expect(result.object.gangedGroups).toEqual([]);
  expect(result.object.internalRelations).toEqual([]);
  expect(result.object.projectRelations).toEqual([]);
  expect(Object.hasOwn(result.object, "objects")).toBe(false);
  expect(Object.hasOwn(result.object, "neighbors")).toBe(false);
}

function expectPnpInspect(value: unknown): void {
  const result = value as InspectValue;
  expect(result.command).toBe("inspect");
  expect(result.object).toMatchObject({
    kind: "device",
    uid: LS1_UID,
    designation: "LS1",
    typeId: "core:prox-pnp-3wire",
    description: "Three-wire PNP field proximity sensor permissive",
  });
  expect(
    result.object.terminals.map(({ id, display, net, elements }) => ({
      terminalKey: id.terminalKey,
      display,
      potentials: net.potentials.map(({ name }) => name),
      elements: elements.map(({ designation }) => designation),
    })),
  ).toEqual([
    {
      terminalKey: "1",
      display: "LS1.1",
      potentials: ["+24VDC"],
      elements: ["W-FLD-002"],
    },
    {
      terminalKey: "3",
      display: "LS1.3",
      potentials: ["0VDC"],
      elements: ["W-FLD-004"],
    },
    {
      terminalKey: "4",
      display: "LS1.4",
      potentials: [],
      elements: ["W-FLD-003"],
    },
  ]);
  expect(
    result.object.functions.map(({ key, kind, terminals }) => ({
      key,
      kind,
      terminals: terminals.map(({ id }) => id.terminalKey),
    })),
  ).toEqual([
    { key: "output", kind: "channel", terminals: ["4"] },
    { key: "supply", kind: "load", terminals: ["1", "3"] },
  ]);
  expect(result.object.internalRelations).toEqual([
    {
      verb: "feeds_internal",
      fromFunctionKey: "supply",
      toFunctionKey: "output",
    },
  ]);
  expect(result.object.projectRelations).toEqual([]);
  expect(Object.hasOwn(result.object, "objects")).toBe(false);
  expect(Object.hasOwn(result.object, "neighbors")).toBe(false);
}

function expectViewSemantics(
  value: unknown,
  state: "baseline" | "pnp",
): Buffer {
  const rendered = value as {
    readonly view: unknown;
    readonly summary: {
      readonly terminalIds: readonly {
        readonly deviceUid: string;
        readonly terminalKey: string;
      }[];
      readonly functionIds: readonly {
        readonly deviceUid: string;
        readonly functionKey: string;
      }[];
      readonly conductiveElementIds: readonly unknown[];
      readonly netIds: readonly string[];
    };
    readonly svg: string;
  };
  expect(rendered.view).toEqual({
    format: "schematic-view/0.2",
    family: "control",
    intent: "trace",
    root: { kind: "device", deviceUid: LS1_UID, designation: "LS1" },
    target: { deviceUid: PLC1_UID, designation: "PLC1" },
    includePower: true,
    flow: "left-to-right",
  });

  const terminalKeys = rendered.summary.terminalIds
    .filter(({ deviceUid }) => deviceUid === LS1_UID)
    .map(({ terminalKey }) => terminalKey);
  const functionKeys = rendered.summary.functionIds
    .filter(({ deviceUid }) => deviceUid === LS1_UID)
    .map(({ functionKey }) => functionKey);
  expect(terminalKeys).toEqual(
    state === "baseline" ? ["13", "14"] : ["1", "3", "4"],
  );
  expect(functionKeys).toEqual(
    state === "baseline" ? ["contact13"] : ["supply", "output"],
  );
  expect(rendered.summary.conductiveElementIds).toHaveLength(
    state === "baseline" ? 7 : 10,
  );
  expect(rendered.summary.netIds).toHaveLength(state === "baseline" ? 2 : 3);

  const svg = Buffer.from(rendered.svg, "utf8");
  expect(svg.byteLength).toBe(state === "baseline" ? 69_059 : 93_501);
  expect(hash(svg)).toBe(
    state === "baseline"
      ? "dc7ce9dc8e0acd306bc8a85684c50d6b57bd1e9da4a9fd1c47a2e29b4fdc29ac"
      : "bbbc377dc603bc85afe496a06f33804553ac16ce5bda44cf12462f1cbfec6fdb",
  );
  return svg;
}

function expectM6SvgGoldens(svg: Buffer, state: "baseline" | "pnp"): void {
  if (state === "baseline") {
    expect(svg).toEqual(artifacts.baselineRendererSvg);
    expect(svg).toEqual(artifacts.baselineCliSvg);
  } else {
    expect(svg).toEqual(artifacts.pnpRendererSvg);
    expect(svg).toEqual(artifacts.pnpCliSvg);
  }
}
async function runWorkflow(
  experiment: MotorStarterPnpExperiment,
): Promise<void> {
  const baselineValidate = await invokeAgent(
    experiment.projectRoot,
    "validate",
    REQUESTS.validate,
  );
  expect(expectSuccess(baselineValidate, "validate", experiment)).toEqual({
    valid: true,
  });
  expectGolden("baseline-validate", baselineValidate, 0);

  const search = await invokeAgent(
    experiment.projectRoot,
    "resolve",
    REQUESTS.search,
  );
  const searchValue = expectSuccess(search, "resolve", experiment) as {
    readonly mode: string;
    readonly matches: readonly {
      readonly object: { readonly uid: string; readonly designation?: string };
      readonly match: {
        readonly kind: string;
        readonly field: string;
        readonly text: string;
      };
    }[];
  };
  expect(searchValue.mode).toBe("search");
  expect(
    searchValue.matches.map(({ object, match }) => ({
      designation: object.designation,
      uid: object.uid,
      match,
    })),
  ).toEqual([
    {
      designation: "LS1",
      uid: LS1_UID,
      match: { kind: "exact", field: "designation", text: "LS1" },
    },
    {
      designation: "CBL1",
      uid: "c4c1bfdf-567a-4f6c-9e08-147342061afe",
      match: {
        kind: "prefix",
        field: "description",
        text: "LS1 field cable; conductor 2- is a terminated spare",
      },
    },
    {
      designation: "JP1",
      uid: "7bdee01c-ec15-4747-9208-ee650da1e681",
      match: {
        kind: "substring",
        field: "description",
        text: "Distributes +24 VDC from TB1.1 to the LS1 cable feed at TB1.2",
      },
    },
    {
      designation: "JB1",
      uid: "c93a0ba9-65f4-4ffa-a0a1-1fde4a511e88",
      match: {
        kind: "substring",
        field: "description",
        text: "Field junction box for LS1",
      },
    },
  ]);
  expectGolden("search-ls1", search, 0);

  const baselineInspect = await invokeAgent(
    experiment.projectRoot,
    "inspect",
    REQUESTS.inspect,
  );
  expectBaselineInspect(expectSuccess(baselineInspect, "inspect", experiment));
  expectGolden("inspect-ls1", baselineInspect, 0);

  const net = await invokeAgent(experiment.projectRoot, "query", REQUESTS.net);
  const netValue = expectSuccess(net, "query", experiment) as {
    readonly command: string;
    readonly selectedTerminal: { readonly display: string };
    readonly net: {
      readonly potentials: readonly unknown[];
      readonly terminals: readonly { readonly display: string }[];
      readonly elements: readonly {
        readonly element: { readonly display: string };
      }[];
    };
  };
  expect(netValue.command).toBe("net");
  expect(netValue.selectedTerminal.display).toBe("LS1.14");
  expect(netValue.net.terminals.map(({ display }) => display)).toEqual([
    "JB1.X1.2",
    "LS1.14",
    "PLC1.X1.0",
    "TB1.3",
  ]);
  expect(
    netValue.net.elements.map(({ element }) => element.display).sort(),
  ).toEqual(["CBL1.1-", "W-FLD-001", "W-FLD-003"]);
  expect(netValue.net.potentials).toEqual([]);
  expectGolden("net-ls1-14", net, 0);

  const baselineView = await invokeAgent(
    experiment.projectRoot,
    "create-view",
    REQUESTS.view,
  );
  const baselineSvg = expectViewSemantics(
    expectSuccess(baselineView, "create-view", experiment),
    "baseline",
  );
  expectGolden("baseline-view", baselineView, 0);
  expectM6SvgGoldens(baselineSvg, "baseline");

  const typeOnlyPatch = await invokeAgent(
    experiment.projectRoot,
    "apply-source-patch",
    REQUESTS.typeOnlyPatch,
  );
  const typeOnlyReport = expectExpectedFailure(
    typeOnlyPatch,
    "apply-source-patch",
    experiment,
  );
  expect(typeOnlyReport).toEqual({
    format: "agent-tool-report/0.1",
    tool: "apply-source-patch",
    diagnostics: [
      {
        code: "E102",
        severity: "error",
        message:
          'Device "LS1" of type "core:prox-pnp-3wire" has no terminal "13".',
        file: "connections/field-terminations.json",
        line: 24,
        column: 40,
        jsonPointer: "/objects/1/endpoints/1/terminal",
        uid: "4f3f64e8-af7c-4b5d-9cbc-250368ad3e75",
        related: [
          {
            file: "@thermite/core-library/types/prox-pnp-3wire.json",
            line: 6,
            column: 13,
            note: 'Resolved device type "core:prox-pnp-3wire" is declared here.',
          },
        ],
      },
      {
        code: "E102",
        severity: "error",
        message:
          'Device "LS1" of type "core:prox-pnp-3wire" has no terminal "14".',
        file: "connections/field-terminations.json",
        line: 37,
        column: 40,
        jsonPointer: "/objects/2/endpoints/0/terminal",
        uid: "c2dccef7-ec9d-48dc-b58b-6e0dd990dd51",
        related: [
          {
            file: "@thermite/core-library/types/prox-pnp-3wire.json",
            line: 6,
            column: 13,
            note: 'Resolved device type "core:prox-pnp-3wire" is declared here.',
          },
        ],
      },
    ],
    error: null,
  });
  expectGolden("type-only-patch", typeOnlyPatch, 1);

  const repeatedInspect = await invokeAgent(
    experiment.projectRoot,
    "inspect",
    REQUESTS.inspect,
  );
  expectBaselineInspect(expectSuccess(repeatedInspect, "inspect", experiment));
  expect(repeatedInspect).toEqual(baselineInspect);

  const completePatch = await invokeAgent(
    experiment.projectRoot,
    "apply-source-patch",
    REQUESTS.completePatch,
  );
  expect(
    expectSuccess(completePatch, "apply-source-patch", experiment),
  ).toEqual({
    dryRun: false,
    applied: true,
    atomicity: "per-file",
    files: [
      {
        path: "connections/field-terminations.json",
        beforeIntegrity: CONNECTIONS_INTEGRITY,
        afterIntegrity: "sha256-R60hhwHH0iSb5ptHXmc/AzS0ha3XeTwb1W7j0MdiNr8=",
        byteLength: 2_165,
        changed: true,
      },
      {
        path: "devices/equipment.json",
        beforeIntegrity: EQUIPMENT_INTEGRITY,
        afterIntegrity: "sha256-9qBJJLOs0ScXY2derhvqFW9XysVFatnjj5un7khgoKc=",
        byteLength: 2_741,
        changed: true,
      },
    ],
  });
  expectGolden("complete-patch", completePatch, 0);

  const finalValidate = await invokeAgent(
    experiment.projectRoot,
    "validate",
    REQUESTS.validate,
  );
  expect(expectSuccess(finalValidate, "validate", experiment)).toEqual({
    valid: true,
  });
  expectGolden("final-validate", finalValidate, 0);

  const pnpInspect = await invokeAgent(
    experiment.projectRoot,
    "inspect",
    REQUESTS.inspect,
  );
  expectPnpInspect(expectSuccess(pnpInspect, "inspect", experiment));
  expectGolden("pnp-inspect", pnpInspect, 0);

  const pnpView = await invokeAgent(
    experiment.projectRoot,
    "create-view",
    REQUESTS.view,
  );
  const pnpSvg = expectViewSemantics(
    expectSuccess(pnpView, "create-view", experiment),
    "pnp",
  );
  expectGolden("pnp-view", pnpView, 0);
  expectM6SvgGoldens(pnpSvg, "pnp");
}

async function loadExpectedArtifacts(): Promise<ExpectedArtifacts> {
  const expectedFilenames = GOLDEN_SLUGS.flatMap((slug) => [
    slug + ".stderr.json",
    slug + ".stdout.json",
  ]).sort();
  expect((await readdir(goldenRoot)).sort()).toEqual(expectedFilenames);

  const entries = await Promise.all(
    GOLDEN_SLUGS.map(async (slug) => {
      const [stdout, stderr] = await Promise.all([
        readFile(join(goldenRoot, slug + ".stdout.json")),
        readFile(join(goldenRoot, slug + ".stderr.json")),
      ]);
      return [slug, { stdout, stderr }] as const;
    }),
  );
  const [baselineRendererSvg, baselineCliSvg, pnpRendererSvg, pnpCliSvg] =
    await Promise.all([
      readFile(
        join(
          rendererGoldenRoot,
          "motor-starter",
          "ls1-to-plc1-include-power-left-to-right.svg",
        ),
      ),
      readFile(
        join(
          cliGoldenRoot,
          "motor-starter",
          "view-ls1-to-plc1-include-power-left-to-right.stdout.svg",
        ),
      ),
      readFile(
        join(
          rendererGoldenRoot,
          "motor-starter-pnp",
          "ls1-to-plc1-include-power-left-to-right.svg",
        ),
      ),
      readFile(
        join(
          cliGoldenRoot,
          "motor-starter-pnp",
          "view-ls1-to-plc1-include-power-left-to-right.stdout.svg",
        ),
      ),
    ]);
  return {
    agent: new Map(entries),
    baselineRendererSvg,
    baselineCliSvg,
    pnpRendererSvg,
    pnpCliSvg,
  };
}

describe("M7 Task 8 motor-starter agent product workflow", () => {
  beforeAll(async () => {
    artifacts = await loadExpectedArtifacts();
  });

  it(
    "repeats every frozen workflow step through fresh built CLI processes",
    { timeout: 120_000 },
    async ({ skip }) => {
      for (let repetition = 0; repetition < 2; repetition += 1) {
        const experiment = await createMotorStarterPnpExperiment();
        try {
          await runWorkflow(experiment);
        } catch (error) {
          if (isChildProcessDenied(error)) {
            skip("The execution sandbox denied child-process creation.");
            return;
          }
          throw error;
        } finally {
          await experiment.cleanup();
        }
      }
    },
  );
});
