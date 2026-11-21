import {
  captureArtifactPath,
  conveyorBaseline,
  conveyorOutputs,
} from "./conveyor-exports.mjs";
import { projectReader } from "./capture-files.mjs";
import { exportSourcePaths } from "./source-files.mjs";
import { sha256 } from "./snapshot.mjs";

function cachedDigest(source, cache, path) {
  try {
    const stamp = () => {
      const { dev, ino, size, mtimeNs, ctimeNs } = source.inspect(path);
      return [dev, ino, size, mtimeNs, ctimeNs].join("/");
    };
    const before = stamp();
    if (cache.get(path)?.stamp !== before) {
      const digest = sha256(source.read(path));
      if (stamp() !== before) throw new Error("Changing candidate input");
      cache.set(path, { stamp: before, digest });
    }
    return cache.get(path).digest;
  } catch (error) {
    cache.delete(path);
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function signature(source, spec, captured, cache) {
  const digest = (path) => cachedDigest(source, cache, path);
  if (
    !captured.some(({ input }) => input === "drawings/packet.html") ||
    new Set(captured.map(({ inputSha256 }) => inputSha256)).size < 2 ||
    !captured.every(({ input, inputSha256 }) => digest(input) === inputSha256)
  )
    return null;
  const sources = exportSourcePaths(source);
  const deliverables = [
    ...new Set([
      ...conveyorOutputs(spec),
      ...captured.map(({ input }) => input),
    ]),
  ].sort();
  const paths = [...deliverables, conveyorBaseline, "packet.request.json"];
  const artifacts = paths.map((path) => [path, digest(path)]);
  if (artifacts.some(([, hash]) => hash === null)) return null;
  const marker = digest("drawings/export-manifest.json");
  return sha256(
    JSON.stringify([
      sources.map((path) => [path, digest(path)]),
      artifacts,
      marker,
      marker,
      deliverables.map((path) => [path, digest(path + ".receipt.json")]),
    ]),
  );
}

export function observeConveyorDelivery(source, spec, now = Date.now) {
  const cache = new Map(),
    candidates = [];
  return {
    candidates,
    observe(receipt) {
      try {
        const files = receipt.files.map(({ input, inputSha256 }) => ({
          input: captureArtifactPath(source.identity.path, input),
          inputSha256,
        }));
        const digest = signature(source, spec, files, cache);
        if (digest && digest === signature(source, spec, files, cache))
          candidates.push({ at: now(), digest });
      } catch {
        // Polling may overlap a write; only stable confined bytes can qualify.
      }
    },
  };
}

function sourceState(state, paths) {
  return JSON.stringify(paths.map((path) => state?.files?.[path] ?? null));
}

function isFinalization({ argv }) {
  const [command, subcommand] = argv;
  return (
    [
      "validate",
      "view",
      "packet",
      "report",
      "diagnostics",
      "cable",
      "review",
    ].includes(command) ||
    (command === "export" && ["bundle", "check"].includes(subcommand)) ||
    (command === "agent" && subcommand === "validate")
  );
}

export function phaseConveyorCalls(calls, started, ended) {
  return calls.map((call) => {
    const at = call.queuedAt ?? call.started;
    const phase = at < started ? "setup" : at <= ended ? "agent" : "flush";
    return { ...call, phase };
  });
}

export function conveyorMetrics({
  ctx,
  outcome,
  independentlyChecked = outcome.pass,
  candidates = [],
  captureRetries = 0,
  started,
  ended,
  runStarted,
  status,
  timeoutMs,
  timedOut = false,
  violations = [],
  postAgentWallTimeMs = Date.now() - ended,
}) {
  const calls = phaseConveyorCalls(ctx.calls, started, ended).filter(
    ({ phase }) => phase === "agent",
  );
  const successful = calls.filter(({ exit }) => exit === 0).length;
  let paths = [],
    digest = null;
  const deliveryChecksPassed =
    status === "complete" &&
    independentlyChecked &&
    outcome.captureCurrent &&
    !violations.length;
  let source;
  try {
    source = projectReader(ctx.project);
    paths = [
      ...new Set([
        ...exportSourcePaths(source),
        ...Object.keys(ctx.initial.files).filter(
          (p) => p.startsWith("libraries/") && !p.endsWith("/"),
        ),
        ...[
          ctx.initial,
          ctx.final,
          ...calls.flatMap(({ before, after }) => [before, after]),
        ]
          .flatMap((state) => [
            ...(state?.sourceFiles ?? []),
            state?.documents?.["system.json"]?.presentation,
          ])
          .filter((path) => typeof path === "string"),
      ]),
    ].sort();
    if (deliveryChecksPassed)
      digest = signature(
        source,
        ctx.task.deliverables,
        outcome.capture.files,
        new Map(),
      );
  } catch {
    // Invalid or refused source cannot qualify as a complete candidate.
  } finally {
    source?.close();
  }
  let previous = sourceState(ctx.initial, paths),
    finalSourceChangeUpperBound = started;
  for (const call of calls) {
    const before = sourceState(call.before, paths),
      after = sourceState(call.after, paths);
    if (before !== previous) finalSourceChangeUpperBound = call.started;
    if (after !== before)
      finalSourceChangeUpperBound = Math.min(
        ended,
        call.commandEnded ?? call.ended,
      );
    previous = after;
  }
  if (previous !== sourceState(ctx.final, paths))
    finalSourceChangeUpperBound = ended;
  const finalCalls = calls.filter(
    (call) => call.started >= finalSourceChangeUpperBound,
  );
  const first =
    digest &&
    candidates.find(
      (candidate) =>
        candidate.digest === digest &&
        candidate.at >= finalSourceChangeUpperBound &&
        candidate.at <= Math.min(ended, started + timeoutMs),
    );
  return {
    thermiteCalls: {
      successful,
      failed: calls.length - successful,
      total: calls.length,
    },
    finalSourceChangeUpperBound,
    finalizationCalls: finalCalls.filter(isFinalization).length,
    commandTimeAfterFinalSourceChangeMs: finalCalls.reduce(
      (ms, call) =>
        ms +
        Math.max(
          0,
          Math.min(ended, call.commandEnded ?? call.ended) -
            (call.commandStarted ?? call.started),
        ),
      0,
    ),
    wallTimeMs: ended - started,
    setupWallTimeMs: started - runStarted,
    postAgentWallTimeMs,
    captureRetries,
    completeDelivery: !!deliveryChecksPassed && (!timedOut || !!first),
    firstCompleteDeliveryAt: first?.at ?? null,
    timeToFirstCompleteDeliveryMs: first ? first.at - started : null,
    timeToFirstCompleteDeliveryCensored: !first,
    censorTimeMs: first ? null : Math.min(ended - started, timeoutMs),
    timedOut,
    visualInspection: "pending",
    pdfV1V5: outcome.checks?.pdfV1V5 ?? null,
  };
}
