import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  analyzeCompleteness,
  compileProject,
  lockProject,
  serializeIr,
} from "@thermite/compiler";
import {
  createProjectSnapshot,
  createQueryEngine,
  reviewProject,
  serializeQueryResult,
} from "@thermite/query";
import { completenessCsv } from "../src/alpha-diagnostics.js";

const execFile = promisify(execFileCallback),
  temporary: string[] = [];
const cli = resolve("packages/cli/dist/thermite-bin.js");
afterEach(async () => {
  for (const path of temporary.splice(0))
    await rm(path, { recursive: true, force: true });
});
async function fixture() {
  const p = await mkdtemp(join(tmpdir(), "thermite-completeness-"));
  temporary.push(p);
  await cp("packages/cli/fixtures/completeness", p, { recursive: true });
  const source = JSON.parse(await readFile(join(p, "source.json"), "utf8"));
  const library = JSON.parse(
    await readFile(join(p, "library/types.json"), "utf8"),
  );
  async function compile() {
    await writeFile(
      join(p, "source.json"),
      JSON.stringify(source, null, 2) + "\n",
    );
    await writeFile(
      join(p, "library/types.json"),
      JSON.stringify(library, null, 2) + "\n",
    );
    const locked = await lockProject(p);
    if (!locked.ok) return locked;
    return compileProject(p);
  }
  async function valid() {
    const c = await compile();
    if (!c.ok) throw new Error(JSON.stringify(c));
    return c;
  }
  return { p, source, library, compile, valid };
}

it("inventories all points, distinguishes dangling cores, and never clears required warnings with an unused note", async () => {
  const f = await fixture(),
    c = await f.valid(),
    r = analyzeCompleteness(c.ir);
  expect(r.counts).toMatchObject({
    devices: 4,
    terminals: 10,
    ports: 2,
    requiredMissing: 4,
    partialModels: 1,
    unreviewedModels: 1,
    dangling: 1,
  });
  expect(
    r.findings
      .filter((x) => x.code === "W903")
      .map((x) => `${x.designation}.${x.key}`),
  ).toEqual(["D1.N", "D2.N", "D2.S", "HMI1.ETH1"]);
  const d1 = r.devices.find((d) => d.designation === "D1")!;
  expect(d1.connections.find((t) => t.key === "P")).toMatchObject({
    connection: "connected",
    required: true,
    review: { status: "deferred" },
  });
  expect(d1.connections.find((t) => t.key === "N")).toMatchObject({
    connection: "dangling",
    connections: ["CB1/1"],
  });
  expect(
    r.findings.some((x) => x.code === "W905" && x.designation === "D1"),
  ).toBe(true);
  expect(
    r.findings.some(
      (x) => x.code === "W905" && x.designation === "D2" && x.key === "N",
    ),
  ).toBe(true);
  expect(r.findings.some((x) => x.code === "I002" && x.key === "SP")).toBe(
    true,
  );
  // Two instances of a type retain independent diagnostics; multiple missing pins are aggregated, not lost by diagnostic normalization.
  expect(c.diagnostics.filter((d) => d.code === "W903")).toHaveLength(3);
  expect(
    c.diagnostics.find((d) => d.code === "W903" && d.message.startsWith("D2:"))!
      .related,
  ).toHaveLength(2);
  expect(
    r.findings.find((x) => x.designation === "D1" && x.key === "N")!
      .definitionSource.jsonPointer,
  ).toBe("/types/0/terminals/N");
  expect(serializeIr(c.ir)).toContain('"required": true');
  const shuffled = structuredClone(c.ir);
  shuffled.devices.reverse();
  shuffled.terminals.reverse();
  shuffled.cables.reverse();
  shuffled.relations.reverse();
  expect(analyzeCompleteness(shuffled)).toEqual(r);
  r.devices[0]!.connections[0]!.key = "mutated";
  expect(analyzeCompleteness(c.ir).devices[0]!.connections[0]!.key).not.toBe(
    "mutated",
  );
});

it("counts wires, jumpers, complete spare cores and communication links without joining function terminals", async () => {
  const f = await fixture();
  const d2 = f.source.objects.find((o: any) => o.designation === "D2");
  d2.connectionReview.terminals.N = {
    status: "required",
    reason: "Return is required.",
  };
  f.source.objects.push({
    kind: "jumper",
    uid: "ef25feb1-f655-4c1c-9e88-41e39a9daeba",
    endpoints: [
      { device: "D2", terminal: "N" },
      { device: "D2", terminal: "S" },
    ],
  });
  const cable = f.source.objects.find((o: any) => o.kind === "cable");
  cable.conductors[0].endpoints[1] = { device: "D2", terminal: "SP" };
  f.source.objects.push(
    {
      kind: "device",
      uid: "755c52f4-ed60-41bc-a9b9-89d9efc8def6",
      designation: "HMI2",
      type: "audit:hmi",
    },
    {
      kind: "relation",
      uid: "a0d034cb-dd43-4cbe-9f7e-9e2e05129497",
      relation: "associated_with",
      from: { device: "HMI1" },
      to: { device: "HMI2" },
      connection: {
        medium: "ethernet",
        protocol: "Test",
        fromPort: "ETH1",
        toPort: "ETH1",
      },
    },
  );
  const c = await f.valid(),
    r = analyzeCompleteness(c.ir);
  expect(r.counts.requiredMissing).toBe(0);
  expect(
    r.findings.some(
      (x) => x.code === "W905" && x.designation === "D2" && x.key === "SP",
    ),
  ).toBe(true);
  expect(
    r.devices.find((d) => d.designation === "HMI1")!.connections[0]!.connection,
  ).toBe("connected");
  expect(r.limitations.join(" ")).toContain("not that supply");
  // A jumper to an isolated signal pin satisfies connection presence only, not a source path.
  const net = c.ir.nets.find((n) =>
    n.terminalIds.some((t) => t.deviceUid === d2.uid && t.terminalKey === "N"),
  )!;
  expect(net.terminalIds.map((t) => t.terminalKey).sort()).toEqual(["N", "S"]);
});

it.each([
  "unknown-terminal",
  "unknown-port",
  "required-string",
  "missing-reason",
  "blank-reason",
  "unknown-status",
  "coverage-notes",
  "coverage-status",
])("rejects invalid metadata: %s", async (problem) => {
  const f = await fixture(),
    d = f.source.objects[1],
    t = f.library.types[0];
  if (problem === "unknown-terminal")
    d.connectionReview.terminals.TYPO = { status: "required", reason: "Typo." };
  if (problem === "unknown-port")
    d.connectionReview.ports = {
      TYPO: { status: "required", reason: "Typo." },
    };
  if (problem === "required-string") t.terminals.P.required = "yes";
  if (problem === "missing-reason")
    delete d.connectionReview.terminals.P.reason;
  if (problem === "blank-reason") d.connectionReview.terminals.P.reason = "  ";
  if (problem === "unknown-status")
    d.connectionReview.terminals.P.status = "ignored";
  if (problem === "coverage-notes") delete t.connectionCoverage.notes;
  if (problem === "coverage-status") t.connectionCoverage.status = "probably";
  const c = await f.compile();
  expect(c.ok).toBe(false);
  expect(c.diagnostics.some((d) => d.severity === "error")).toBe(true);
  if (problem.startsWith("unknown-") && problem !== "unknown-status")
    expect(c.diagnostics.some((d) => d.code === "E205")).toBe(true);
});

it("preserves optional legacy fields, exposes metadata through inspection and includes it in semantic review", async () => {
  const f = await fixture(),
    before = await f.valid();
  const inspected = createQueryEngine(before.ir).inspect({
    by: "designation",
    value: "D1",
  });
  expect(inspected.ok).toBe(true);
  if (inspected.ok) {
    expect(inspected.value.object).toMatchObject({
      connectionCoverage: { status: "complete" },
      connectionReview: { terminals: { P: { status: "deferred" } } },
      terminals: expect.arrayContaining([
        expect.objectContaining({ required: true }),
      ]),
    });
    expect(serializeQueryResult(inspected.value)).toContain('"required": true');
  }
  f.library.types[0].terminals.P.required = false;
  f.source.objects[1].connectionReview.terminals.P.reason =
    "Updated review reason.";
  const after = await f.valid(),
    review = reviewProject(
      createProjectSnapshot(before.ir),
      createProjectSnapshot(after.ir),
    );
  expect(JSON.stringify(review)).toContain("required");
  expect(JSON.stringify(review)).toContain("connectionReview");
  for (const t of f.library.types) {
    delete t.connectionCoverage;
    for (const point of Object.values(t.terminals ?? {}) as any[])
      delete point.required;
  }
  for (const d of f.source.objects) delete d.connectionReview;
  const legacy = await f.valid();
  expect(legacy.diagnostics).toEqual([]);
  expect(analyzeCompleteness(legacy.ir).counts.unreviewedModels).toBe(4);
});

it("supports read-only CLI JSON, text, CSV and exact filters while preserving diagnostics and output guards", async () => {
  const f = await fixture();
  await f.valid();
  const run = (...args: string[]) =>
    execFile(process.execPath, [cli, "diagnostics", "--project", f.p, ...args]);
  const original = await readFile(join(f.p, "source.json"));
  const json = await run("--json", "--location", "HMI console"),
    r = JSON.parse(json.stdout);
  expect(r.counts.devices).toBe(2);
  expect(
    JSON.parse(json.stderr).diagnostics.some((d: any) => d.code === "W903"),
  ).toBe(true);
  const text = await run("--device", "HMI1");
  expect(text.stdout).toContain("Power connector");
  expect(text.stdout).toContain("W904");
  const textOutput = join(f.p, "audit.txt");
  await run("--output", textOutput);
  expect(await readFile(textOutput, "utf8")).toContain(
    "connection completeness",
  );
  const output = join(f.p, "audit.csv");
  await run("--output", output);
  expect(await readFile(output, "utf8")).toContain(
    '"D1","Main cabinet","terminal","N","true","dangling"',
  );
  await expect(
    run("--device", "DOES-NOT-EXIST", "--json"),
  ).rejects.toMatchObject({ code: 1, stdout: "" });
  await expect(
    run("--device", "D1", "--location", "HMI console"),
  ).rejects.toMatchObject({ code: 1 });
  await expect(run("--output", join(f.p, "source.json"))).rejects.toMatchObject(
    { code: 2 },
  );
  await expect(run("--json", "-o", output)).rejects.toMatchObject({ code: 2 });
  expect(await readFile(join(f.p, "source.json"))).toEqual(original);
  r.devices[0].designation = "=FORMULA()";
  expect(completenessCsv(r)).toContain("'=FORMULA()");
  const invalid = f.source.objects[1];
  invalid.connectionReview.terminals.TYPO = {
    status: "required",
    reason: "Typo.",
  };
  await f.compile();
  await expect(run("--json")).rejects.toMatchObject({ code: 1, stdout: "" });
});
