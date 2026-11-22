import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, expect, it } from "vitest";
import {
  compileProject,
  lockProject,
  type ElectricalIr,
} from "@thermite/compiler";
import { buildDocumentation } from "../src/documentation.js";

let ir: ElectricalIr;
beforeAll(async () => {
  const root = await mkdtemp(join(tmpdir(), "thermite-io-terminal-sets-"));
  try {
    await mkdir(join(root, "library"));
    const channel = (terminals: string[]) => ({
      kind: "channel",
      direction: "input",
      terminals,
    });
    const files = {
      "system.json": {
        format: "electrical-system/0.1",
        project: { name: "Synthetic multi-terminal channel labels" },
        sources: ["source.json"],
        libraries: [
          { name: "print-fixture", version: "0.1.0", path: "library" },
        ],
      },
      "source.json": {
        objects: [
          {
            uid: "57000000-0000-4000-8000-000000000001",
            kind: "device",
            designation: "IO1",
            type: "print-fixture:io",
          },
        ],
      },
      "library/library.json": {
        name: "print-fixture",
        version: "0.1.0",
        sources: ["types.json"],
      },
      "library/types.json": {
        types: [
          {
            kind: "device_type",
            id: "print-fixture:io",
            description: "Synthetic I/O; no part or rating asserted",
            connectionCoverage: {
              status: "generic",
              notes: "Synthetic terminal-set regression fixture.",
            },
            terminals: Object.fromEntries(
              ["13", "14", "+", "-"].map((name) => [name, {}]),
            ),
            functions: {
              pair: channel(["13", "14"]),
              polarity: channel(["+", "-"]),
            },
          },
        ],
      },
    };
    await Promise.all(
      Object.entries(files).map(([path, value]) =>
        writeFile(join(root, path), JSON.stringify(value)),
      ),
    );
    const locked = await lockProject(root);
    expect(locked.ok, JSON.stringify(locked)).toBe(true);
    const compiled = await compileProject(root);
    if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
    ir = compiled.ir;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it.each([
  { key: "pair", printed: "IO1.13–IO1.14", csv: "IO1.13, IO1.14" },
  {
    key: "polarity",
    printed: "IO1.+ / IO1.-",
    csv: "IO1.+, IO1.-",
  },
])(
  "prints the authored $key terminal set while preserving CSV identities",
  (entry) => {
    const before = JSON.stringify(ir);
    for (const output of ["print", "csv"] as const) {
      const table = buildDocumentation(
        ir,
        { format: "documentation-view-request/0.1", kind: "io" },
        undefined,
        { output },
      );
      expect(table.columns[6]).toBe("Terminals");
      const row = table.rows.find((r) => JSON.parse(r.key)[1] === entry.key)!;
      expect(row.cells[6]).toBe(output === "print" ? entry.printed : entry.csv);
    }
    expect(JSON.stringify(ir)).toBe(before);
  },
);
