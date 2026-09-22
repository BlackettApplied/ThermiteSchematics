import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
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

export async function verifyJob({ job: jobPath, output: outputPath }) {
  const jobDir = resolve(jobPath),
    output = resolve(outputPath);
  assert(
    jobDir !== output &&
      !relative(output, jobDir)
        .split(/[\\/]/)
        .every((part) => part !== ".."),
    "Output must not be the job folder or an ancestor of it",
  );
  await mkdir(output, { recursive: true });
  const report = {
    status: "failed",
    checks: [],
    diagnostics: [],
    outputs: {},
    reviewFlags: [
      {
        code: "manufacturer-review-required",
        message:
          "Automatic structural/topology checks do not approve manufacturer facts, engineering suitability or installation safety.",
      },
      {
        code: "visual-review-required",
        message:
          "Generated geometry and selection are checked structurally; a human must review the packet at its intended print size.",
      },
    ],
    inputs: {},
  };
  const check = async (name, action) => {
    try {
      const value = await action();
      report.checks.push({ name, status: "passed" });
      return value;
    } catch (error) {
      report.checks.push({ name, status: "failed", message: error.message });
      throw error;
    }
  };
  const flag = (code, message) => report.reviewFlags.push({ code, message });
  const diagnostic = (stage, result) => {
    report.diagnostics.push({
      stage,
      diagnostics: result.diagnostics ?? [],
      ...(result.error ? { error: result.error } : {}),
    });
  };
  const snapshots = new Map();
  const read = async (name) => {
    const data = await readStrict(join(jobDir, name));
    snapshots.set(name, data.bytes);
    report.inputs[name] = digest(data.bytes);
    return data.value;
  };
  try {
    const job = await check("job-contract", async () => {
      const value = await read("job.json");
      for (const key of [
        "id",
        "expectedTypeId",
        "expectedManufacturer",
        "expectedOrderNumber",
      ])
        assert.equal(
          typeof value[key],
          "string",
          `job.${key} must be a string`,
        );
      for (const key of [
        "id",
        "expectedTypeId",
        "expectedManufacturer",
        "expectedOrderNumber",
      ])
        assert(value[key].trim(), `job.${key} must not be empty`);
      return value;
    });
    const result = await check("candidate-schema", async () => {
      const value = await read("result.json");
      const schema = (await readStrict(join(here, "candidate.schema.json")))
        .value;
      const validate = createAjv2020().compile(schema);
      assert(validate(value), json(validate.errors));
      assert.equal(
        value.sourcePartId,
        job.id,
        "Candidate sourcePartId does not match job identity",
      );
      same(
        value.sources.map((source) => source.id),
        new Set(value.sources.map((source) => source.id)),
        "Duplicate source evidence IDs",
      );
      for (const source of value.sources)
        assert.equal(
          new URL(source.url).protocol,
          "https:",
          "Evidence URL must be a valid HTTPS URL",
        );
      return value;
    });
    await check("research-note", async () => {
      const bytes = await readFile(join(jobDir, "research.md"));
      assert(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim(),
        "Empty research.md",
      );
      snapshots.set("research.md", bytes);
      report.inputs["research.md"] = digest(bytes);
    });
    for (const unresolved of result.unresolved)
      flag("unresolved-evidence", unresolved);
    if (result.decision === "needs-evidence") {
      report.status = "needs-evidence";
      flag("needs-evidence", result.summary);
    } else {
      const type = await check("identity-and-conformance", async () => {
        const document = await read("type.json");
        same(
          Object.keys(document),
          ["types"],
          "type.json must contain only types",
        );
        assert.equal(
          document.types.length,
          1,
          "Exactly one device type is required",
        );
        const value = document.types[0];
        assert.equal(value.kind, "device_type");
        assert.equal(value.id, job.expectedTypeId, "Type identity drift");
        assert.equal(
          value.catalog?.manufacturer,
          job.expectedManufacturer,
          "Manufacturer identity drift",
        );
        assert.equal(
          value.catalog?.orderNumber,
          job.expectedOrderNumber,
          "Order number identity drift",
        );
        assert(
          result.sources.length > 0,
          "At least one primary manufacturer source is required",
        );
        assert(result.conformance, "Candidate conformance is required");
        assert(
          ["partial", "complete"].includes(value.connectionCoverage?.status),
          "Explicit partial/complete connectionCoverage is required",
        );
        assert(
          value.connectionCoverage.notes?.trim(),
          "Connection coverage review notes are required",
        );
        const keys = Object.keys(value.terminals);
        same(
          keys,
          result.conformance.terminalKeys,
          "Terminal conformance inventory drift",
        );
        same(
          Object.entries(value.terminals)
            .filter(([, terminal]) => terminal.required === true)
            .map(([key]) => key),
          result.conformance.requiredTerminalKeys,
          "Required-terminal conformance drift",
        );
        const sourceIds = new Set(result.sources.map((source) => source.id));
        for (const link of result.conformance.fixedLinks) {
          assert(
            keys.includes(link.from) && keys.includes(link.to),
            "Fixed link refers to an unknown terminal",
          );
          assert.notEqual(
            link.from,
            link.to,
            "Fixed link must join distinct terminals",
          );
          assert(
            sourceIds.has(link.sourceId),
            "Fixed link evidence ID is unknown",
          );
        }
        if (result.conformance.renderKind === "accessory") {
          assert.equal(
            keys.length,
            0,
            "Accessory rendering requires zero terminals",
          );
          assert.equal(
            Object.keys(value.functions).length,
            0,
            "Accessory rendering requires zero circuit functions",
          );
        }
        if (!keys.length)
          assert.notEqual(
            result.conformance.renderKind,
            "circuit",
            "Zero-terminal types require accessory or overview rendering",
          );
        return value;
      });
      const {
        terminalKeys: keys,
        fixedLinks: links,
        requiredTerminalKeys: required,
        renderKind,
      } = result.conformance;
      if (type.connectionCoverage.status === "partial")
        flag("partial-model", type.connectionCoverage.notes);
      if (
        keys.length &&
        !result.sources.some((source) => source.diagramReviewed)
      )
        flag(
          "diagram-not-reviewed",
          "No electrical source records a reviewed manufacturer connection diagram.",
        );
      for (const source of result.sources.filter(
        (source) => !source.diagramReviewed,
      ))
        flag(
          "source-diagram-not-reviewed",
          `${source.id}: manufacturer diagram review is not recorded.`,
        );
      flag(
        "identity-document-review",
        "Exact order identity and declared document revision require comparison with the manufacturer source.",
      );
      if (keys.length)
        flag(
          "ratings-review",
          "Review every declared voltage/current unit and operating limit; missing ratings and ratings applicability are not inferred by this fixture.",
        );
      const unrated = keys.filter((key) => !type.terminals[key].rating);
      if (unrated.length)
        flag(
          "terminals-without-ratings",
          `No terminal rating declared for: ${unrated.join(", ")}. Review applicability against the source.`,
        );
      if (
        !result.sources.some(
          (source) => source.url === type.catalog.document?.url,
        )
      )
        flag(
          "catalog-document-evidence",
          "Catalog document URL is missing or does not match a listed manufacturer source.",
        );
      if (renderKind !== "circuit")
        flag(
          "no-circuit-coverage",
          "The generated packet is an inventory overview; it does not establish circuit-symbol coverage.",
        );

      const fixture = await mkdtemp(join(output, "fixture-"));
      report.outputs.fixture = fixture;
      const library = join(fixture, "candidate"),
        boundary = join(fixture, "boundary");
      await mkdir(library);
      await mkdir(boundary);
      const libraryName = type.id.split(":")[0];
      const boundaryName =
        libraryName === "batch-boundary"
          ? "batch-test-boundary"
          : "batch-boundary";
      const objects = [
        { kind: "device", uid: uid(1), designation: "D1", type: type.id },
      ];
      keys.forEach((key, index) => {
        objects.push({
          kind: "device",
          uid: uid(1000 + index),
          designation: `B${index + 1}`,
          type: `${boundaryName}:endpoint-${index + 1}`,
        });
        objects.push({
          kind: "wire",
          uid: uid(100000 + index),
          designation: `W${index + 1}`,
          endpoints: [
            { device: "D1", terminal: key },
            { device: `B${index + 1}`, terminal: "1" },
          ],
        });
      });
      links.forEach((link, index) =>
        objects.push({
          kind: "jumper",
          uid: uid(200000 + index),
          designation: `FIXED${index + 1}`,
          description: `${link.sourceId}: ${link.reason}`,
          endpoints: [
            { device: "D1", terminal: link.from },
            { device: "D1", terminal: link.to },
          ],
        }),
      );
      const sourcePath = join(fixture, "source.json"),
        typePath = join(library, "type.json");
      await writeFile(typePath, snapshots.get("type.json"));
      await writeFile(
        join(library, "library.json"),
        json({ name: libraryName, version: "0.1.0", sources: ["type.json"] }),
      );
      await writeFile(
        join(boundary, "library.json"),
        json({ name: boundaryName, version: "0.1.0", sources: ["types.json"] }),
      );
      await writeFile(
        join(boundary, "types.json"),
        json({
          types: keys.map((key, index) => ({
            kind: "device_type",
            id: `${boundaryName}:endpoint-${index + 1}`,
            description:
              "Synthetic unenergized test endpoint; no installed source or load",
            symbol: "thermite:terminal-strip",
            terminals: { 1: { role: type.terminals[key].role ?? "passive" } },
            functions: {},
            connectionCoverage: {
              status: "partial",
              notes:
                "Invented test boundary only. No installed supply, load, protection, conductor size or bonding is specified.",
            },
          })),
        }),
      );
      await writeFile(
        join(fixture, "system.json"),
        json({
          format: "electrical-system/0.1",
          project: {
            name: `${job.expectedOrderNumber} component verification`,
          },
          sources: ["source.json"],
          libraries: [
            { name: libraryName, version: "0.1.0", path: "candidate" },
            ...(keys.length
              ? [{ name: boundaryName, version: "0.1.0", path: "boundary" }]
              : []),
          ],
        }),
      );
      await writeFile(sourcePath, json({ objects }));
      const compile = async (stage, nextObjects = objects) => {
        await writeFile(sourcePath, json({ objects: nextObjects }));
        const value = await compileProject(fixture);
        diagnostic(stage, value);
        assert.equal(value.ok, true, json(value.diagnostics));
        return value;
      };
      const baseline = await check("compile-and-lock", async () => {
        const locked = await lockProject(fixture);
        diagnostic("lock", locked);
        assert.equal(locked.ok, true, json(locked.diagnostics));
        return compile("baseline");
      });
      for (const entry of baseline.diagnostics)
        flag("compiler-diagnostic", `${entry.code}: ${entry.message}`);
      await check("physical-net-partition", () =>
        assertNetPartition(baseline.ir, keys, links),
      );
      try {
        for (let index = 0; index < links.length; index++) {
          await check(`remove-fixed-link-${index + 1}`, async () => {
            const remaining = links.filter((_, position) => position !== index);
            const variant = await compile(
              `remove-fixed-link-${index + 1}`,
              objects.filter(
                (object) => object.designation !== `FIXED${index + 1}`,
              ),
            );
            assertNetPartition(variant.ir, keys, remaining);
          });
        }
        await check("remove-all-fixed-links", async () => {
          const value = await compile(
            "remove-all-fixed-links",
            objects.filter((object) => object.kind !== "jumper"),
          );
          assertNetPartition(value.ir, keys, []);
        });
        for (const key of required) {
          await check(`required-terminal-${key}`, async () => {
            const remaining = links.filter(
              (link) => link.from !== key && link.to !== key,
            );
            const value = await compile(
              `required-terminal-${key}`,
              objects.filter(
                (object) =>
                  !object.endpoints?.some(
                    (end) => end.device === "D1" && end.terminal === key,
                  ),
              ),
            );
            assertNetPartition(value.ir, keys, remaining, [key]);
            assert(
              value.diagnostics.some(
                (entry) =>
                  entry.code === "W903" &&
                  entry.message.startsWith("D1:") &&
                  entry.message.includes(key),
              ),
              `Disconnected required terminal ${key} did not produce W903`,
            );
          });
        }
        await check("stale-library-bytes", async () => {
          await writeFile(
            typePath,
            Buffer.concat([snapshots.get("type.json"), Buffer.from("\n")]),
          );
          const stale = await compileProject(fixture);
          diagnostic("stale-library", stale);
          assert.equal(stale.ok, false, "A stale byte lock was accepted");
          assert(
            stale.diagnostics.some((entry) => entry.code === "E108"),
            "Stale library bytes did not produce E108",
          );
        });
      } finally {
        await writeFile(typePath, snapshots.get("type.json"));
        await writeFile(sourcePath, json({ objects }));
      }
      const request =
        renderKind === "circuit"
          ? circuitRequest(type, keys, links, objects)
          : {
              format: "schematic-packet-request/0.1",
              page: { size: "tabloid" },
              views: [
                { format: "documentation-view-request/0.1", kind: "bom" },
                ...(keys.length
                  ? [
                      {
                        format: "documentation-view-request/0.1",
                        kind: "terminals",
                        device: "D1",
                      },
                    ]
                  : []),
              ],
            };
      await writeFile(join(fixture, "packet.request.json"), json(request));
      const packet = await check("render-packet", async () => {
        const value = await renderSchematicPacket(baseline.ir, request);
        diagnostic("render", value);
        assert.equal(value.ok, true, json(value.error));
        return value.value;
      });
      report.outputs.packet = join(output, "packet.json");
      report.outputs.html = join(output, "packet.html");
      report.outputs.svgs = [];
      await writeFile(report.outputs.packet, json(packet));
      await writeFile(report.outputs.html, packet.html);
      for (const sheet of packet.sheets) {
        const path = join(output, `sheet-${sheet.number}.svg`);
        await writeFile(path, sheet.svg);
        report.outputs.svgs.push(path);
      }
      await check("render-selection-and-manifest", () =>
        assertPacketCoverage(packet, baseline.ir, request, renderKind),
      );
      report.status = "verified-candidate";
    }
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
      "Usage: node scripts/library-batch/verify.mjs --job <jobdir> --output <checkdir>",
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
