import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { format, resolveConfig } from "prettier";
import { compileProject, lockProject } from "@thermite/compiler";
import { promoteJob, verifyPromotedExample } from "./promote.mjs";
import { assertNetPartition, verifyJob } from "./verify.mjs";

const json = (value) => JSON.stringify(value, null, 2) + "\n";
const here = dirname(fileURLToPath(import.meta.url));
const formatting = await resolveConfig(join(here, "../../package.json"));
const run = promisify(execFile);
const document = {
  url: "https://manufacturer.example/synthetic.pdf",
  title: "Synthetic promotion test",
  revision: "Test 1",
  pages: "1",
};

async function setup(t, { accessory = false, excluded = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "thermite-promotion-check-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const job = join(root, "job"),
    output = join(root, "output"),
    library = join(root, "library");
  await mkdir(job);
  await mkdir(library);
  await mkdir(join(library, "types"));
  await writeFile(
    join(library, "library.json"),
    json({
      name: "promotion-test",
      version: "1.2.3",
      sources: [excluded ? "types/excluded.json" : "types/*.json"],
    }),
  );
  if (excluded)
    await writeFile(join(library, "types/excluded.json"), json({ types: [] }));
  const keys = accessory ? [] : ["A", "B", "PE1", "PE2"];
  const fixedLinks = accessory
    ? []
    : [
        {
          from: "PE1",
          to: "PE2",
          sourceId: "manual",
          reason: "Synthetic factory link",
        },
      ];
  const conformance = {
    terminalKeys: keys,
    requiredTerminalKeys: accessory ? [] : ["PE1"],
    fixedLinks,
    renderKind: accessory ? "accessory" : "circuit",
  };
  const definition = {
    types: [
      {
        kind: "device_type",
        id: "promotion-test:part",
        description: "Synthetic promotion fixture",
        symbol: "thermite:io-module",
        catalog: {
          manufacturer: "Promotion Test",
          orderNumber: "SYNTHETIC-1",
          document,
        },
        connectionCoverage: {
          status: "partial",
          notes: "Synthetic test data; no real manufacturer facts.",
        },
        terminals: Object.fromEntries(
          keys.map((key) => [
            key,
            {
              role: "passive",
              connection_policy: "shared",
              ...(key === "PE1" ? { required: true } : {}),
            },
          ]),
        ),
        functions: accessory
          ? {}
          : {
              contact: {
                kind: "contact",
                normal_state: "open",
                terminals: ["A", "B"],
              },
              PE1: { kind: "bus", terminals: ["PE1"] },
              PE2: { kind: "bus", terminals: ["PE2"] },
            },
        circuitSymbols: accessory
          ? {}
          : { contact: "switch-no", PE1: "terminal", PE2: "terminal" },
      },
    ],
  };
  const data = {
    "job.json": {
      id: "synthetic-part",
      expectedTypeId: "promotion-test:part",
      expectedManufacturer: "Promotion Test",
      expectedOrderNumber: "SYNTHETIC-1",
      targetLibrary: "promotion-test",
      typeFileName: "part.json",
      source: { privateInventory: "NEVER-COPY-PRIVATE-INVENTORY" },
      pythonCommand: ["/private/do-not-copy"],
    },
    "type.json": definition,
    "result.json": {
      format: "thermite-component-candidate/0.1",
      sourcePartId: "synthetic-part",
      decision: "candidate",
      summary: "Synthetic test data only",
      sources: [
        {
          id: "manual",
          ...document,
          authority: "manufacturer",
          claims: ["Synthetic inventory"],
          diagramReviewed: true,
        },
      ],
      unresolved: [],
      conformance,
    },
  };
  for (const [name, value] of Object.entries(data))
    await writeFile(
      join(job, name),
      await format(json(value), { ...formatting, filepath: name }),
    );
  await writeFile(
    join(job, "research.md"),
    "# Synthetic test\n\nNo manufacturer facts.\n",
  );
  const verified = await verifyJob({ job, output });
  assert.equal(verified.status, "verified-candidate", verified.error);
  const report = join(output, "report.json"),
    review = join(root, "review.json");
  await writeFile(
    review,
    json({
      decision: "accept",
      inputs: verified.inputs,
      notes: "Coordinator checked this synthetic fixture and rendering.",
    }),
  );
  return {
    root,
    job,
    report,
    review,
    library,
    output,
    verified,
    conformance,
    example: join(library, "examples/part"),
  };
}

test("reviewed promotion uses canonical bytes/reference, keeps no candidate copy or private inventory, and rechecks locked nets/render", async (t) => {
  const options = await setup(t);
  const promoted = await promoteJob(options);
  assert.equal(promoted.status, "promoted");
  assert.equal(promoted.verification.status, "verified-promoted-example");
  assert.equal(promoted.verification.sheets, 1);
  assert(
    promoted.verification.diagnostics.some((entry) => entry.code === "W904"),
  );
  assert.equal(
    (await readFile(join(options.library, "types/part.json"))).equals(
      await readFile(join(options.job, "type.json")),
    ),
    true,
  );
  assert.equal(
    (await readFile(join(options.library, "research/part.md"))).equals(
      await readFile(join(options.job, "research.md")),
    ),
    true,
  );
  assert.deepEqual((await readdir(options.example)).sort(), [
    "boundary",
    "electrical-system.lock.json",
    "packet.request.json",
    "promotion.json",
    "source.json",
    "system.json",
  ]);
  const system = JSON.parse(
    await readFile(join(options.example, "system.json"), "utf8"),
  );
  assert.deepEqual(system.libraries[0], {
    name: "promotion-test",
    version: "1.2.3",
    path: "../..",
  });
  assert.deepEqual(system.sources, ["source.json"]);
  const metadataText = await readFile(
    join(options.example, "promotion.json"),
    "utf8",
  );
  assert(!metadataText.includes(options.root));
  assert(!metadataText.includes("NEVER-COPY"));
  assert(!metadataText.includes("/private/"));
  const metadata = JSON.parse(metadataText);
  assert.deepEqual(metadata.provenance.inputs, options.verified.inputs);
  for (const path of [
    join(options.library, "types/part.json"),
    join(options.library, "research/part.md"),
    ...[
      "source.json",
      "system.json",
      "packet.request.json",
      "promotion.json",
      "electrical-system.lock.json",
      "boundary/library.json",
      "boundary/types.json",
    ].map((name) => join(options.example, name)),
  ]) {
    const text = await readFile(path, "utf8");
    assert.equal(
      text,
      await format(text, { ...formatting, filepath: path }),
      `Non-stable generated formatting: ${path}`,
    );
  }
  const compiled = await compileProject(options.example);
  assert.equal(compiled.ok, true);
  assertNetPartition(
    compiled.ir,
    options.conformance.terminalKeys,
    options.conformance.fixedLinks,
  );
  // The committed helper must remain usable after private job/report files disappear.
  await rm(options.job, { recursive: true });
  await rm(options.output, { recursive: true });
  await rm(options.review);
  assert.equal(
    (await verifyPromotedExample({ example: options.example })).status,
    "verified-promoted-example",
  );
});

test("CLI accepts explicit review and handles a zero-terminal accessory", async (t) => {
  const options = await setup(t, { accessory: true });
  const result = await run(process.execPath, [
    join(here, "promote.mjs"),
    "--job",
    options.job,
    "--report",
    options.report,
    "--review",
    options.review,
    "--library",
    options.library,
  ]);
  assert.equal(result.stderr, "");
  assert.equal(JSON.parse(result.stdout).status, "promoted");
  const system = JSON.parse(
    await readFile(join(options.example, "system.json"), "utf8"),
  );
  assert.deepEqual(system.libraries, [
    { name: "promotion-test", version: "1.2.3", path: "../.." },
  ]);
  assert.equal(
    (await verifyPromotedExample({ example: options.example })).sheets,
    1,
  );
});

for (const name of ["job.json", "research.md", "result.json", "type.json"]) {
  test(`rejects changed ${name} bytes before writing canonical artifacts`, async (t) => {
    const options = await setup(t);
    const path = join(options.job, name);
    await writeFile(
      path,
      Buffer.concat([await readFile(path), Buffer.from("\n")]),
    );
    await assert.rejects(promoteJob(options), /Stale input hash/);
    assert.deepEqual(await readdir(join(options.library, "types")), []);
  });
}

for (const [name, change, expected] of [
  [
    "no accept decision",
    (record) => {
      record.decision = "defer";
    },
    /explicit coordinator accept/,
  ],
  [
    "empty notes",
    (record) => {
      record.notes = "  ";
    },
    /notes must not be empty/,
  ],
  [
    "stale review hashes",
    (record) => {
      record.inputs["type.json"] = "0".repeat(64);
    },
    /Review input hashes/,
  ],
]) {
  test(`rejects ${name}`, async (t) => {
    const options = await setup(t);
    const review = JSON.parse(await readFile(options.review, "utf8"));
    change(review);
    await writeFile(options.review, json(review));
    await assert.rejects(promoteJob(options), expected);
  });
}

test("rejects needs-evidence/failed verification status", async (t) => {
  const options = await setup(t);
  const report = JSON.parse(await readFile(options.report, "utf8"));
  report.status = "needs-evidence";
  await writeFile(options.report, json(report));
  await assert.rejects(promoteJob(options), /verified-candidate report/);
});

for (const target of ["types/part.json", "research/part.md", "examples/part"]) {
  test(`refuses existing ${target} without overwriting it`, async (t) => {
    const options = await setup(t);
    const path = join(options.library, target);
    await mkdir(dirname(path), { recursive: true });
    if (target.startsWith("examples/")) await mkdir(path);
    else await writeFile(path, "Existing user artifact\n");
    await assert.rejects(promoteJob(options), /already exists/);
    if (!target.startsWith("examples/"))
      assert.equal(await readFile(path, "utf8"), "Existing user artifact\n");
  });
}

test("rejects a verified fixture edited after report generation", async (t) => {
  const options = await setup(t);
  const path = join(options.verified.outputs.fixture, "packet.request.json");
  await writeFile(path, (await readFile(path, "utf8")) + "\n");
  await assert.rejects(
    promoteJob(options),
    /Verified fixture changed: packet.request.json/,
  );
  assert.deepEqual(await readdir(join(options.library, "types")), []);
});

test("rejects a rendered sheet edited after coordinator review", async (t) => {
  const options = await setup(t);
  const path = options.verified.outputs.svgs[0];
  await writeFile(path, (await readFile(path, "utf8")) + "\n");
  await assert.rejects(promoteJob(options), /Verified output changed: sheet 1/);
  assert.deepEqual(await readdir(join(options.library, "types")), []);
});

test("rolls back owned artifacts when canonical manifest does not include the type", async (t) => {
  const options = await setup(t, { excluded: true });
  await assert.rejects(promoteJob(options));
  assert.deepEqual(await readdir(join(options.library, "types")), [
    "excluded.json",
  ]);
  assert.deepEqual(await readdir(join(options.library, "research")), []);
  assert.deepEqual(await readdir(join(options.library, "examples")), []);
  assert(
    !(await readdir(options.library)).includes(".library-batch-promotion.lock"),
  );
});

for (const [target, error] of [
  ["types/part.json", /Canonical type hash changed/],
  ["research/part.md", /Canonical research hash changed/],
  ["examples/part/source.json", /Promoted fixture hash changed/],
  ["examples/part/system.json", /Promoted fixture hash changed/],
]) {
  test(`canonical helper rejects changed ${target}`, async (t) => {
    const options = await setup(t);
    await promoteJob(options);
    const path = join(options.library, target);
    await writeFile(path, (await readFile(path, "utf8")) + "\n");
    await assert.rejects(
      verifyPromotedExample({ example: options.example }),
      error,
    );
  });
}

test("canonical helper rejects stale locks and permits intentional relocking after another library type is added", async (t) => {
  const options = await setup(t);
  await promoteJob(options);
  const other = JSON.parse(
    await readFile(join(options.library, "types/part.json"), "utf8"),
  );
  other.types[0].id = "promotion-test:other";
  await writeFile(join(options.library, "types/other.json"), json(other));
  await assert.rejects(
    verifyPromotedExample({ example: options.example }),
    /E107/,
  );
  assert.equal((await lockProject(options.example)).ok, true);
  assert.equal(
    (await verifyPromotedExample({ example: options.example })).status,
    "verified-promoted-example",
  );
});
