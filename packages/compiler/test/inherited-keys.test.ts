import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Diagnostic } from "@thermite/schema";
import { afterEach, describe, expect, it } from "vitest";

import { compileProject, lockProject } from "../src/index.js";

// Authored map keys are looked up as own properties only. Names inherited from
// Object.prototype, such as "constructor", are undeclared.

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const uid = (index: number): string =>
  `7f000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

async function compilePortLink(fromPort: string): Promise<Diagnostic[]> {
  const root = await mkdtemp(join(tmpdir(), "thermite-inherited-keys-"));
  roots.push(root);
  const write = (path: string, value: unknown) =>
    writeFile(join(root, path), `${JSON.stringify(value, null, 2)}\n`);
  await mkdir(join(root, "library"));
  await write("system.json", {
    format: "electrical-system/0.1",
    project: { name: "Inherited key fixture" },
    sources: ["source.json"],
    libraries: [{ name: "keys", version: "0.1.0", path: "library" }],
  });
  await write("library/library.json", {
    name: "keys",
    version: "0.1.0",
    sources: ["types.json"],
  });
  await write("library/types.json", {
    types: [
      {
        kind: "device_type",
        id: "keys:plc",
        terminals: {},
        functions: {},
        ports: { P1: { medium: "ethernet", connector: "RJ45" } },
      },
    ],
  });
  await write("source.json", {
    objects: [
      { uid: uid(1), kind: "device", designation: "A", type: "keys:plc" },
      { uid: uid(2), kind: "device", designation: "B", type: "keys:plc" },
      {
        uid: uid(3),
        kind: "relation",
        designation: "NET1",
        relation: "associated_with",
        from: { device: "A" },
        to: { device: "B" },
        connection: {
          medium: "ethernet",
          protocol: "test",
          fromPort,
          toPort: "P1",
        },
      },
    ],
  });
  await lockProject(root);
  const result = await compileProject(root);
  expect(result.ok).toBe(false);
  return result.diagnostics;
}

describe("E204 communication ports are own declarations", () => {
  it.each(["constructor", "toString", "__proto__", "hasOwnProperty"])(
    "reports inherited name %j as an undeclared port",
    async (fromPort) => {
      const diagnostics = await compilePortLink(fromPort);
      expect(
        diagnostics.map(({ code, message, related }) => ({
          code,
          message,
          note: related?.[0]?.note,
        })),
      ).toEqual([
        {
          code: "E204",
          message: `A.${fromPort} is not a declared communication port.`,
          note: 'Device type "keys:plc" declares the valid communication ports.',
        },
      ]);
    },
  );
});
