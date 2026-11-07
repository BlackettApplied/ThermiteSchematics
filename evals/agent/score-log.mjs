#!/usr/bin/env bun
// Port of the GI scorer, extended to independently verify both run boundaries.
import { readFileSync, realpathSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { diff } from "./snapshot.mjs";
import { normalizeTranscript } from "./transcript.mjs";
const stable = (value) =>
  value && typeof value === "object"
    ? Array.isArray(value)
      ? value.map(stable)
      : Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((k) => [k, stable(value[k])]),
        )
    : value;
const patchKey = (req) =>
  JSON.stringify(
    stable(
      Object.fromEntries(
        Object.entries(req).filter(([key]) => key !== "dryRun"),
      ),
    ),
  );
const json = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
const globMatches = (pattern, path) => {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**/", "\u0001")
    .replaceAll("**", "\u0002")
    .replaceAll("*", "[^/]*")
    .replaceAll("\u0001", "(?:.*/)?")
    .replaceAll("\u0002", ".*");
  return new RegExp("^" + escaped + "$").test(path);
};
const guarded = (snap) => {
  const patterns = [
    ...(snap?.documents?.["system.json"]?.sources ?? []),
    snap?.documents?.["system.json"]?.presentation,
  ].filter(Boolean);
  if (snap?.sourceFiles)
    return new Set(
      [
        ...snap.sourceFiles,
        snap.documents?.["system.json"]?.presentation,
      ].filter(Boolean),
    );
  return new Set(
    Object.keys(snap?.files ?? {}).filter((path) =>
      patterns.some((pattern) => globMatches(pattern, path)),
    ),
  );
};
export function score({
  calls = [],
  initial,
  final,
  runtimeBefore,
  runtimeAfter,
  transcript = "",
  context = "runtime",
  engineRoots = [],
  guideBytes = 0,
  guideFiles = [],
  expectedWarnings = [],
  actualWarnings = [],
  requiredTopics = [],
  allowedUnused = [],
  preserveSource = false,
  undocumentedShapes = [],
  wallTimeMs = null,
}) {
  const normalized = normalizeTranscript(transcript),
    violations = [],
    dryRuns = new Set(),
    failuresByCode = {},
    failureClasses = [];
  const add = (rule, detail) => violations.push({ rule, ...detail });
  let previous = initial;
  const knownGuarded = new Set(guarded(initial));
  const inspectEdits = (before, after, boundary, permitted = new Set()) => {
    for (const path of guarded(before)) knownGuarded.add(path);
    const protectedFiles = knownGuarded;
    for (const edit of diff(before, after)) {
      if (permitted.has(edit.path)) continue;
      if (
        edit.path === "AGENTS.md" ||
        (edit.path === "CLAUDE.md" && initial?.files?.["CLAUDE.md"]) ||
        /(?:^|\/)AGENTS\.md$/.test(edit.path)
      )
        add("V3", { boundary, ...edit });
      if (edit.path === "electrical-system.lock.json")
        add("V2", { boundary, ...edit });
      if (protectedFiles.has(edit.path) && edit.change !== "created") {
        const invalid = before?.invalidJsonFiles?.includes(edit.path);
        if (!invalid) add("V1", { boundary, ...edit });
      }
    }
  };
  for (const [index, call] of calls.entries()) {
    inspectEdits(
      previous,
      call.before,
      index === 0 ? "before-first" : `before-call-${index}`,
    );
    const patch =
      call.argv?.[0] === "agent" && call.argv?.[1] === "apply-source-patch"
        ? json(call.request)
        : null;
    const permitted = new Set();
    if (patch?.files) {
      const key = patchKey(patch);
      if (patch.dryRun === true && call.exit === 0) dryRuns.add(key);
      if (patch.dryRun === false) {
        if (!dryRuns.has(key)) add("V4", { call: index });
        if (call.exit === 0)
          for (const file of patch.files) permitted.add(file.path);
      }
    }
    for (const file of call.patchFiles ?? [])
      if (
        permitted.has(file.path) &&
        file.afterIntegrity?.startsWith("sha256-")
      ) {
        const expected = Buffer.from(
          file.afterIntegrity.slice(7),
          "base64",
        ).toString("hex");
        if (call.after?.files?.[file.path] !== expected) {
          add("V1", {
            boundary: `during-call-${index}`,
            path: file.path,
            reason: "patch-target-changed-after-commit",
          });
          permitted.delete(file.path);
        }
      }
    // Even writes made by child processes DURING a call require authorization.
    // Only the patch request's successful target paths, init and lock may write.
    if (call.argv?.[0] === "lock" && call.exit === 0)
      permitted.add("electrical-system.lock.json");
    if (call.argv?.[0] === "init" && call.exit === 0)
      for (const edit of diff(call.before, call.after))
        if (edit.change === "created") permitted.add(edit.path);
    inspectEdits(call.before, call.after, `during-call-${index}`, permitted);
    if (
      call.runtimeBefore &&
      call.runtimeAfter &&
      call.runtimeBefore !== call.runtimeAfter
    )
      add("V5", { call: index });
    if (
      call.runtimeBefore &&
      runtimeBefore &&
      call.runtimeBefore !== runtimeBefore
    )
      add("V5", { call: index, boundary: "before-call" });
    if (call.exit !== 0 && call.phase !== "flush") {
      const code = call.errorCode ?? call.spawnError ?? `exit${call.exit}`;
      failuresByCode[code] = (failuresByCode[code] ?? 0) + 1;
      if (
        undocumentedShapes.some(
          (s) =>
            s.code === code &&
            (!s.pointer ||
              JSON.stringify({
                report: call.report,
                diagnostics: call.diagnostics,
              }).includes(s.pointer)),
        )
      )
        failureClasses.push({
          call: index,
          class: "undocumented-shape",
          basis: "checker-declared missing discovery",
        });
    }
    previous = call.after;
  }
  inspectEdits(
    previous,
    final,
    calls.length ? "after-last" : "before-first-and-after-last",
  );
  if (runtimeBefore && runtimeAfter && runtimeBefore !== runtimeAfter)
    add("V5", { boundary: "run" });
  const byUid = new Map(
    [...(final?.sourceFiles ?? guarded(final))]
      .map((path) => final?.documents?.[path])
      .filter(Boolean)
      .flatMap((d) => d.objects ?? [])
      .filter((o) => o.designation)
      .map((o) => [o.uid, o.designation]),
  );
  actualWarnings = actualWarnings.map((d) => ({
    ...d,
    designation:
      d.designation ??
      byUid.get(d.uid) ??
      /^([^:]+):/.exec(d.message ?? "")?.[1],
  }));
  for (const expected of expectedWarnings) {
    const choices = expected.anyOf ?? [expected];
    const matches = choices.some((choice) =>
      actualWarnings.some((actual) =>
        typeof choice === "string"
          ? actual.code === choice
          : Object.entries(choice).every(([k, v]) => actual[k] === v),
      ),
    );
    if (!matches) add("V7", { reason: "expected-warning-missing", expected });
  }
  if (preserveSource)
    for (const edit of diff(initial, final))
      if (
        (guarded(initial).has(edit.path) &&
          edit.path !== initial?.documents?.["system.json"]?.presentation) ||
        edit.path === "system.json" ||
        edit.path.startsWith("librar")
      )
        add("V7", { reason: "topology-preservation", ...edit });
  // New intentionally-unused declarations require a task-declared user basis.
  const unused = (snap) => {
    const result = new Set();
    for (const path of guarded(snap))
      for (const object of snap?.documents?.[path]?.objects ?? [])
        for (const [group, points] of Object.entries(
          object.connectionReview ?? {},
        ))
          for (const [point, review] of Object.entries(points ?? {}))
            if (review.status === "intentionally-unused")
              result.add(`${object.designation}.${group}.${point}`);
    return result;
  };
  const oldUnused = unused(initial);
  for (const point of unused(final))
    if (!oldUnused.has(point) && !allowedUnused.includes(point))
      add("V7", { reason: "unused-without-user-basis", point });
  const sourceReads = [],
    documentReads = [],
    seenDocuments = new Set();
  const results = new Map(
    normalized.events
      .filter((e) => e.type === "tool-result")
      .map((e) => [e.id, e.output]),
  );
  const strings = (value) =>
    typeof value === "string"
      ? [value]
      : Array.isArray(value)
        ? value.flatMap(strings)
        : value && typeof value === "object"
          ? Object.values(value).flatMap(strings)
          : [];
  const pathText = (text) =>
    text
      .replaceAll("\\", "/")
      .replaceAll("/private/tmp/", "/tmp/")
      .replaceAll("/private/var/", "/var/")
      .toLowerCase();
  const roots = engineRoots
    .flatMap((root) => {
      try {
        return [root, realpathSync(root)];
      } catch {
        return [root];
      }
    })
    .map(pathText);
  const readPattern = roots.map(
    (root) =>
      new RegExp(
        root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?=[/\\s'\";)&\\]]|$)",
      ),
  );
  const sourceUrl =
    /(?:https?|ssh):\/\/(?:(?:git@)?github\.com\/[^/\s]+\/thermiteschematics(?=[/.?#\s'"\)]|$)|raw\.githubusercontent\.com\/[^/\s]+\/thermiteschematics\/|api\.github\.com\/repos\/[^/\s]+\/thermiteschematics(?:\/|$))/i;
  for (const event of normalized.events.filter((e) => e.type === "tool")) {
    if (/^(?:write|todowrite|todo_list)$/i.test(event.name)) continue;
    const values = strings(event.input),
      input = values.join("\n"),
      canonicalInput = pathText(input);
    let readsSource =
      readPattern.some((re) => re.test(canonicalInput)) ||
      sourceUrl.test(input) ||
      /git@github\.com:[^/\s]+\/thermiteschematics(?:\.git)?(?=[/\s'";)]|$)/i.test(
        input,
      ) ||
      /\bgh\s+(?:repo\s+(?:clone|view)|api)\b[^\n]*\b[^/\s]+\/thermiteschematics(?:\.git)?(?=[/\s'";)]|$)/i.test(
        input,
      ) ||
      (/\bgh\s+search\s+code\b/i.test(input) &&
        !/(?:\brepo:|(?:^|\s)(?:-R|--repo)(?:=|\s+))/.test(input)) ||
      (/\bgh\s+(?:search\s+code|browse)\b/i.test(input) &&
        /(?:\brepo:|(?:^|\s)(?:-R|--repo)(?:=|\s+))[^/\s'";]+\/thermiteschematics(?=[/\s'";)]|$)/i.test(
          input,
        )) ||
      (/\bgh\s+api\s+graphql\b/i.test(input) &&
        (/(?:^|\s)(?:-F|--field)(?:=|\s+)[\w-]+=["']?thermiteschematics(?=[\s"';)]|$)/i.test(
          input,
        ) ||
          /repository\s*\([^)]*\bname\s*:\s*\\?["']thermiteschematics\\?["']/i.test(
            input,
          ) ||
          /(?:\brepo:|\brepository\s*[:=]\s*)[^/\s'";]+\/thermiteschematics(?=[\s'";)]|$)/i.test(
            input,
          )));
    if (!readsSource)
      for (const token of input.match(/(?:[a-zA-Z]:[\\/]|\/)[^\s'";&)]+/g) ??
        [])
        try {
          if (
            roots.some(
              (root) =>
                pathText(realpathSync(token)) === root ||
                pathText(realpathSync(token)).startsWith(root + "/"),
            )
          )
            readsSource = true;
        } catch {}
    if (context === "runtime" && readsSource)
      sourceReads.push({ id: event.id, input });
    const guideCommand = /thermite[^\n]*\bguide\b/.test(input);
    const directPath =
      typeof event.input === "object"
        ? (event.input.file_path ?? event.input.path)
        : null;
    const paths = [
      directPath,
      ...(input.match(/(?:[a-zA-Z]:[\\/]|\/)[^\s'";&)]+\.md/g) ?? []),
    ].filter(Boolean);
    const isGuideFile = paths.some(
      (path) =>
        guideFiles.includes(path) ||
        roots.some((root) => pathText(path).startsWith(root + "/docs/")),
    );
    const alreadyLoadedGuide =
      paths.length > 0 &&
      paths.every((path) => /(?:^|[/\\])AGENTS\.md$/i.test(path));
    // The normally loaded project guide and shim guide stdout each count once.
    if (!guideCommand && isGuideFile && !alreadyLoadedGuide) {
      const key = JSON.stringify(event.input);
      if (seenDocuments.has(key)) continue;
      seenDocuments.add(key);
      const output = results.get(event.id),
        bytes =
          output === undefined
            ? null
            : Buffer.byteLength(
                typeof output === "string" ? output : JSON.stringify(output),
              );
      documentReads.push({
        id: event.id,
        input,
        bytes,
        basis: "declared guide/document read output",
      });
    }
  }
  for (const read of sourceReads) add("V8", { reason: "source-read", ...read });
  const agentCalls = calls.filter(
    (c) => c.phase !== "flush" && c.phase !== "setup",
  );
  const topics = requiredTopics.map((entry) => {
    const topic = typeof entry === "string" ? entry : entry.topic;
    const beforeCommand =
      typeof entry === "string" ? "agent" : entry.beforeCommand;
    const firstRelated = agentCalls.findIndex(
      (c) => c.argv[0] === beforeCommand,
    );
    const fetched = agentCalls.findIndex(
      (c) => c.argv[0] === "guide" && c.argv[1] === topic && c.exit === 0,
    );
    return {
      topic,
      retrieved: fetched >= 0 && (firstRelated < 0 || fetched < firstRelated),
    };
  });
  const guideOutputBytes = agentCalls
    .filter((c) => c.argv[0] === "guide" && c.exit === 0)
    .reduce((n, c) => n + (c.stdoutBytes ?? 0), 0);
  return {
    format: "thermite-agent-score/1.0",
    violations,
    rubricViolations: ["V6"],
    failureClasses,
    thermiteCalls: agentCalls.length,
    failedCalls: Object.values(failuresByCode).reduce((a, b) => a + b, 0),
    failuresByCode,
    infrastructureFailures: calls
      .filter((c) => c.exit === 2 || c.spawnError)
      .map((c) => ({ argv: c.argv, code: c.errorCode ?? c.spawnError })),
    stdoutBytes: agentCalls.reduce((n, c) => n + (c.stdoutBytes ?? 0), 0),
    stderrBytes: agentCalls.reduce((n, c) => n + (c.stderrBytes ?? 0), 0),
    totalToolCalls: normalized.totalToolCalls,
    wallTimeMs,
    usage: normalized.usage,
    modelUsage: normalized.modelUsage,
    reportedCostUSD: normalized.reportedCostUSD,
    transcriptWarnings: normalized.parseWarnings,
    retryCount: normalized.retryCount,
    retryEvents: normalized.retryEvents,
    guideBytes:
      guideBytes +
      guideOutputBytes +
      documentReads.reduce((n, r) => n + (r.bytes ?? 0), 0),
    guideBytesBasis:
      "project guide loaded by CLI, successful guide stdout, and observed document-read output bytes; missing read outputs remain unmeasured",
    documentReads,
    sourceReads: sourceReads.length,
    retrieval: topics,
    finalMessage: normalized.finalMessage,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [input] = process.argv.slice(2);
  const options = JSON.parse(readFileSync(input, "utf8"));
  if (options.logPath)
    options.calls = readFileSync(options.logPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse);
  console.log(JSON.stringify(score(options), null, 2));
}
