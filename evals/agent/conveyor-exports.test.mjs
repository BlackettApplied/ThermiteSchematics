import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { checkDogfood, prepareDogfoodProject } from "./dogfood.mjs";
import { captureChain, conveyorOutputs } from "./conveyor-exports.mjs";
import {
  conveyorMetrics,
  observeConveyorDelivery,
} from "./conveyor-measurement.mjs";
import { projectReader } from "./capture-files.mjs";
import { diff, sha256, snapshot } from "./snapshot.mjs";
import { cli, ok, read, replaceObject, write } from "./task-support.mjs";

const supported = process.platform !== "win32";
const thermite = resolve("thermite.mjs");
const task = read(new URL("./tasks/D-conveyor/task.json", import.meta.url));
const request = "requests/final-delivery.json";
const marker = "drawings/export-manifest.json";
const html = ["drawings/packet.html", "drawings/motor-power.html"];
const bundleArgs = [
  "export",
  "bundle",
  "--input",
  request,
  "--out-dir",
  "drawings",
];
const checkArgs = [
  "export",
  "check",
  "--input",
  request,
  "--out-dir",
  "drawings",
  "--json",
];
const packet = ["packet", "--input", "packet.request.json", "--index"];
const motor = ["view", "M1", "--power", "--flow", "top-to-bottom"];
const standalone = [
  ...["json", "html", "pdf"].map((ext) => ["packet." + ext, packet]),
  ["motor-power.pdf", motor],
  ["motor-power.html", motor],
  ["contactor-actuation.pdf", ["view", "K1", "--actuation"]],
  ["ps1-loads.pdf", ["view", "PS1", "--loads"]],
  ...task.deliverables.reports.map((kind) => [kind + ".csv", ["report", kind]]),
  ["diagnostics.json", ["diagnostics"]],
  ["cable.json", ["cable", "CBL1"]],
  ["review.json", ["review", "--before", "drawings/before.json"]],
];
const plan = {
  format: "export-delivery-request/1",
  jobs: [
    {
      kind: "packet",
      input: "packet.request.json",
      index: true,
      outputs: { json: "packet.json", html: "packet.html", pdf: "packet.pdf" },
    },
    {
      kind: "view",
      designation: "M1",
      intent: "power",
      flow: "top-to-bottom",
      outputs: { pdf: "motor-power.pdf", html: "motor-power.html" },
    },
    {
      kind: "view",
      designation: "K1",
      intent: "actuation",
      outputs: { pdf: "contactor-actuation.pdf" },
    },
    {
      kind: "view",
      designation: "PS1",
      intent: "loads",
      outputs: { pdf: "ps1-loads.pdf" },
    },
    ...task.deliverables.reports.map((report) => ({
      kind: "report",
      report,
      outputs: { csv: report + ".csv" },
    })),
    { kind: "diagnostics", outputs: { json: "diagnostics.json" } },
    { kind: "cable", designation: "CBL1", outputs: { json: "cable.json" } },
    {
      kind: "review",
      before: "drawings/before.json",
      outputs: { json: "review.json" },
    },
  ],
};
let root, prepared, legacyPrepared, ctx, apply, validationDiagnostics;
const archived = () => join(ctx.evidence, "visual-captures/result.json");
const projectFile = (file) => join(ctx.project, file);
const bundleCall = () => ({
  phase: "agent",
  exit: 0,
  argv: bundleArgs,
  request: readFileSync(projectFile(request), "utf8"),
});
function installCaptures(inputs = html) {
  const files = inputs.map((input, i) => {
    // The broker is tested with Chromium separately. These bytes stand for its
    // already-published PNGs and exercise the checker's hash binding.
    const png = Buffer.from("trusted fixture capture " + i);
    const output = `visual-captures/0${i + 1}.png`;
    writeFileSync(join(ctx.evidence, output), png);
    return {
      input,
      inputSha256: sha256(readFileSync(projectFile(input))),
      output,
      sha256: sha256(png),
      bytes: png.length,
    };
  });
  const receipt = { format: "thermite-agent-visual-capture/1", files };
  write(archived(), receipt);
  return receipt;
}

function standaloneCall(context, file, args, receipt = false) {
  const path = "drawings/" + file;
  const argv = [...args, "-o", path, ...(receipt ? ["--receipt"] : [])];
  const files = () =>
    Object.fromEntries(
      [path, path + ".receipt.json"].flatMap((name) => {
        const target = join(context.project, name);
        return existsSync(target) ? [[name, sha256(readFileSync(target))]] : [];
      }),
    );
  const before = { files: files() };
  ok(context, ...argv);
  return { argv, phase: "agent", exit: 0, before, after: { files: files() } };
}

function standaloneFixture() {
  if (legacyPrepared) return legacyPrepared;
  const project = join(root, "standalone");
  cpSync(prepared, project, { recursive: true });
  rmSync(join(project, marker));
  const fixture = { project, thermite, task };
  const calls = standalone.map(([file, args]) =>
    standaloneCall(
      fixture,
      file,
      args,
      ["motor-power.html", "bom.csv"].includes(file),
    ),
  );
  legacyPrepared = { project, calls };
  return legacyPrepared;
}

function copyStandaloneFixture() {
  const fixture = standaloneFixture();
  rmSync(ctx.project, { recursive: true });
  cpSync(fixture.project, ctx.project, { recursive: true });
  return fixture.calls;
}

function changeSource() {
  const equipmentFile = projectFile("devices/equipment.json");
  const equipment = read(equipmentFile);
  for (const device of equipment.objects)
    if (["PLC1", "PS1"].includes(device.designation))
      device.location = "Main panel";
  write(equipmentFile, equipment);
}

beforeAll(() => {
  if (!supported) return;
  root = mkdtempSync(join(realpathSync(tmpdir()), "conveyor-exports-"));
  prepared = join(root, "prepared");
  ok({ project: root, thermite }, "init", prepared);
  const initial = { project: prepared, thermite, task };
  const equipmentFile = join(prepared, "devices/equipment.json");
  const equipment = read(equipmentFile);
  for (const device of equipment.objects)
    if (["PLC1", "PS1"].includes(device.designation))
      device.location = "MAIN-PANEL";
  write(equipmentFile, equipment);
  prepareDogfoodProject(initial);

  const before = snapshot(prepared);
  replaceObject(
    initial,
    "M1",
    "description",
    "Conveyor motor. Selected-part review remains open.",
  );
  const after = snapshot(prepared);
  apply = {
    argv: ["agent", "apply-source-patch", "--input", "requests/reference.json"],
    phase: "agent",
    exit: 0,
    before,
    after,
    request: readFileSync(join(prepared, "requests/reference.json"), "utf8"),
    editsByThisCall: diff(before, after),
  };
  validationDiagnostics = JSON.parse(ok(initial, "validate", ".", "--json"));
  write(join(prepared, request), plan);
  ok(initial, ...bundleArgs);
});

beforeEach(() => {
  if (!supported) return;
  const work = mkdtempSync(join(root, "case-"));
  ctx = {
    work,
    thermite,
    task,
    project: join(work, "project"),
    evidence: join(work, "evidence"),
  };
  cpSync(prepared, ctx.project, { recursive: true });
  mkdirSync(join(ctx.evidence, "visual-captures"), { recursive: true });
  ctx.calls = [apply, bundleCall()];
  ctx.validationDiagnostics = validationDiagnostics;
});
afterEach(() => {
  if (supported && ctx) rmSync(ctx.work, { force: true, recursive: true });
});
afterAll(() => {
  if (root) rmSync(root, { force: true, recursive: true });
});

it("accepts independent standalone exports and current captures with and without a receipt", async () => {
  if (!supported) return;
  const calls = copyStandaloneFixture();
  const bom = "drawings/bom.csv";
  rmSync(projectFile(bom + ".receipt.json"));
  const plainBom = ["report", "bom", "-o", bom];
  ok(ctx, ...plainBom);
  // Exercise calls without audit hashes, including a plain BOM and an HTML receipt.
  ctx.calls = [
    apply,
    { ...bundleCall(), exit: 1 },
    ...calls.map(({ argv }) => ({
      argv: argv.includes(bom) ? plainBom : argv,
      phase: "agent",
      exit: 0,
    })),
  ];
  const receipt = installCaptures();
  receipt.files[0].input = projectFile(html[0]);
  write(archived(), receipt);
  const result = await checkDogfood(ctx);
  expect(result.exports).toMatchObject({ status: "current", route: "legacy" });
  expect(result.pass, JSON.stringify(result.requirements)).toBe(true);
  expect(result.checks.viewsAndPacket).toBe(true);
  expect(result.checks.reports).toBe(true);
  expect(result.captureCurrent).toBe(true);
  expect(result.checks.pdfV1V5).toBeNull();
});

it("accepts all 15 bundle artifacts and validates a trusted capture without passing inspection", async () => {
  if (!supported) return;
  installCaptures();
  const result = await checkDogfood(ctx);
  expect(result.exports).toMatchObject({
    status: "current",
    route: "bundle",
    findings: [],
  });
  expect(Object.values(result.exports.artifacts)).toEqual(
    Array(14).fill("current"),
  );
  expect(result.exports.extras).toEqual({ [html[1]]: "current" });
  expect(result.pass, JSON.stringify(result.requirements)).toBe(true);
  expect(result.checks.viewsAndPacket).toBe(true);
  expect(result.checks.reports).toBe(true);
  expect(result.capture).toMatchObject({ status: "current" });
  expect(result.checks.pdfV1V5).toBeNull();
  expect(result.rubricPending).toBe(true);
});

it("rejects a job that scopes a required full report", async () => {
  if (!supported) return;
  const changed = structuredClone(plan);
  changed.jobs.find(({ report }) => report === "bom").device = "M1";
  write(projectFile(request), changed);
  expect((await checkDogfood(ctx)).exports.status).toBe("invalid-request");
});

it("detects the stale PLC1/PS1 location edit and reuses only byte-identical capture inputs", async () => {
  if (!supported) return;
  const old = installCaptures();
  changeSource();
  const stale = await checkDogfood(ctx);
  expect(stale.exports).toMatchObject({
    status: "stale",
    artifacts: {
      "drawings/bom.csv": "stale",
      "drawings/terminals.csv": "stale",
    },
    findings: [
      { path: "export-manifest.json", code: "source_changed", note: true },
    ],
  });
  expect(stale.capture.status).toBe("stale");

  ok(ctx, ...bundleArgs);
  ctx.calls.push(bundleCall());
  expect(sha256(readFileSync(projectFile(html[1])))).toBe(
    old.files[1].inputSha256,
  );
  const evidence = join(ctx.work, "refreshed-check");
  mkdirSync(evidence);
  const refreshed = await checkDogfood({
    ...ctx,
    clean: undefined,
    evidence,
    captureEvidence: ctx.evidence,
  });
  expect(refreshed.exports.status).toBe("current");
  expect(refreshed.pass).toBe(true);
  expect(refreshed.capture).toMatchObject({
    status: "stale",
    files: [
      { input: html[0], status: "stale" },
      { input: html[1], status: "current" },
    ],
  });
  installCaptures();
  expect(
    captureChain(ctx, (input) => ({
      status: "current",
      hash: sha256(readFileSync(projectFile(input))),
    })).status,
  ).toBe("current");
});

it("flags a tampered manifest without consulting it to select the output set", async () => {
  if (!supported) return;
  const manifest = read(projectFile(marker));
  manifest.artifacts = manifest.artifacts.filter(
    ({ path }) => path !== "bom.csv",
  );
  write(projectFile(marker), manifest);
  const result = await checkDogfood(ctx);
  expect(result.exports).toMatchObject({
    status: "tampered",
    artifacts: { "drawings/bom.csv": "tampered" },
  });
  expect(result.checks.reports).toBe(false);
});

it("fails independent regeneration when a forged artifact and its self-consistent receipt pass the quick check", async () => {
  if (!supported) return;
  const manifest = read(projectFile(marker));
  const output = "bom.csv";
  const fake = "forged but consistent bytes\n";
  write(projectFile("drawings/" + output), fake);
  const artifact = manifest.artifacts.find(({ path }) => path === output);
  artifact.sha256 = sha256(fake);
  write(projectFile(marker), manifest);
  expect(cli(ctx, ...checkArgs).status).toBe(0);
  const result = await checkDogfood(ctx);
  expect(result.exports).toMatchObject({
    status: "tampered",
    findings: [],
    artifacts: { ["drawings/" + output]: "tampered" },
  });

  rmSync(projectFile(marker));
  const file = html[1];
  ok(ctx, ...motor, "-o", file, "--receipt");
  const sidecar = projectFile(file + ".receipt.json");
  const receipt = read(sidecar);
  receipt.artifact.sha256 = sha256(fake);
  write(sidecar, receipt);
  write(projectFile(file), fake);
  const selfConsistent = {
    ...plan,
    jobs: [{ ...plan.jobs[1], outputs: { html: "motor-power.html" } }],
  };
  write(projectFile(request), selfConsistent);
  expect(cli(ctx, ...checkArgs, "--receipts").status).toBe(0);
  ctx.calls = [
    { argv: [...motor, "-o", file, "--receipt"], phase: "agent", exit: 0 },
  ];
  installCaptures();
  const legacy = await checkDogfood(ctx);
  expect(legacy.capture).toMatchObject({
    status: "tampered",
    files: [
      { input: html[0], status: "current" },
      { input: file, status: "tampered" },
    ],
  });
  expect(legacy.captureCurrent).toBe(false);
});

it("reports missing delivery bytes, an absent broker receipt and missing or tampered PNGs distinctly", async () => {
  if (!supported) return;
  rmSync(projectFile("drawings/wires.csv"));
  const result = await checkDogfood(ctx);
  expect(result.exports).toMatchObject({
    status: "missing",
    artifacts: { "drawings/wires.csv": "missing" },
  });
  expect(result.capture).toMatchObject({ status: "missing" });
  const receipt = installCaptures();
  const verify = (input) => ({
    status: "current",
    hash: sha256(readFileSync(projectFile(input))),
  });
  write(join(ctx.evidence, receipt.files[0].output), "wrong PNG");
  expect(captureChain(ctx, verify).status).toBe("tampered");
  rmSync(join(ctx.evidence, receipt.files[0].output));
  expect(captureChain(ctx, verify).status).toBe("missing");
});

it.each(
  ["legacy", "bundle", "mixed"].flatMap((route) =>
    ["fresh", "stale", "tampered", "an alternate packet request"].map(
      (state) => [route, state],
    ),
  ),
)("%s delivery is scored symmetrically when %s", async (route, state) => {
  if (!supported) return;
  const path = "drawings/bom.csv";
  if (route === "legacy") {
    ctx.calls = [apply, ...copyStandaloneFixture()];
  } else if (route === "mixed") {
    ctx.calls.push(standaloneCall(ctx, "bom.csv", ["report", "bom"], true));
  }
  const packetMismatch = state === "an alternate packet request";
  if (packetMismatch) {
    const input = "other.request.json";
    const delivered = read(projectFile("packet.request.json"));
    write(projectFile(input), {
      ...delivered,
      views: delivered.views.slice(0, 1),
    });
    if (route === "bundle") {
      const changed = structuredClone(plan);
      changed.jobs[0].outputs = { json: "packet.json" };
      changed.jobs.push({
        ...changed.jobs[0],
        input,
        outputs: { html: "packet.html", pdf: "packet.pdf" },
      });
      write(projectFile(request), changed);
      ok(ctx, ...bundleArgs);
      expect(cli(ctx, ...checkArgs).status).toBe(0);
      ctx.calls = [apply, bundleCall()];
    } else {
      for (const ext of ["html", "pdf"])
        ctx.calls.push(
          standaloneCall(
            ctx,
            "packet." + ext,
            ["packet", "--input", input],
            ext === "html",
          ),
        );
    }
  }
  installCaptures();
  if (state === "stale") changeSource();
  if (state === "tampered") {
    write(projectFile(path), "forged bill of materials\n");
    ctx.calls = ctx.calls.map((call) =>
      call.argv.includes(path) ? { ...call, after: undefined } : call,
    );
  }
  const outcome = await checkDogfood(ctx);
  const status =
    state === "fresh" ? "current" : packetMismatch ? "stale" : state;
  expect(outcome.exports).toMatchObject({
    route,
    status,
    artifacts: packetMismatch
      ? {
          "drawings/packet.json": "current",
          "drawings/packet.html": "stale",
          "drawings/packet.pdf": "stale",
        }
      : { [path]: status },
  });
  expect(outcome.pass).toBe(state === "fresh");
  expect(outcome.captureCurrent).toBe(state !== "stale" && !packetMismatch);
});

it.each([false, true])(
  "accepts full standalone re-exports after a bundle (deleted marker: %s)",
  async (deleted) => {
    if (!supported) return;
    ctx.calls.push(standaloneCall(ctx, "bom.csv", ["report", "bom"], true));
    changeSource();
    for (const [file, args] of standalone)
      ctx.calls.push(standaloneCall(ctx, file, args));
    if (deleted) rmSync(projectFile(marker));
    installCaptures();
    const outcome = await checkDogfood(ctx);
    expect(outcome.pass).toBe(true);
    expect(outcome.captureCurrent).toBe(true);
    expect(outcome.exports).toMatchObject({
      route: "legacy",
      status: "current",
      findings: expect.arrayContaining([
        {
          path: "export-manifest.json",
          code: deleted ? "missing_manifest" : "source_changed",
          note: true,
        },
      ]),
    });
  },
);

it("accepts a partial bundle and standalone outputs outside the plan", async () => {
  if (!supported) return;
  const partial = structuredClone(plan);
  delete partial.jobs[0].outputs.json;
  delete partial.jobs[1].outputs.html;
  write(projectFile(request), partial);
  ok(ctx, ...bundleArgs);
  ctx.calls = [
    apply,
    bundleCall(),
    standaloneCall(ctx, "packet.json", packet),
    standaloneCall(ctx, "motor-power.html", motor),
  ];
  installCaptures();
  const outcome = await checkDogfood(ctx);
  expect(outcome.exports).toMatchObject({ route: "mixed", status: "current" });
  expect(outcome.pass).toBe(true);
  expect(outcome.captureCurrent).toBe(true);
});

it.each([false, true])(
  "accepts zero or four optional HTML exports and an extra report (four: %s)",
  async (optional) => {
    if (!supported) return;
    const expanded = structuredClone(plan);
    if (optional) {
      expanded.jobs[2].outputs.html = "contactor-actuation.html";
      expanded.jobs[3].outputs.html = "ps1-loads.html";
      expanded.jobs.find(({ report }) => report === "bom").outputs.html =
        "bom.html";
    } else {
      delete expanded.jobs[1].outputs.html;
    }
    expanded.jobs.push({
      kind: "report",
      report: "network",
      outputs: { csv: "network.csv" },
    });
    write(projectFile(request), expanded);
    ok(ctx, ...bundleArgs);
    ctx.calls = [apply, bundleCall()];
    if (!optional)
      ctx.calls.push(standaloneCall(ctx, "motor-power.html", motor));
    installCaptures();
    const outcome = await checkDogfood(ctx);
    expect(outcome.pass).toBe(true);
    expect(outcome.captureCurrent).toBe(true);
    expect(outcome.exports.extras["drawings/network.csv"]).toBe("current");
    expect(
      Object.keys(outcome.exports.extras).filter((path) =>
        path.endsWith(".html"),
      ),
    ).toHaveLength(optional ? 4 : 0);
  },
);

it("reports an explicitly disallowed job type", async () => {
  if (!supported) return;
  const changed = structuredClone(plan);
  changed.jobs.push({ kind: "validate", outputs: { json: "validation.json" } });
  write(projectFile(request), changed);
  const { exports } = await checkDogfood(ctx);
  expect(exports).toMatchObject({
    status: "invalid-request",
    findings: [
      {
        code: "invalid_request",
        message: 'Disallowed bundle job type "validate".',
      },
    ],
  });
});

it.each(["legacy", "bundle", "mixed"])(
  "keeps stale optional capture HTML out of %s export pass",
  async (route) => {
    if (!supported) return;
    const optional = "drawings/bom.html";
    const report = ["report", "bom"];
    if (route === "bundle") {
      const expanded = structuredClone(plan);
      expanded.jobs.find(({ report }) => report === "bom").outputs.html =
        "bom.html";
      write(projectFile(request), expanded);
      ok(ctx, ...bundleArgs);
      ctx.calls = [apply, bundleCall()];
    } else {
      if (route === "legacy") {
        rmSync(projectFile(marker));
        ctx.calls = [apply, ...standaloneFixture().calls];
      }
      ctx.calls.push(standaloneCall(ctx, "bom.html", report, true));
    }
    const earlier = installCaptures([html[0], optional]);
    changeSource();
    if (route === "legacy") {
      for (const [file, args] of standalone)
        ctx.calls.push(standaloneCall(ctx, file, args));
    } else {
      ok(ctx, ...bundleArgs);
      ctx.calls.push(bundleCall());
    }
    const current = installCaptures([html[0], optional]);
    expect(current.files[0].inputSha256).not.toBe(earlier.files[0].inputSha256);
    if (route === "bundle") {
      expect(current.files[1].inputSha256).not.toBe(
        earlier.files[1].inputSha256,
      );
      current.files[1] = earlier.files[1];
      write(archived(), current);
    }
    const outcome = await checkDogfood(ctx);
    expect(outcome.exports.route).toBe(route);
    expect(outcome.pass).toBe(true);
    expect(outcome.capture).toMatchObject({
      status: "stale",
      files: [{ status: "current" }, { input: optional, status: "stale" }],
    });
  },
);

it("accepts a standalone re-render with different options from the earlier bundle", async () => {
  if (!supported) return;
  const path = "drawings/motor-power.pdf";
  const earlier = sha256(readFileSync(projectFile(path)));
  ctx.calls.push(
    standaloneCall(ctx, "motor-power.pdf", ["view", "M1", "--power"], true),
  );
  expect(sha256(readFileSync(projectFile(path)))).not.toBe(earlier);
  installCaptures();
  const outcome = await checkDogfood(ctx);
  expect(outcome.pass).toBe(true);
  expect(outcome.exports).toMatchObject({
    route: "mixed",
    status: "current",
    findings: [
      { path: "motor-power.pdf", code: "byte_mismatch", superseded: true },
    ],
  });
});

it("times the first observed complete final candidate and isolates agent-phase command time", () => {
  if (!supported) return;
  const receipt = installCaptures(),
    starting = snapshot(ctx.project);
  const source = projectReader(ctx.project);
  const outcomes = conveyorOutputs(task.deliverables);
  const original = readFileSync(projectFile(outcomes[0]));
  let now = 1050;
  const timer = observeConveyorDelivery(source, task.deliverables, () => now);
  try {
    write(projectFile(outcomes[0]), "an earlier candidate");
    timer.observe(receipt);
    now = 1160;
    writeFileSync(projectFile(outcomes[0]), original);
    timer.observe(receipt);
    now = 1190;
    timer.observe(receipt);
  } finally {
    source.close();
  }
  const outcome = { pass: true, captureCurrent: true, capture: receipt };
  const changed = {
    ...starting,
    files: { ...starting.files, "system.json": "before-change" },
  };
  ctx.initial = changed;
  ctx.final = starting;
  ctx.calls = [
    {
      phase: "agent",
      argv: ["agent", "apply-source-patch"],
      exit: 0,
      before: changed,
      after: starting,
      started: 1090,
      commandStarted: 1100,
      commandEnded: 1110,
      ended: 1115,
    },
    {
      phase: "flush",
      argv: ["export", "bundle"],
      exit: 0,
      before: starting,
      after: starting,
      started: 1120,
      commandStarted: 1125,
      commandEnded: 1145,
      ended: 1150,
    },
    {
      phase: "setup",
      argv: ["export", "check"],
      exit: 1,
      before: starting,
      after: starting,
      started: 1170,
      commandStarted: 1173,
      commandEnded: 1180,
      ended: 1189,
    },
    { phase: "agent", argv: ["validate"], exit: 0, started: 1201 },
    { phase: "agent", argv: ["init"], exit: 0, started: 999 },
  ];
  expect(timer.candidates.map(({ at }) => at)).toEqual([1050, 1160, 1190]);
  const options = {
    ctx,
    outcome,
    candidates: timer.candidates,
    captureRetries: 1,
    started: 1000,
    ended: 1200,
    runStarted: 850,
    status: "complete",
    timeoutMs: 900000,
  };
  expect(conveyorMetrics(options)).toMatchObject({
    thermiteCalls: { successful: 2, failed: 1, total: 3 },
    finalizationCalls: 2,
    commandTimeAfterFinalSourceChangeMs: 27,
    setupWallTimeMs: 150,
    wallTimeMs: 200,
    captureRetries: 1,
    completeDelivery: true,
    firstCompleteDeliveryAt: 1160,
    timeToFirstCompleteDeliveryMs: 160,
    timeToFirstCompleteDeliveryCensored: false,
    visualInspection: "pending",
  });
  expect(
    conveyorMetrics({ ...options, timeoutMs: 150, timedOut: true }),
  ).toMatchObject({
    timedOut: true,
    timeToFirstCompleteDeliveryCensored: true,
    censorTimeMs: 150,
    firstCompleteDeliveryAt: null,
  });
});
