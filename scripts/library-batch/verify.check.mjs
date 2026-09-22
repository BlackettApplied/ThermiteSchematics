import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compileProject } from "@thermite/compiler";
import {
  assertNetPartition,
  assertPacketCoverage,
  verifyJob,
} from "./verify.mjs";

const json = (value) => JSON.stringify(value, null, 2) + "\n";
const document = {
  url: "https://manufacturer.example/manual.pdf",
  title: "Synthetic verifier test manual",
  revision: "Test 1",
  pages: "1",
};
const candidate = () => ({
  job: {
    id: "test-part",
    expectedTypeId: "verifier-test:part",
    expectedManufacturer: "Verifier Test",
    expectedOrderNumber: "TEST-1",
  },
  result: {
    format: "thermite-component-candidate/0.1",
    sourcePartId: "test-part",
    decision: "candidate",
    summary: "Synthetic test data; no manufacturer facts.",
    sources: [
      {
        id: "manual",
        ...document,
        authority: "manufacturer",
        claims: ["Test terminal inventory"],
        diagramReviewed: true,
      },
    ],
    unresolved: [],
    conformance: {
      terminalKeys: ["A", "B", "C", "D", "E"],
      requiredTerminalKeys: ["C"],
      fixedLinks: [
        {
          from: "C",
          to: "D",
          sourceId: "manual",
          reason: "Synthetic fixed link",
        },
        {
          from: "D",
          to: "E",
          sourceId: "manual",
          reason: "Synthetic fixed link",
        },
        {
          from: "C",
          to: "E",
          sourceId: "manual",
          reason: "Redundant link tests graph partition after removal",
        },
      ],
      renderKind: "circuit",
    },
  },
  type: {
    types: [
      {
        kind: "device_type",
        id: "verifier-test:part",
        description: "Synthetic contact and fixed conductors",
        symbol: "thermite:io-module",
        catalog: {
          manufacturer: "Verifier Test",
          orderNumber: "TEST-1",
          document,
          modelingNotes: ["Synthetic verifier fixture."],
        },
        connectionCoverage: {
          status: "partial",
          notes: "Synthetic test data, not a physical product.",
        },
        terminals: Object.fromEntries(
          ["A", "B", "C", "D", "E"].map((key) => [
            key,
            {
              role: "power",
              connection_policy: "shared",
              ...(key === "C" ? { required: true } : {}),
            },
          ]),
        ),
        functions: {
          contact: {
            kind: "contact",
            normal_state: "open",
            terminals: ["A", "B"],
          },
          C: { kind: "bus", terminals: ["C"] },
          D: { kind: "bus", terminals: ["D"] },
          E: { kind: "bus", terminals: ["E"] },
        },
        circuitSymbols: { C: "terminal", D: "terminal", E: "terminal" },
        connectorPorts: {
          PLUG: {
            connector: "Test connector",
            pins: { A: { terminal: "A" }, B: { terminal: "B" } },
          },
        },
      },
    ],
  },
});

async function setup(t, change = () => {}) {
  const root = await mkdtemp(join(tmpdir(), "thermite-batch-verifier-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const job = join(root, "job"),
    output = join(root, "check");
  await mkdir(job);
  const data = candidate();
  change(data);
  for (const [name, value] of [
    ["job.json", data.job],
    ["result.json", data.result],
    ["type.json", data.type],
  ])
    await writeFile(join(job, name), json(value));
  await writeFile(
    join(job, "research.md"),
    "# Synthetic verifier self-test\nNo manufacturer facts are asserted.\n",
  );
  return { job, output, data };
}

test("ganged poles share a drawing group while their physical nets stay separate", async (t) => {
  const options = await setup(t, (data) => {
    const type = data.type.types[0];
    delete type.terminals.E;
    type.functions = {
      pole1: { kind: "contact", normal_state: "open", terminals: ["A", "B"] },
      pole2: { kind: "contact", normal_state: "open", terminals: ["C", "D"] },
    };
    type.circuitSymbols = { pole1: "breaker", pole2: "breaker" };
    type.internal_relations = [
      { relation: "ganged_with", from: "pole1", to: "pole2" },
    ];
    data.result.conformance.terminalKeys = ["A", "B", "C", "D"];
    data.result.conformance.fixedLinks = [];
  });
  const report = await verifyJob(options);
  assert.equal(report.status, "verified-candidate", report.error);
  const request = JSON.parse(
    await readFile(join(report.outputs.fixture, "packet.request.json"), "utf8"),
  );
  assert.equal(request.views[0].groups.length, 1);
  assert.equal(request.views[0].groups[0].functions.length, 2);
  const compiled = await compileProject(report.outputs.fixture);
  assert.equal(compiled.ok, true);
  assertNetPartition(compiled.ir, ["A", "B", "C", "D"], []);
});

test("electrical candidate: contact stays open, explicit redundant fixed links, all endpoints rendered, negatives retained", async (t) => {
  const options = await setup(t);
  const report = await verifyJob(options);
  assert.equal(report.status, "verified-candidate", report.error);
  assert(
    report.checks.some(
      (check) =>
        check.name === "required-terminal-C" && check.status === "passed",
    ),
  );
  assert(
    report.diagnostics.some(
      (stage) =>
        stage.stage === "baseline" &&
        stage.diagnostics.some((entry) => entry.code === "W904"),
    ),
  );
  assert(
    report.diagnostics.some(
      (stage) =>
        stage.stage === "stale-library" &&
        stage.diagnostics.some((entry) => entry.code === "E108"),
    ),
  );
  const baseline = await compileProject(report.outputs.fixture);
  assert.equal(baseline.ok, true, json(baseline.diagnostics));
  assertNetPartition(
    baseline.ir,
    options.data.result.conformance.terminalKeys,
    options.data.result.conformance.fixedLinks,
  );
  // A compiler regression that shorts connector pins or a contact must fail the independent oracle.
  const broken = structuredClone(baseline.ir);
  const deviceUid = broken.devices.find(
    (device) => device.designation === "D1",
  ).uid;
  const a = broken.nets.find((net) =>
    net.terminalIds.some(
      (terminal) =>
        terminal.deviceUid === deviceUid && terminal.terminalKey === "A",
    ),
  );
  const b = broken.nets.find((net) =>
    net.terminalIds.some(
      (terminal) =>
        terminal.deviceUid === deviceUid && terminal.terminalKey === "B",
    ),
  );
  a.terminalIds.push(...b.terminalIds);
  broken.nets = broken.nets.filter((net) => net !== b);
  assert.throws(
    () =>
      assertNetPartition(
        broken,
        options.data.result.conformance.terminalKeys,
        options.data.result.conformance.fixedLinks,
      ),
    /Physical net partition mismatch/,
  );
  const packet = JSON.parse(await readFile(report.outputs.packet, "utf8"));
  const request = JSON.parse(
    await readFile(join(report.outputs.fixture, "packet.request.json"), "utf8"),
  );
  packet.sheets[0].svg = packet.sheets[0].svg.replace(
    /data-conductor-designation="W1"/g,
    'data-hidden-wire="W1"',
  );
  assert.throws(
    () => assertPacketCoverage(packet, baseline.ir, request, "circuit"),
    /Rendered conductor coverage drifted/,
  );
});

test("zero-terminal mechanical accessory produces a valid generated inventory without conductors", async (t) => {
  const options = await setup(t, ({ type, result }) => {
    Object.assign(type.types[0], {
      terminals: {},
      functions: {},
      circuitSymbols: {},
      connectorPorts: { COVER: { connector: "Mechanical cover only" } },
      connectionCoverage: {
        status: "complete",
        notes: "Mechanical accessory, no electrical terminals.",
      },
    });
    result.conformance = {
      terminalKeys: [],
      requiredTerminalKeys: [],
      fixedLinks: [],
      renderKind: "accessory",
    };
  });
  const report = await verifyJob(options);
  assert.equal(report.status, "verified-candidate", report.error);
  const compiled = await compileProject(report.outputs.fixture);
  assert.equal(
    compiled.ir.wires.length +
      compiled.ir.jumpers.length +
      compiled.ir.terminals.length,
    0,
  );
  assert(report.outputs.svgs.length > 0);
  assert(
    report.reviewFlags.some((flag) => flag.code === "no-circuit-coverage"),
  );
});

test("needs-evidence stays unapproved and does not generate a fixture", async (t) => {
  const options = await setup(t, ({ result }) => {
    result.decision = "needs-evidence";
    result.sources = [];
    result.conformance = null;
    result.unresolved = ["Missing official terminal diagram."];
  });
  const report = await verifyJob(options);
  assert.equal(report.status, "needs-evidence");
  assert.equal(report.outputs.fixture, undefined);
});

for (const [name, change, error] of [
  [
    "manufacturer identity",
    ({ type }) => {
      type.types[0].catalog.manufacturer = "Other";
    },
    /Manufacturer identity drift/,
  ],
  [
    "order identity",
    ({ type }) => {
      type.types[0].catalog.orderNumber = "OTHER";
    },
    /Order number identity drift/,
  ],
  [
    "terminal inventory drift",
    ({ result }) => {
      result.conformance.terminalKeys.pop();
    },
    /Terminal conformance inventory drift/,
  ],
  [
    "required terminal drift",
    ({ result }) => {
      result.conformance.requiredTerminalKeys = ["A"];
    },
    /Required-terminal conformance drift/,
  ],
  [
    "unknown fixed endpoint",
    ({ result }) => {
      result.conformance.fixedLinks[0].to = "MISSING";
    },
    /unknown terminal/,
  ],
  [
    "unattributed fixed link",
    ({ result }) => {
      result.conformance.fixedLinks[0].sourceId = "MISSING";
    },
    /evidence ID is unknown/,
  ],
  [
    "non-schema evidence",
    ({ result }) => {
      result.sources[0].authority = "reseller";
    },
    /allowed values/,
  ],
  [
    "multiple types",
    ({ type }) => {
      type.types.push(structuredClone(type.types[0]));
    },
    /Exactly one/,
  ],
  [
    "missing primary evidence",
    ({ result }) => {
      result.sources = [];
    },
    /primary manufacturer source/,
  ],
])
  test(`rejects ${name}`, async (t) => {
    const report = await verifyJob(await setup(t, change));
    assert.equal(report.status, "failed");
    assert.match(report.error, error);
  });

test("duplicate JSON keys fail strict parsing", async (t) => {
  const options = await setup(t);
  await writeFile(
    join(options.job, "result.json"),
    '{"format":"x","format":"y"}',
  );
  const report = await verifyJob(options);
  assert.equal(report.status, "failed");
  assert(
    report.checks.some(
      (check) => check.name === "candidate-schema" && check.status === "failed",
    ),
  );
});
