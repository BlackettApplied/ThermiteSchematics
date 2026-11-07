import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import { lockProject } from "../src/index.js";

export type Json = Record<string, unknown>;
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
export const uid = (n: number) =>
  `7f000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const device = (
  n: number,
  designation: string,
  type = "assessment:node",
): Json => ({ uid: uid(n), kind: "device", designation, type });
export const end = (device: string, terminal: string): Json => ({
  device,
  terminal,
});
export const wire = (n: number, a: Json, b: Json): Json => ({
  uid: uid(n),
  kind: "wire",
  designation: `W${n}`,
  endpoints: [a, b],
});
export const potential = (
  n: number,
  at: Json,
  electrical: Json,
  name = `P${n}`,
): Json => ({ uid: uid(n), kind: "potential", name, at, electrical });
export const node = (terminals: Json, functions: Json = {}): Json => ({
  kind: "device_type",
  id: "assessment:node",
  terminals,
  functions,
});
export async function project(objects: Json[], types: Json[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "thermite-validation-"));
  roots.push(root);
  await mkdir(join(root, "library"));
  const write = (p: string, v: unknown) =>
    writeFile(join(root, p), JSON.stringify(v, null, 2) + "\n");
  await write("system.json", {
    format: "electrical-system/0.1",
    project: { name: "Synthetic validation" },
    sources: ["objects.json"],
    libraries: [{ name: "assessment", version: "1.0.0", path: "library" }],
  });
  await write("objects.json", { objects });
  await write("library/library.json", {
    name: "assessment",
    version: "1.0.0",
    sources: ["types.json"],
  });
  await write("library/types.json", { types });
  await lockProject(root);
  return root;
}
