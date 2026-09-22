import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const prepare = join(dirname(fileURLToPath(import.meta.url)), "prepare.mjs");
const json = (value) => JSON.stringify(value, null, 2) + "\n";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "thermite-prepare-check-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const batch = join(root, "batch");
  const inventoryPath = join(root, "inventory.json");
  const selectionPath = join(root, "selection.json");
  const cli = join(root, "never-run-worker");
  writeFileSync(cli, "#!/bin/sh\nexit 97\n", { mode: 0o700 });
  const inventory = {
    source: "Synthetic preparation checks; no manufacturer facts.",
    parts: [1, 2].map((number) => ({
      id: `test-${number}`,
      status: "research-needed",
      make: "Synthetic",
      orderNumber: `TEST-${number}`,
    })),
  };
  const selection = {
    jobs: [1, 2].map((number) => ({
      id: `test-${number}`,
      backend: number === 1 ? "claude" : "codex",
      library: "synthetic",
      slug: `test-${number}`,
    })),
  };
  function run(extra = []) {
    writeFileSync(inventoryPath, json(inventory));
    writeFileSync(selectionPath, json(selection));
    return spawnSync(
      process.execPath,
      [
        prepare,
        "--inventory",
        inventoryPath,
        "--selection",
        selectionPath,
        "--batch",
        batch,
        "--python",
        process.execPath,
        "--claude-cli",
        cli,
        "--codex-cli",
        cli,
        "--codex-model",
        "synthetic-never-called",
        ...extra,
      ],
      { encoding: "utf8" },
    );
  }
  return { root, batch, inventory, selection, run };
}

function rejectedWithoutOutput(f, pattern, extra) {
  const outcome = f.run(extra);
  assert.notEqual(outcome.status, 0, outcome.stdout);
  assert.match(outcome.stderr, pattern);
  assert.equal(
    existsSync(f.batch),
    false,
    "Preparation created partial output",
  );
}

test("prepares both backends and copies all references without launching workers", (t) => {
  const f = fixture(t);
  const reference = join(f.root, "synthetic-note.txt");
  writeFileSync(reference, "Synthetic reference bytes\n");
  f.selection.jobs[1].referenceFiles = [reference];
  const outcome = f.run();
  assert.equal(outcome.status, 0, outcome.stderr);
  assert.equal(JSON.parse(outcome.stdout).jobs, 2);
  const queue = JSON.parse(readFileSync(join(f.batch, "queue.json"), "utf8"));
  assert.deepEqual(
    queue.jobs.map((job) => job.backend),
    ["claude", "codex"],
  );
  for (const queued of queue.jobs) {
    const job = JSON.parse(
      readFileSync(join(queued.directory, "job.json"), "utf8"),
    );
    assert.equal(job.id, queued.id);
    assert.equal(job.expectedTypeId, `synthetic:${queued.id}`);
    assert.equal(
      existsSync(
        join(queued.directory, "reference", "device-type.schema.json"),
      ),
      true,
    );
    assert.equal(
      existsSync(join(queued.directory, "worker.stdout.jsonl")),
      false,
    );
    assert.equal(existsSync(join(queued.directory, "result.json")), false);
    assert.equal(
      readFileSync(join(queued.directory, "AGENTS.md"), "utf8"),
      readFileSync(join(queued.directory, "WORKER.md"), "utf8"),
    );
  }
  assert.equal(
    readFileSync(
      join(queue.jobs[1].directory, "references", "synthetic-note.txt"),
      "utf8",
    ),
    "Synthetic reference bytes\n",
  );
  assert.equal(existsSync(join(f.batch, "status.json")), false);
});

for (const name of [
  "queue.json",
  "status.json",
  ".runner.lock.json",
  ".runner.lock.recovery",
])
  test(`refuses existing ${name} before creating job folders or changing bytes`, (t) => {
    const f = fixture(t);
    mkdirSync(f.batch);
    const marker = join(f.batch, name);
    writeFileSync(marker, "Existing batch marker\n");
    const outcome = f.run();
    assert.notEqual(outcome.status, 0);
    assert.match(outcome.stderr, /Batch already contains/);
    assert.equal(readFileSync(marker, "utf8"), "Existing batch marker\n");
    assert.deepEqual(readdirSync(f.batch), [name]);
  });

test("a second disjoint selection cannot replace a prepared queue", (t) => {
  const f = fixture(t);
  f.selection.jobs = [f.selection.jobs[0]];
  assert.equal(f.run().status, 0);
  const original = readFileSync(join(f.batch, "queue.json"));
  f.selection.jobs = [
    { id: "test-2", backend: "codex", library: "synthetic", slug: "test-2" },
  ];
  const outcome = f.run();
  assert.notEqual(outcome.status, 0);
  assert.match(outcome.stderr, /Batch already contains/);
  assert(readFileSync(join(f.batch, "queue.json")).equals(original));
  assert.deepEqual(readdirSync(join(f.batch, "jobs")), ["test-1"]);
});

test(
  "a dangling queue symlink still blocks preparation",
  { skip: process.platform === "win32" },
  (t) => {
    const f = fixture(t);
    mkdirSync(f.batch);
    symlinkSync(join(f.root, "missing-target"), join(f.batch, "queue.json"));
    const outcome = f.run();
    assert.notEqual(outcome.status, 0);
    assert.match(outcome.stderr, /Batch already contains/);
    assert.deepEqual(readdirSync(f.batch), ["queue.json"]);
  },
);

for (const [name, change, error] of [
  [
    "invalid second backend",
    (f) => {
      f.selection.jobs[1].backend = "unknown";
    },
    /Unknown backend/,
  ],
  [
    "duplicate type target",
    (f) => {
      f.selection.jobs[1].slug = "test-1";
    },
    /Duplicate type target/,
  ],
  [
    "duplicate job identity",
    (f) => {
      f.selection.jobs[1].id = "test-1";
    },
    /duplicate job ID/,
  ],
  [
    "case-insensitive job directory collision",
    (f) => {
      f.selection.jobs[1].id = "TEST-1";
    },
    /duplicate job ID/,
  ],
  [
    "ambiguous inventory identity",
    (f) => {
      f.inventory.parts.push({ ...f.inventory.parts[1] });
    },
    /Inventory identity must be unique/,
  ],
  [
    "invalid manufacturer override",
    (f) => {
      f.selection.jobs[1].manufacturer = " ";
    },
    /Invalid manufacturer/,
  ],
  [
    "invalid hints",
    (f) => {
      f.selection.jobs[1].hints = "not-an-array";
    },
    /Hints must be/,
  ],
  [
    "invalid reference list",
    (f) => {
      f.selection.jobs[1].referenceFiles = "not-an-array";
    },
    /Reference files must be/,
  ],
  [
    "missing second-job reference",
    (f) => {
      f.selection.jobs[1].referenceFiles = [join(f.root, "missing.pdf")];
    },
    /ENOENT/,
  ],
  [
    "directory used as a reference",
    (f) => {
      f.selection.jobs[1].referenceFiles = [f.root];
    },
    /Expected a readable file/,
  ],
  [
    "empty selection",
    (f) => {
      f.selection.jobs = [];
    },
    /nonempty jobs array/,
  ],
])
  test(`rejects ${name} without creating any batch output`, (t) => {
    const f = fixture(t);
    change(f);
    rejectedWithoutOutput(f, error);
  });

test("reference basename collisions are rejected before copying either reference", (t) => {
  const f = fixture(t);
  const first = join(f.root, "first");
  const second = join(f.root, "second");
  mkdirSync(first);
  mkdirSync(second);
  const a = join(first, "manual.pdf"),
    b = join(second, "MANUAL.PDF");
  writeFileSync(a, "Synthetic A");
  writeFileSync(b, "Synthetic B");
  f.selection.jobs[1].referenceFiles = [a, b];
  rejectedWithoutOutput(f, /Reference filename collision/);
});

test("an existing later job directory does not leave an earlier job partially prepared", (t) => {
  const f = fixture(t);
  const existing = join(f.batch, "jobs", "test-2");
  mkdirSync(existing, { recursive: true });
  writeFileSync(join(existing, "preserve.txt"), "Existing job\n");
  const outcome = f.run();
  assert.notEqual(outcome.status, 0);
  assert.match(outcome.stderr, /Job directory exists/);
  assert.deepEqual(readdirSync(join(f.batch, "jobs")), ["test-2"]);
  assert.equal(
    readFileSync(join(existing, "preserve.txt"), "utf8"),
    "Existing job\n",
  );
  assert.equal(existsSync(join(f.batch, "queue.json")), false);
});

test("missing Python and PDF runtime paths are rejected before output", (t) => {
  const f = fixture(t);
  rejectedWithoutOutput(f, /ENOENT/, [
    "--python",
    join(f.root, "missing-python"),
  ]);
  rejectedWithoutOutput(f, /ENOENT/, [
    "--pdf-module-path",
    join(f.root, "missing-pdf-runtime"),
  ]);
});
