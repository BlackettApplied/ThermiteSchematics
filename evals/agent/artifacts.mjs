import {
  cpSync,
  existsSync,
  readFileSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve, isAbsolute, relative } from "node:path";
import { cli, read } from "./task-support.mjs";
import { canonical, libraryTypes, sourceDocuments } from "./source-files.mjs";
import { sha256 } from "./snapshot.mjs";
let pdfjs;
export async function pdfInfo(path) {
  try {
    if (
      !existsSync(path) ||
      readFileSync(path).subarray(0, 5).toString() !== "%PDF-"
    )
      return { valid: false, pages: 0, text: "" };
    pdfjs ??= await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = pdfjs.getDocument({
      data: new Uint8Array(readFileSync(path)),
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
  cpSync(ctx.project, project, {
    recursive: true,
    filter: (path) =>
      ![/[/\\]\.git(?:[/\\]|$)/].some((re) =>
        re.test(path.slice(ctx.project.length)),
      ),
  });
  mkdirSync(join(project, "drawings"), { recursive: true });
  ctx.clean = { ...ctx, project, originalProject: ctx.project };
  return ctx.clean;
}
function outputArg(argv) {
  const i = argv.findIndex((a) => a === "-o" || a === "--output");
  return i >= 0 ? argv[i + 1] : null;
}
function commandFor(ctx, artifact, fallback) {
  const calls = ctx.calls ?? [];
  const matches = calls.filter(
    (c) =>
      c.phase !== "flush" &&
      c.exit === 0 &&
      ["view", "packet"].includes(c.argv?.[0]) &&
      outputArg(c.argv) &&
      resolve(ctx.project, outputArg(c.argv)) ===
        resolve(ctx.project, artifact),
  );
  return matches.at(-1)?.argv ?? fallback;
}
function remap(argv, ctx, out) {
  const clean = cleanChecker(ctx),
    result = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-o" || arg === "--output") {
      result.push(arg, out);
      i++;
      continue;
    }
    if (arg === "--project") {
      result.push(arg, clean.project);
      i++;
      continue;
    }
    if (arg === "--input" || arg.startsWith("--input=")) {
      const value = arg === "--input" ? argv[++i] : arg.slice(8);
      const logged = (ctx.calls ?? [])
        .filter(
          (c) =>
            c.exit === 0 &&
            canonical(c.argv) === canonical(argv) &&
            typeof c.request === "string",
        )
        .at(-1);
      if (logged) {
        const path = out + ".request.json";
        writeFileSync(path, logged.request);
        result.push("--input", path);
      } else if (value !== "-")
        result.push(
          "--input",
          value.startsWith(ctx.project)
            ? clean.project + value.slice(ctx.project.length)
            : value,
        );
      else return null;
      continue;
    }
    result.push(
      typeof arg === "string" && arg.startsWith(ctx.project)
        ? clean.project + arg.slice(ctx.project.length)
        : arg,
    );
  }
  if (!outputArg(result)) result.push("-o", out);
  return result;
}
export async function regenerateView(ctx, artifact, fallback, expected = {}) {
  const clean = cleanChecker(ctx),
    output = join(ctx.evidence, "regenerated-" + artifact.split("/").at(-1));
  const command = commandFor(ctx, artifact, fallback);
  if (!command) return { pass: false, reason: "missing-view-command" };
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
  const typeMap = new Map(libraryTypes(ctx.project).map((t) => [t.id, t])),
    objectMap = new Map(
      sourceDocuments(ctx.project)
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
  return {
    pass:
      result.status === 0 &&
      (await pdf(join(ctx.project, artifact))) &&
      (await pdf(output)) &&
      sha256(readFileSync(join(ctx.project, artifact))) ===
        sha256(readFileSync(output)),
    exit: result.status,
  };
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
    commands[ext] = command;
    const mapped = remap(command, ctx, output);
    if (!mapped) {
      valid = false;
      continue;
    }
    const result = cli(clean, ...mapped);
    if (result.status !== 0 || !existsSync(join(ctx.project, artifact))) {
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
        artifact = join(ctx.project, `drawings/${name}.${ext}`);
      if (ext === "json") {
        if (canonical(read(artifact)) !== canonical(read(output)))
          return { pass: false };
      } else {
        if (!readFileSync(output).equals(readFileSync(artifact)))
          return { pass: false };
        if (ext === "pdf" && !(await pdf(output))) return { pass: false };
      }
    }
    return { pass: true };
  } catch {
    return { pass: false };
  }
}
