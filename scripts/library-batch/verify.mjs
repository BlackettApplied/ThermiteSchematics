import { createVerificationContext } from "./verify-context.mjs";
import {
  readJobContract,
  readCandidateContract,
  readResearchNote,
} from "./verify-contracts.mjs";
import { verifyCandidate } from "./verify-candidate.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileProject, lockProject } from "@thermite/compiler";
import { renderSchematicPacket } from "@thermite/render";
import { createAjv2020, parseJson } from "@thermite/schema";
import { DOMParser } from "linkedom";

const here = dirname(fileURLToPath(import.meta.url));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (value) => JSON.stringify(value, null, 2) + "\n";
const sorted = (values) => [...values].sort();
const tid = (device, key) => JSON.stringify([device, key]);
const uid = (n) => `cba70000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const same = (actual, expected, message) =>
  assert.deepEqual(sorted(actual), sorted(expected), message);

async function readStrict(path) {
  const bytes = await readFile(path);
  const parsed = parseJson(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    path,
  );
  assert.equal(parsed.diagnostics.length, 0, json(parsed.diagnostics));
  assert.notEqual(parsed.value, undefined, `${path}: no JSON value`);
  return { bytes, value: parsed.value };
}

function unionFind(keys) {
  const parents = new Map(keys.map((key) => [key, key]));
  const root = (key) => {
    assert(parents.has(key), `Unknown partition endpoint ${key}`);
    if (parents.get(key) !== key) parents.set(key, root(parents.get(key)));
    return parents.get(key);
  };
  return { root, union: (a, b) => parents.set(root(a), root(b)) };
}

/** The oracle never consults functions, connector pins, or compiled nets to derive continuity. */
export function assertNetPartition(
  ir,
  terminalKeys,
  fixedLinks,
  disconnected = [],
) {
  const detached = new Set(disconnected);
  const endpoints = terminalKeys.flatMap((key, index) => [
    tid("D1", key),
    tid(`B${index + 1}`, "1"),
  ]);
  const expected = unionFind(endpoints);
  terminalKeys.forEach((key, index) => {
    if (!detached.has(key))
      expected.union(tid("D1", key), tid(`B${index + 1}`, "1"));
  });
  for (const link of fixedLinks)
    expected.union(tid("D1", link.from), tid("D1", link.to));
  const names = new Map(
    ir.devices.map((device) => [device.uid, device.designation]),
  );
  const actual = new Map();
  for (const net of ir.nets) {
    for (const terminal of net.terminalIds) {
      const key = tid(names.get(terminal.deviceUid), terminal.terminalKey);
      assert(
        !actual.has(key),
        `Endpoint appears in multiple physical nets: ${key}`,
      );
      actual.set(key, net.id);
    }
  }
  same(actual.keys(), endpoints, "Compiled endpoint inventory drifted");
  for (let a = 0; a < endpoints.length; a++) {
    for (let b = a; b < endpoints.length; b++) {
      assert.equal(
        actual.get(endpoints[a]) === actual.get(endpoints[b]),
        expected.root(endpoints[a]) === expected.root(endpoints[b]),
        `Physical net partition mismatch: ${endpoints[a]} / ${endpoints[b]}; only explicit wires and declared fixed links may join nets`,
      );
    }
  }
}

function circuitRequest(type, keys, links, objects) {
  // Function membership groups the drawing, but is never used by the net oracle.
  const groups = unionFind(keys);
  for (const fn of Object.values(type.functions)) {
    for (const key of fn.terminals.slice(1)) groups.union(fn.terminals[0], key);
  }
  for (const link of links) groups.union(link.from, link.to);
  for (const relation of type.internal_relations ?? []) {
    if (relation.relation !== "ganged_with") continue;
    const from = type.functions[relation.from]?.terminals[0];
    const to = type.functions[relation.to]?.terminals[0];
    if (from && to) groups.union(from, to);
  }
  const selections = new Map();
  const get = (id) => {
    if (!selections.has(id))
      selections.set(id, {
        id: `g${selections.size + 1}`,
        label: "",
        functions: [],
        conductors: [],
      });
    return selections.get(id);
  };
  for (const key of keys) get(groups.root(key));
  for (const [key, fn] of Object.entries(type.functions)) {
    get(
      fn.terminals.length ? groups.root(fn.terminals[0]) : `function:${key}`,
    ).functions.push({ device: { by: "designation", value: "D1" }, key });
  }
  for (const conductor of objects.filter((object) =>
    ["wire", "jumper"].includes(object.kind),
  )) {
    const terminal = conductor.endpoints.find(
      (endpoint) => endpoint.device === "D1",
    ).terminal;
    get(groups.root(terminal)).conductors.push(conductor.designation);
  }
  for (const group of selections.values()) {
    group.label =
      group.functions.map((fn) => fn.key).join(" / ") ||
      "Explicit terminal connections";
  }
  return {
    format: "schematic-packet-request/0.1",
    page: { size: "tabloid", orientation: "landscape" },
    views: [
      {
        format: "circuit-view-request/0.1",
        title: `${type.catalog.orderNumber} / structural component check`,
        columns: 2,
        groups: [...selections.values()],
        notes: [
          "Synthetic unenergized test boundaries. No installed circuit, protection or external bonding is specified.",
          "Functions and connector metadata never imply continuity. Fixed links are explicit source jumpers requiring manufacturer review.",
        ],
      },
    ],
  };
}

export function assertPacketCoverage(packet, ir, request, renderKind) {
  assert.equal(packet.format, "schematic-packet/0.1");
  assert(packet.sheets.length > 0, "Renderer returned no sheets");
  assert(packet.html.includes("<html"), "Renderer returned no HTML packet");
  const terminals = new Set(),
    functions = new Set(),
    conductors = new Set();
  for (const [index, sheet] of packet.sheets.entries()) {
    assert.equal(sheet.number, index + 1, "Sheet manifest order drifted");
    const doc = new DOMParser().parseFromString(sheet.svg, "image/svg+xml");
    const svg = doc.documentElement;
    assert.equal(svg.localName, "svg", "Invalid SVG root");
    assert.equal(Number(svg.getAttribute("data-sheet")), sheet.number);
    assert.deepEqual(
      svg.getAttribute("viewBox").split(/\s+/).map(Number),
      [0, 0, packet.page.widthMm, packet.page.heightMm],
      "SVG paper bounds drifted",
    );
    assert(!/\b(?:NaN|Infinity)\b/.test(sheet.svg), "Non-finite SVG geometry");
    assert.equal(
      doc.querySelectorAll("clipPath, svg svg").length,
      0,
      "Circuit/documentation sheets must not hide content in clipped viewports",
    );
    for (const reference of sheet.references) {
      for (const [key, maximum] of [
        ["xMm", packet.page.widthMm],
        ["yMm", packet.page.heightMm],
      ]) {
        if (reference[key] !== undefined)
          assert(
            Number.isFinite(reference[key]) &&
              reference[key] >= 0 &&
              reference[key] <= maximum,
            "Sheet reference lies outside paper",
          );
      }
    }
    for (const element of doc.querySelectorAll("[data-terminal-id]"))
      terminals.add(element.getAttribute("data-terminal-id"));
    for (const element of doc.querySelectorAll("[data-function-id]"))
      functions.add(element.getAttribute("data-function-id"));
    for (const element of doc.querySelectorAll("[data-conductor-designation]"))
      conductors.add(element.getAttribute("data-conductor-designation"));
    for (const link of sheet.continuations)
      assert(
        packet.sheets.some((other) => other.number === link.toSheet),
        "Broken continuation reference",
      );
  }
  if (renderKind === "circuit") {
    const selected = request.views.flatMap((view) => view.groups);
    const device = ir.devices.find((entry) => entry.designation === "D1");
    const expectedFunctions = ir.functions
      .filter((fn) => fn.id.deviceUid === device.uid)
      .map((fn) => fn.id.functionKey);
    const expectedConductors = [...ir.wires, ...ir.jumpers].map(
      (entry) => entry.designation,
    );
    same(
      selected.flatMap((group) => group.functions.map((fn) => fn.key)),
      expectedFunctions,
      "Circuit request omitted or repeated a function",
    );
    same(
      selected.flatMap((group) => group.conductors),
      expectedConductors,
      "Circuit request omitted or repeated a conductor",
    );
    same(
      functions,
      expectedFunctions.map((key) => tid(device.uid, key)),
      "Rendered function coverage drifted",
    );
    same(conductors, expectedConductors, "Rendered conductor coverage drifted");
    same(
      terminals,
      ir.terminals.map((terminal) =>
        tid(terminal.id.deviceUid, terminal.id.terminalKey),
      ),
      "Rendered terminal/boundary coverage drifted",
    );
  } else {
    assert.equal(
      conductors.size,
      0,
      "Overview/accessory documentation invented circuit conductors",
    );
  }
}

const verificationSupport = {
  here,
  readStrict,
  digest,
  json,
  same,
  uid,
  circuitRequest,
  assertNetPartition,
  assertPacketCoverage,
  createAjv2020,
  compileProject,
  lockProject,
  renderSchematicPacket,
};
export async function verifyJob({ job: jobPath, output: outputPath }) {
  const context = await createVerificationContext(
    jobPath,
    outputPath,
    verificationSupport,
  );
  const { check, report, output, snapshots, jobDir } = context;
  try {
    const job = await check("job-contract", () => readJobContract(context));
    const result = await check("candidate-schema", () =>
      readCandidateContract({ ...context, job }),
    );
    await check("research-note", () => readResearchNote(context));
    await verifyCandidate(context, job, result);
    await check("input-snapshot-unchanged", async () => {
      for (const [name, bytes] of snapshots)
        assert(
          (await readFile(join(jobDir, name))).equals(bytes),
          `${name} changed during verification`,
        );
    });
  } catch (error) {
    report.status = "failed";
    report.error = error.message;
  }
  await writeFile(join(output, "report.json"), json(report));
  return report;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = process.argv.slice(2);
    assert.equal(
      args.length,
      4,
      "Usage: bun scripts/library-batch/verify.mjs --job <jobdir> --output <checkdir>",
    );
    const options = new Map([
      [args[0], args[1]],
      [args[2], args[3]],
    ]);
    assert(
      options.has("--job") && options.has("--output"),
      "Both --job and --output are required",
    );
    const report = await verifyJob({
      job: options.get("--job"),
      output: options.get("--output"),
    });
    console.log(
      json({
        status: report.status,
        report: join(resolve(options.get("--output")), "report.json"),
      }).trim(),
    );
    process.exitCode = report.status === "failed" ? 1 : 0;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
