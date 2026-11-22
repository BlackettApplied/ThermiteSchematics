import { basename, dirname, join, relative, resolve } from "node:path";
import { mkdirSync, readFileSync } from "node:fs";
import {
  parseExportJson,
  portablePath,
} from "../../packages/cli/dist/alpha-export-input.js";
import { readReceiptRecord } from "../../packages/cli/dist/alpha-export-record.js";
import {
  cleanChecker,
  deliveredBytes,
  pdf,
  replayExport,
  standaloneExportCall,
} from "./artifacts.mjs";
import { projectReader } from "./capture-files.mjs";
import { sha256 } from "./snapshot.mjs";
import { canonical } from "./source-files.mjs";
import { cli } from "./task-support.mjs";

const directory = "drawings";
const marker = "drawings/export-manifest.json";
const packetHtml = "drawings/packet.html";
const packetJson = "drawings/packet.json";
const packetPdf = "drawings/packet.pdf";
const packetArtifacts = new Set([packetJson, packetHtml, packetPdf]);
export const conveyorPacketRequest = "packet.request.json";
export const conveyorBaseline = "drawings/before.json";
const diagnostics = "drawings/diagnostics.json";
const cable = "drawings/cable.json";
const review = "drawings/review.json";

export function conveyorOutputs(spec) {
  return [
    ...spec.views.map((name) => directory + "/" + name),
    packetJson,
    packetHtml,
    packetPdf,
    ...spec.reports.map((kind) => directory + "/" + kind + ".csv"),
    diagnostics,
    cable,
    review,
  ];
}

export function exportFile(ctx, path) {
  try {
    return { bytes: deliveredBytes(ctx, path) };
  } catch (error) {
    return { status: error.code === "ENOENT" ? "missing" : "tampered" };
  }
}

function readJson(bytes, path) {
  return parseExportJson(bytes, path).value;
}

function option(argv, name) {
  const index = argv.indexOf(name);
  return (
    argv.find((arg) => arg.startsWith(name + "="))?.slice(name.length + 1) ??
    (index === -1 ? undefined : argv[index + 1])
  );
}

// Use the audited invocation to locate a named delivery request. The default
// is the example in the offline guide and also supports unaudited replays.
function bundleInput(ctx) {
  const root = ctx.originalProject ?? ctx.project;
  const index = (ctx.calls ?? []).findLastIndex(
    ({ argv, phase, exit }) =>
      phase !== "flush" &&
      exit === 0 &&
      Array.isArray(argv) &&
      argv[0] === "export" &&
      argv[1] === "bundle" &&
      argv.every((arg) => typeof arg === "string") &&
      resolve(root, option(argv, "--out-dir") ?? "") ===
        resolve(root, directory),
  );
  const call = ctx.calls?.[index];
  const manifest = exportFile(ctx, marker);
  if (!call && manifest.status === "missing") return null;
  const source = projectReader(ctx.project);
  try {
    const authored = call
      ? option(call.argv, "--input")
      : "delivery.request.json";
    if (!authored || authored === "-") return {};
    const path = relative(root, resolve(root, authored)).replaceAll("\\", "/");
    return {
      path: portablePath(source.path(path).replaceAll("\\", "/")),
      call,
      index,
    };
  } catch {
    return {};
  } finally {
    source.close();
  }
}

function drawingOptions(job) {
  return [
    ...(job.index === true ? ["--index"] : []),
    ...[
      ["--paper", job.page?.size],
      ["--orientation", job.page?.orientation],
      ["--margin", job.page?.marginMm],
      ["--layout", job.layout],
    ].flatMap(([flag, value]) =>
      value === undefined ? [] : [flag, String(value)],
    ),
  ];
}

// Only required names carry task-specific intent constraints. The CLI validates
// the entire request before these recipes can be replayed.
function bundleRecipe(job, path, required, views, cableTags) {
  const name = basename(path);
  switch (job.kind) {
    case "packet":
      if (required && !packetArtifacts.has(path)) break;
      return [
        "packet",
        "--input",
        required ? conveyorPacketRequest : job.input,
        ...drawingOptions(job),
        ...(job.strict ? ["--strict"] : []),
      ];
    case "view": {
      const view = views.get(name);
      if (
        required &&
        (!view?.roots.includes(job.designation) || job.intent !== view.intent)
      )
        break;
      return [
        "view",
        job.designation,
        ...(job.intent === "trace"
          ? ["--to", job.to, ...(job.includePower ? ["--include-power"] : [])]
          : ["--" + job.intent]),
        ...drawingOptions(job),
        ...(job.flow === undefined ? [] : ["--flow", job.flow]),
      ];
    }
    case "report":
      if (
        required &&
        (path !== directory + "/" + job.report + ".csv" ||
          job.device !== undefined ||
          job.filter !== undefined)
      )
        break;
      return [
        "report",
        job.report,
        ...drawingOptions(job),
        ...(job.device === undefined ? [] : ["--device", job.device]),
        ...(job.filter === undefined ? [] : ["--filter", job.filter]),
      ];
    case "diagnostics":
      if (
        required &&
        (path !== diagnostics ||
          job.device !== undefined ||
          job.location !== undefined)
      )
        break;
      return [
        "diagnostics",
        ...(job.device === undefined ? [] : ["--device", job.device]),
        ...(job.location === undefined ? [] : ["--location", job.location]),
      ];
    case "cable":
      if (required && (path !== cable || !cableTags.includes(job.designation)))
        break;
      return ["cable", job.designation];
    case "review":
      if (required && (path !== review || job.before !== conveyorBaseline))
        break;
      return ["review", "--before", job.before];
    default:
      throw new Error(
        "Disallowed bundle job type " + JSON.stringify(job.kind) + ".",
      );
  }
  throw new Error("Bundle job " + job.kind + " cannot satisfy " + path + ".");
}

function planBundle(request, required, views, cableTags) {
  if (
    request?.format !== "export-delivery-request/1" ||
    !Array.isArray(request.jobs) ||
    !request.jobs.length
  )
    throw new Error("Expected a nonempty export-delivery-request/1.");
  const plan = new Map();
  for (const job of request.jobs) {
    if (
      !job?.outputs ||
      typeof job.outputs !== "object" ||
      Array.isArray(job.outputs) ||
      !Object.keys(job.outputs).length
    )
      throw new Error("Each bundle job needs at least one named output.");
    for (const name of Object.values(job.outputs)) {
      const path = directory + "/" + portablePath(name);
      if (plan.has(path))
        throw new Error("Duplicate bundle output " + path + ".");
      const isRequired = required.has(path);
      plan.set(path, {
        argv: bundleRecipe(job, path, isRequired, views, cableTags),
        requestMismatch:
          isRequired &&
          job.kind === "packet" &&
          job.input !== conveyorPacketRequest,
      });
    }
  }
  return plan;
}

function checkFindings(clean, request) {
  const check = cli(
    clean,
    "export",
    "check",
    "--input",
    request,
    "--out-dir",
    directory,
    "--json",
  );
  try {
    const report = JSON.parse(check.stdout);
    if (
      report.format === "export-check/1" &&
      (check.status === 0 || report.reasons.length)
    )
      return report.reasons;
  } catch {}
  return [{ path: "delivery", code: "unverifiable_input" }];
}

export async function regenerateConveyorBundle(ctx, spec, views, cableTags) {
  const input = bundleInput(ctx);
  if (!input) return null;
  const artifacts = new Map(),
    findings = [];
  const result = {
    artifacts,
    findings,
    request: input.path ?? null,
    packet: null,
  };
  let plan, requestBytes;
  const required = new Set(conveyorOutputs(spec));
  try {
    if (!input.path)
      throw new Error("Expected a named project-local bundle request.");
    requestBytes = deliveredBytes(ctx, input.path);
    plan = planBundle(
      readJson(requestBytes, input.path),
      required,
      views,
      cableTags,
    );
  } catch (error) {
    findings.push({
      path: input.path ?? "delivery",
      code: "invalid_request",
      message: error.message,
    });
    return { ...result, status: "invalid-request" };
  }

  const clean = cleanChecker(ctx);
  const checks = checkFindings(clean, input.path);
  findings.push(...checks);
  if (
    checks.some(
      ({ path, code }) =>
        code === "unverifiable_input" &&
        path !== basename(marker) &&
        !plan.has(directory + "/" + path),
    )
  )
    return { ...result, status: "invalid-request" };

  const deliveredMarker = exportFile(ctx, marker);
  const publishedHash = input.call?.after?.files?.[marker];
  let markerTampered =
    deliveredMarker.status === "tampered" ||
    checks.some(
      ({ path, code }) =>
        path === basename(marker) && code === "unverifiable_input",
    );
  if (
    publishedHash &&
    deliveredMarker.bytes &&
    sha256(deliveredMarker.bytes) !== publishedHash
  ) {
    findings.push({ path: basename(marker), code: "marker_changed" });
    markerTampered = true;
  }
  const changedRequest =
    typeof input.call?.request === "string" &&
    sha256(input.call.request) !== sha256(requestBytes);
  const markerStale = checks.some(
    ({ path, code }) =>
      path === basename(marker) &&
      (code === "source_changed" ||
        code === "producer_mismatch" ||
        (code === "request_changed" && changedRequest)),
  );
  if (
    !changedRequest &&
    checks.some(
      ({ path, code }) =>
        path === basename(marker) && code === "request_changed",
    )
  )
    markerTampered = true;

  const standalone = {
    ...ctx,
    calls: (ctx.calls ?? []).slice(input.index + 1),
  };
  for (const [path, { argv, requestMismatch }] of plan) {
    const delivered = exportFile(ctx, path);
    const specific = checks.filter(
      (finding) => directory + "/" + finding.path === path,
    );
    const later = standaloneExportCall(standalone, path);
    if (later) {
      for (const finding of specific) finding.superseded = true;
      continue;
    }

    const out = join(ctx.evidence, "checker-bundle", path);
    mkdirSync(dirname(out), { recursive: true });
    const generated = cli(clean, ...argv, "-o", out);
    let equals = false;
    if (generated.status === 0) {
      const expected = readFileSync(out);
      if (path === packetJson) result.packet = JSON.parse(expected);
      equals =
        !!delivered.bytes?.equals(expected) &&
        (!path.endsWith(".pdf") || (await pdf(out)));
    }

    const changedDependency = ["--input", "--before", "--filter"].some(
      (flag) => {
        const dependency = option(argv, flag);
        const published = input.call?.after?.files?.[dependency];
        const { bytes } = dependency ? exportFile(ctx, dependency) : {};
        return published && bytes && sha256(bytes) !== published;
      },
    );
    const stale = markerStale || changedDependency;
    const conflicting = specific.some(
      ({ code }) =>
        code === "unverifiable_input" ||
        (code === "request_changed" && !changedRequest && !changedDependency),
    );
    const published = input.call?.after?.files?.[path];
    const hash = delivered.bytes && sha256(delivered.bytes);
    const byteMismatch = specific.some(({ code }) => code === "byte_mismatch");
    const changedBytes = published && hash && published !== hash;
    const status =
      delivered.status ??
      (conflicting || ((byteMismatch || changedBytes) && !(stale && equals))
        ? "tampered"
        : equals && !requestMismatch
          ? "current"
          : stale || requestMismatch || !deliveredMarker.bytes
            ? "stale"
            : "tampered");
    if (status === "current")
      for (const finding of specific) finding.note = true;
    artifacts.set(path, { status, hash });
  }
  for (const finding of findings)
    if (finding.path === basename(marker) && !markerTampered)
      finding.note = true;

  return { ...result, status: markerTampered ? "tampered" : "current" };
}

export function verifyStandaloneExport(ctx, path, { matches, fallback } = {}) {
  const delivered = exportFile(ctx, path);
  if (!delivered.bytes) return delivered;
  if (path.endsWith(".json")) {
    try {
      readJson(delivered.bytes, path);
    } catch {
      return { status: "tampered" };
    }
  }
  const pathReceipt = path + ".receipt.json";
  const sidecar = exportFile(ctx, pathReceipt);
  if (sidecar.status === "tampered") return sidecar;
  const hash = sha256(delivered.bytes);
  const call = standaloneExportCall(ctx, path);
  const published = call?.after?.files?.[path];
  const publishedReceipt = call?.after?.files?.[pathReceipt];
  if (
    (published && published !== hash) ||
    (publishedReceipt &&
      sidecar.bytes &&
      publishedReceipt !== sha256(sidecar.bytes))
  )
    return { status: "tampered" };
  // A plain standalone export leaves any previous receipt on disk. The audit
  // can establish that this call published the current bytes without it.
  const leftover =
    published &&
    publishedReceipt &&
    call.before?.files?.[pathReceipt] === publishedReceipt &&
    !call.argv.includes("--receipt");
  const receipt = !leftover && sidecar.bytes;
  if (!receipt && matches !== undefined)
    return { status: matches ? "current" : "stale", hash };

  let actual;
  if (receipt) {
    try {
      actual = readReceiptRecord(readJson(receipt, pathReceipt));
      if (
        actual.artifact.path !== basename(path) ||
        actual.artifact.sha256 !== hash
      )
        return { status: "tampered" };
      const input = actual.artifact.intent?.inputs?.[0]?.path;
      if (
        packetArtifacts.has(path) &&
        (matches === false ||
          (typeof input === "string" && input !== conveyorPacketRequest))
      )
        return { status: "stale", hash };
    } catch {
      return { status: "tampered" };
    }
  }
  const replay = replayExport(ctx, path, fallback, !!receipt);
  const equals = replay?.bytes.equals(delivered.bytes);
  if (actual) {
    try {
      if (!replay?.receipt) return { status: "unverified" };
      const expected = readReceiptRecord(readJson(replay.receipt, pathReceipt));
      const { inputs, ...intent } = actual.artifact.intent;
      const { inputs: expectedInputs, ...expectedIntent } =
        expected.artifact.intent;
      const stale =
        canonical(actual.source) !== canonical(expected.source) ||
        canonical(actual.producer) !== canonical(expected.producer) ||
        canonical(inputs) !== canonical(expectedInputs);
      if (!equals && stale) return { status: "stale" };
      if (
        canonical(intent) !== canonical(expectedIntent) ||
        canonical(inputs.map(({ path }) => path)) !==
          canonical(expectedInputs.map(({ path }) => path))
      )
        return { status: "tampered" };
    } catch {
      return { status: "tampered" };
    }
  }
  return equals && matches !== false
    ? { status: "current", hash }
    : { status: sidecar.bytes ? "tampered" : replay ? "stale" : "unverified" };
}

export function captureArtifactPath(project, input) {
  return portablePath(relative(project, resolve(project, input)));
}

export function captureChain(ctx, verifyHtml) {
  let source;
  try {
    source = projectReader(ctx.captureEvidence ?? ctx.evidence);
    const receipt = JSON.parse(source.read("visual-captures/result.json"));
    if (receipt.error)
      return { status: "missing", files: [], error: receipt.error };
    if (
      receipt.format !== "thermite-agent-visual-capture/1" ||
      !Array.isArray(receipt.files) ||
      receipt.files.length > 4
    )
      return { status: "tampered", files: [] };
    const files = receipt.files.map(
      ({ input, inputSha256, output, sha256: pngHash, bytes }, i) => {
        let status, hash;
        try {
          input = captureArtifactPath(
            ctx.originalProject ?? ctx.project,
            input,
          );
          if (
            !input.endsWith(".html") ||
            output !== "visual-captures/0" + (i + 1) + ".png"
          )
            return { input, status: "tampered" };
          const png = source.read(output);
          if (png.length !== bytes || sha256(png) !== pngHash)
            return { input, status: "tampered" };
          ({ status, hash } = verifyHtml(input));
        } catch (error) {
          return {
            input,
            status: error.code === "ENOENT" ? "missing" : "tampered",
          };
        }
        return {
          input,
          status:
            status === "current" && hash !== inputSha256 ? "stale" : status,
          inputSha256,
        };
      },
    );
    const distinct = new Set(files.map(({ inputSha256 }) => inputSha256));
    const status =
      ["tampered", "stale", "missing", "unverified"].find((state) =>
        files.some((file) => file.status === state),
      ) ??
      (files.some(({ input }) => input === packetHtml) && distinct.size >= 2
        ? "current"
        : "missing");
    return { status, files };
  } catch (error) {
    return {
      status: error.code === "ENOENT" ? "missing" : "tampered",
      files: [],
    };
  } finally {
    source?.close();
  }
}
