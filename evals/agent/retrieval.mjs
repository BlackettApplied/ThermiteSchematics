// The declarations distinguish discovery from reading documentation before
// the action. Indices are zero-based in the agent-phase shim trace.
function arg(argv, ...flags) {
  for (let i = 0; i < argv.length; i++)
    for (const flag of flags) {
      if (argv[i] === flag) return argv[i + 1];
      if (argv[i].startsWith(flag + "=")) return argv[i].slice(flag.length + 1);
    }
}
function request(call) {
  try {
    return JSON.parse(call.request);
  } catch {
    return null;
  }
}
function probe(call) {
  return (call.argv ?? []).some((a) => a === "--help" || a === "-h");
}
function printableAction(call) {
  const argv = call.argv ?? [];
  if (probe(call) || (call.exit !== 0 && call.exit !== 1)) return false;
  if (argv[0] === "packet") {
    const body = request(call);
    return (
      !!arg(argv, "--input") &&
      body?.format === "schematic-packet-request/0.1" &&
      [body.views, body.groups].some(
        (list) => Array.isArray(list) && list.length,
      )
    );
  }
  return (
    argv[0] === "view" &&
    argv.length > 2 &&
    argv.some((a) =>
      ["--power", "--actuation", "--loads", "--conductors", "--to"].includes(a),
    )
  );
}
function patchAction(call) {
  const argv = call.argv ?? [];
  if (probe(call) || argv[0] !== "agent" || argv[1] !== "apply-source-patch")
    return false;
  const body = request(call);
  return (
    body?.patchFormat === "json-patch/0.1" &&
    typeof body.dryRun === "boolean" &&
    Array.isArray(body.files) &&
    body.files.length > 0 &&
    [0, 1].includes(call.exit)
  );
}
function editAt(call, guarded) {
  const paths = new Set([...guarded(call.before), ...guarded(call.after)]);
  // A direct edit is already in force when a documented command starts. The
  // first observed boundary can be a guide read, which must not get credit.
  return (call.directEditsSincePrevious ?? []).some(({ path }) =>
    paths.has(path),
  );
}
function installAt(call) {
  return (call.directEditsSincePrevious ?? []).some(
    ({ path }) => path.startsWith("libraries/") && path.endsWith(".json"),
  );
}
function atDraft(calls, final) {
  const draft = calls.findIndex((c) => c.before?.files?.["issue.md"]);
  return draft >= 0 ? draft : final?.files?.["issue.md"] ? calls.length : -1;
}
function cutoff(action, calls, { final, completed, guarded }) {
  const first = (predicate) => calls.findIndex(predicate);
  const source = () => first((c) => editAt(c, guarded) || patchAction(c));
  const optionalLibrary = () => first(installAt);
  switch (action) {
    case "source-change":
      return source();
    case "guarded-patch":
      return first(patchAction);
    case "library-choice": {
      const choices = [optionalLibrary(), source()].filter((i) => i >= 0);
      return choices.length ? Math.min(...choices) : -1;
    }
    case "acquire-or-draft": {
      const choices = [optionalLibrary(), atDraft(calls, final)].filter(
        (i) => i >= 0,
      );
      return choices.length ? Math.min(...choices) : -1;
    }
    case "print":
      return first(printableAction);
    case "packet":
      return first((c) => c.argv?.[0] === "packet" && printableAction(c));
    case "hookup":
      return first((c) => {
        const views = request(c)?.views;
        return (
          c.argv?.[0] === "packet" &&
          printableAction(c) &&
          Array.isArray(views) &&
          views.some(
            (v) =>
              typeof v?.format === "string" &&
              v.format.startsWith("signal-loop-view-request/"),
          )
        );
      });
    case "review":
      return first(
        (c) =>
          c.argv?.[0] === "review" &&
          !probe(c) &&
          !!arg(c.argv, "--before") &&
          c.exit === 0,
      );
    case "completeness":
      return first(
        (c) => c.argv?.[0] === "diagnostics" && !probe(c) && c.exit === 0,
      );
    case "repair-or-response": {
      const observed = source();
      return observed >= 0 ? observed : completed ? calls.length : -1;
    }
    default:
      throw new Error(`Unknown required topic action: ${action}`);
  }
}
export function retrieveTopics(calls, declarations, options) {
  return declarations.map((entry) => {
    const topic = typeof entry === "string" ? entry : entry.topic;
    const beforeCommand =
      typeof entry === "string" ? "agent" : entry.beforeCommand;
    const legacyCutoff = calls.findIndex((c) => c.argv?.[0] === beforeCommand);
    const exactRead = calls.findIndex(
      (c) => c.argv?.[0] === "guide" && c.argv[1] === topic && c.exit === 0,
    );
    const legacy =
      exactRead >= 0 && (legacyCutoff < 0 || exactRead < legacyCutoff);
    // Other harness consumers may still supply legacy-only task metadata.
    if (!entry.before) return { topic, retrieved: legacy };
    const before = cutoff(entry.before, calls, options);
    const equivalents = new Set([topic, ...(entry.equivalents ?? [])]);
    const readAt = calls.findIndex(
      (c) =>
        c.argv?.[0] === "guide" &&
        equivalents.has(c.argv[1]) &&
        c.exit === 0 &&
        !probe(c),
    );
    const applicability =
      entry.before === "hookup" &&
      before < 0 &&
      options.acceptedIssueDraft &&
      atDraft(calls, options.final) >= 0
        ? "draft-only"
        : "required";
    return {
      topic,
      retrieved: readAt >= 0 && before >= 0 && readAt < before,
      legacy,
      applicability,
      action: entry.before,
      cutoffAt: before >= 0 ? before : null,
      readAt: readAt >= 0 ? readAt : null,
      via: readAt >= 0 ? calls[readAt].argv[1] : null,
    };
  });
}
