import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve, isAbsolute, relative, sep } from "node:path";
import { cli, read } from "./task-support.mjs";
import {
  assertConfinedProjectPaths,
  canonical,
  libraryTypes,
  sourceDocuments,
} from "./source-files.mjs";
import { copyConfinedTree, projectReader } from "./capture-files.mjs";
let pdfjs;
export async function pdfInfo(path) {
  try {
    return await parsePdf(readFileSync(path));
  } catch {
    return { valid: false, pages: 0, text: "" };
  }
}
async function parsePdf(bytes) {
  try {
    if (bytes.subarray(0, 5).toString() !== "%PDF-")
      return { valid: false, pages: 0, text: "" };
    pdfjs ??= await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = pdfjs.getDocument({
      data: new Uint8Array(bytes),
      verbosity: 0,
      useSystemFonts: false,
      isEvalSupported: false,
      disableFontFace: true,
    });
    const doc = await task.promise;
    let text = "";
    const pages = doc.numPages;
    for (let n = 1; n <= pages; n++) {
      const page = await doc.getPage(n);
      text +=
        (await page.getTextContent()).items
          .map((item) => item.str ?? "")
          .join(" ") + "\n";
    }
    await task.destroy();
    return { valid: pages > 0 && text.trim().length > 0, pages, text };
  } catch {
    return { valid: false, pages: 0, text: "" };
  }
}
export async function pdf(path) {
  return (await pdfInfo(path)).valid;
}
export function cleanChecker(ctx) {
  if (ctx.clean) return ctx.clean;
  const project = join(ctx.evidence, "checker-input");
  const source = projectReader(ctx.project);
  try {
    copyConfinedTree(source, project);
    assertConfinedProjectPaths(project);
  } finally {
    source.close();
  }
  mkdirSync(join(project, "drawings"), { recursive: true });
  ctx.clean = { ...ctx, project };
  return ctx.clean;
}
const printSwitches = new Set(["--index", "--json"]);
const printValues = new Set([
  "--input",
  "--project",
  "-o",
  "--output",
  "--paper",
  "--orientation",
  "--layout",
  "--margin",
]);
const viewSwitches = new Set([
  "--power",
  "--actuation",
  "--loads",
  "--conductors",
  "--include-power",
]);
const viewValues = new Set(["--to", "--flow"]);

// Rebuild a view/packet invocation from its allowed options. File arguments
// are always supplied by the checker or resolved inside its staged copy.
function parsePrint(argv) {
  if (
    !Array.isArray(argv) ||
    !argv.every((arg) => typeof arg === "string") ||
    !["view", "packet"].includes(argv[0])
  )
    return null;
  const kind = argv[0],
    view = kind === "view",
    options = [],
    files = {};
  let root;
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (view && !root && !arg.startsWith("-")) {
      root = arg;
      continue;
    }
    if (
      printSwitches.has(arg) ||
      (view ? viewSwitches.has(arg) : arg === "--strict")
    ) {
      options.push(arg);
      continue;
    }
    const equals = arg.indexOf("="),
      key = equals < 0 ? arg : arg.slice(0, equals);
    if (!printValues.has(key) && !(view && viewValues.has(key))) return null;
    const value = equals < 0 ? argv[++i] : arg.slice(equals + 1);
    if (!value || (value.startsWith("-") && value !== "-")) return null;
    if (key === "-o" || key === "--output") files.output = value;
    else if (key === "--project") files.project = value;
    else if (key === "--input" && !view) files.input = value;
    else if (key === "--input") return null;
    else options.push(key, value);
  }
  if (view ? !root : !files.input) return null;
  return { argv: [kind, ...(view ? [root] : []), ...options], ...files };
}
function commandFor(ctx, artifact, fallback) {
  const project = ctx.originalProject ?? ctx.project;
  for (const call of [...(ctx.calls ?? [])].reverse()) {
    if (call?.phase === "flush" || call?.exit !== 0) continue;
    const parsed = parsePrint(call.argv);
    if (
      parsed?.output &&
      resolve(project, parsed.output) === resolve(project, artifact)
    )
      return { parsed, argv: call.argv, request: call.request };
  }
  return fallback ? { parsed: parsePrint(fallback), argv: fallback } : null;
}
function remap(command, ctx, out) {
  const parsed = command?.parsed;
  if (!parsed) return null;
  const project = ctx.originalProject ?? ctx.project,
    clean = cleanChecker(ctx),
    result = [...parsed.argv];
  if (parsed.project && resolve(project, parsed.project) !== project)
    return null;
  if (parsed.input) {
    const path = relative(project, resolve(project, parsed.input));
    if (
      !path ||
      path === ".." ||
      path.startsWith(".." + sep) ||
      isAbsolute(path)
    )
      return null;
    if (typeof command.request === "string") {
      const request = out + ".request.json";
      writeFileSync(request, command.request);
      result.push("--input", request);
    } else if (parsed.input !== "-") {
      result.push("--input", join(clean.project, path));
    } else return null;
  }
  return [...result, "--project", clean.project, "-o", out];
}
function deliveredBytes(ctx, artifact) {
  const source = projectReader(ctx.project);
  try {
    return source.read(artifact);
  } finally {
    source.close();
  }
}
export async function deliveredPdf(ctx, artifact) {
  try {
    return (await parsePdf(deliveredBytes(ctx, artifact))).valid;
  } catch {
    return false;
  }
}
export async function regenerateView(ctx, artifact, fallback, expected = {}) {
  const command = commandFor(ctx, artifact, fallback);
  if (!command) return { pass: false, reason: "missing-view-command" };
  const clean = cleanChecker(ctx),
    output = join(ctx.evidence, "regenerated-" + artifact.split("/").at(-1));
  const mapped = remap(command, ctx, output);
  if (!mapped) return { pass: false, reason: "missing-input-request" };
  const kind =
    expected.kind ??
    (fallback?.includes("--actuation")
      ? "control"
      : fallback?.includes("--power")
        ? "power"
        : fallback?.includes("--loads")
          ? "loads"
          : fallback?.includes("--conductors")
            ? "conductors"
            : null);
  const roots =
    expected.roots ?? (fallback?.[0] === "view" ? [fallback[1]] : []);
  const metaOutput = output + ".json",
    metaMapped = remap(command, ctx, metaOutput),
    metadata = metaMapped ? cli(clean, ...metaMapped) : null;
  let packet;
  try {
    packet = metadata?.status === 0 ? read(metaOutput) : null;
  } catch {}
  const typeMap = new Map(libraryTypes(clean.project).map((t) => [t.id, t])),
    objectMap = new Map(
      sourceDocuments(clean.project)
        .flatMap((d) => d.objects)
        .map((o) => [o.designation, o]),
    );
  const matches =
    packet?.sheets?.some((sheet) => {
      const view = sheet.view ?? {},
        intent =
          typeof view.intent === "string" ? view.intent : view.intent?.kind;
      if (expected.allowedKinds?.includes(view.kind)) return true;
      if (
        roots.includes(view.root?.designation) &&
        (kind === "power" || kind === "control"
          ? view.family === kind
          : intent === kind)
      )
        return true;
      if (view.kind !== "circuit") return false;
      const functionKind =
        kind === "control"
          ? "coil"
          : kind === "power"
            ? "load"
            : kind === "loads"
              ? "source"
              : null;
      return (
        functionKind &&
        sheet.references?.some(
          (ref) =>
            roots.includes(ref.designation) &&
            ref.functions?.some(
              (key) =>
                typeMap.get(objectMap.get(ref.designation)?.type)?.functions?.[
                  key
                ]?.kind === functionKind,
            ),
        )
      );
    }) ?? false;
  if (!matches)
    return {
      pass: false,
      reason: "view-metadata-mismatch",
      exit: metadata?.status ?? null,
    };
  const result = cli(clean, ...mapped);
  let pass = false;
  if (result.status === 0)
    try {
      const delivered = deliveredBytes(ctx, artifact);
      pass =
        readFileSync(output).equals(delivered) &&
        (await parsePdf(delivered)).valid;
    } catch {}
  return { pass, exit: result.status };
}
// The judge receives delivered files from the top level of drawings/.
export async function findRegeneratedView(ctx, expected) {
  const source = projectReader(ctx.project);
  let pdfs;
  try {
    pdfs = source
      .list("drawings")
      .filter((name) => name.endsWith(".pdf"))
      .sort();
  } catch {
    return null;
  } finally {
    source.close();
  }
  for (const name of pdfs) {
    const artifact = `drawings/${name}`;
    if ((await regenerateView(ctx, artifact, null, expected)).pass)
      return artifact;
  }
  return null;
}
export async function regeneratePacket(
  ctx,
  { request = "requests/packet.json", name = "packet" } = {},
) {
  const clean = cleanChecker(ctx),
    prefix = join(ctx.evidence, `regenerated-${name}`),
    commands = {};
  let packet = null,
    valid = true;
  for (const ext of ["json", "pdf", "html"]) {
    const artifact = `drawings/${name}.${ext}`,
      output = `${prefix}.${ext}`;
    const fallback = ["packet", "--input", request, "-o", artifact];
    const command = commandFor(ctx, artifact, fallback);
    commands[ext] = command.argv;
    const mapped = remap(command, ctx, output);
    if (!mapped) {
      valid = false;
      continue;
    }
    const result = cli(clean, ...mapped);
    if (result.status !== 0) {
      valid = false;
      continue;
    }
    if (ext === "json") packet = read(output);
  }
  const result = await comparePacketArtifacts(ctx, { name, prefix });
  return { pass: valid && result.pass, packet, commands, prefix };
}
export async function comparePacketArtifacts(
  ctx,
  { name = "packet", prefix = join(ctx.evidence, `regenerated-${name}`) } = {},
) {
  try {
    for (const ext of ["json", "pdf", "html"]) {
      const output = `${prefix}.${ext}`,
        artifact = deliveredBytes(ctx, `drawings/${name}.${ext}`);
      if (ext === "json") {
        if (canonical(JSON.parse(artifact)) !== canonical(read(output)))
          return { pass: false };
      } else {
        if (!readFileSync(output).equals(artifact)) return { pass: false };
        if (ext === "pdf" && !(await pdf(output))) return { pass: false };
      }
    }
    return { pass: true };
  } catch {
    return { pass: false };
  }
}
