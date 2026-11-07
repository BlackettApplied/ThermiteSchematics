import { sourceDocuments } from "./source-files.mjs";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
export const read = (path) => JSON.parse(readFileSync(path, "utf8"));
export function write(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n",
  );
}
export const uid = (key) => {
  const h = createHash("sha256").update(key).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
export function cli(ctx, ...args) {
  const result = spawnSync(process.execPath, [ctx.thermite, ...args], {
    cwd: ctx.project,
    env: ctx.env ?? process.env,
    encoding: "utf8",
    maxBuffer: 64 << 20,
  });
  if (result.error) throw result.error;
  return result;
}
export function ok(ctx, ...args) {
  const r = cli(ctx, ...args);
  if (r.status !== 0)
    throw new Error(`${args.join(" ")}: exit ${r.status}\n${r.stderr}`);
  return r.stdout;
}
export const query = (ctx, ...args) => JSON.parse(ok(ctx, ...args));
export const documents = sourceDocuments;
export const objects = (project) =>
  documents(project).flatMap((d) => d.objects);
export function locate(project, designation) {
  for (const document of documents(project)) {
    const index = document.objects.findIndex(
      (o) => o.designation === designation,
    );
    if (index >= 0)
      return { file: document.path, index, object: document.objects[index] };
  }
  throw new Error(`Missing ${designation}`);
}
export function patch(ctx, files) {
  const request = {
    format: "agent-tool-request/0.1",
    project: ".",
    patchFormat: "json-patch/0.1",
    dryRun: true,
    files: Object.entries(files).map(([path, operations]) => ({
      path,
      operations,
      expectedIntegrity:
        "sha256-" +
        createHash("sha256")
          .update(readFileSync(join(ctx.project, path)))
          .digest("base64"),
    })),
  };
  const requestPath = join(ctx.project, "requests/reference.json");
  write(requestPath, request);
  ok(ctx, "agent", "apply-source-patch", "--input", requestPath);
  request.dryRun = false;
  write(requestPath, request);
  ok(ctx, "agent", "apply-source-patch", "--input", requestPath);
}
export function replaceObject(ctx, designation, field, value) {
  const { file, index, object } = locate(ctx.project, designation);
  patch(ctx, {
    [file]: [
      { op: "test", path: `/objects/${index}/uid`, value: object.uid },
      {
        op: Object.hasOwn(object, field) ? "replace" : "add",
        path: `/objects/${index}/${field}`,
        value,
      },
    ],
  });
}
export function addSource(ctx, name, added) {
  write(join(ctx.project, name), { objects: added });
  const path = join(ctx.project, "system.json"),
    manifest = read(path);
  manifest.sources.push(name);
  write(path, manifest);
}
export const device = (tag, type, extra = {}) => ({
  uid: uid(tag),
  kind: "device",
  designation: tag,
  type,
  ...extra,
});
export const wire = (tag, from, to) => ({
  uid: uid(tag),
  kind: "wire",
  designation: tag,
  endpoints: [from, to],
});
export const ep = (device, terminal) => ({ device, terminal });
export { pdf } from "./artifacts.mjs";
export const docView = (kind) => ({
  format: "documentation-view-request/0.1",
  kind,
});
export const view = (root, kind) =>
  ["power", "control"].includes(kind)
    ? {
        format: "schematic-view-request/0.1",
        root: { by: "designation", value: root },
        family: kind,
      }
    : {
        format: "schematic-view-request/0.2",
        root: { by: "designation", value: root },
        intent: { kind },
      };
export function packet(ctx, views, name = "packet", extra = {}) {
  const request = {
    format: "schematic-packet-request/0.1",
    index: true,
    views,
    ...extra,
  };
  const input = join(ctx.project, `requests/${name}.json`);
  write(input, request);
  for (const ext of ["json", "html", "pdf"])
    ok(ctx, "packet", "--input", input, "-o", `drawings/${name}.${ext}`);
}
