import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  compileProject,
  lockProject,
  type ElectricalIr,
} from "@thermite/compiler";
import { renderSchematic } from "../src/renderer.js";
import { projectDeviceTypeSymbolMappings } from "../src/symbols/mappings.js";
import { isFunctionTraversable } from "../src/symbols/validate.js";
import { compileCoreFixture, materializeTypeFunctions } from "./fixtures.js";
let core: ElectricalIr;
const temporary: string[] = [];
beforeAll(async () => {
  core = await compileCoreFixture();
});
afterAll(async () => {
  await Promise.all(
    temporary.map((p) => rm(p, { recursive: true, force: true })),
  );
});
describe("profile binding edge cases", () => {
  it.each(["contact", "other"] as const)(
    "draws power through a fuse %s without a traversal change",
    async (kind) => {
      const ir = structuredClone(core),
        type = ir.deviceTypes.find((t) => t.id === "core:breaker-3p")!;
      type.symbol = "thermite:fuse";
      if (kind === "other") {
        type.functions = type.functions.map((f) =>
          f.kind === "contact"
            ? {
                key: f.key,
                kind: "other",
                terminalKeys: f.terminalKeys,
                source: f.source,
              }
            : f,
        );
        const device = ir.devices.find((d) => d.typeId === type.id)!;
        ir.functions = ir.functions.filter(
          (f) => f.id.deviceUid !== device.uid,
        );
        ir.functions.push(...materializeTypeFunctions(type, device.uid));
      }
      const rules = projectDeviceTypeSymbolMappings(ir).find(
        (m) => m.typeId === type.id,
      )!.functions;
      expect(
        rules.every(
          (r) =>
            r.symbolId === "ais:fuse" &&
            r.traversalRole === "breaker-pole" &&
            isFunctionTraversable("power", r.traversalRole),
        ),
      ).toBe(true);
      for (const flow of ["left-to-right", "top-to-bottom"] as const) {
        const r = await renderSchematic(ir, {
          format: "schematic-view-request/0.1",
          root: { by: "designation", value: "M1" },
          family: "power",
          flow,
        });
        expect(r.ok, JSON.stringify(r)).toBe(true);
        if (r.ok) expect(r.value.svg).toContain("ais:fuse");
      }
    },
  );
  it("rejects two NO trace contacts instead of selecting the first", async () => {
    const root = await mkdtemp(join(tmpdir(), "thermite-two-no-"));
    temporary.push(root);
    await cp(resolve("examples/motor-starter"), root, { recursive: true });
    await mkdir(join(root, "local"));
    const type = JSON.parse(
      await readFile(
        resolve("packages/core-library/library/types/limit-switch-2wire.json"),
        "utf8",
      ),
    ).types[0];
    type.id = "local:two-no";
    type.terminals["23"] = {};
    type.terminals["24"] = {};
    type.functions = {
      contact23: {
        kind: "contact",
        normal_state: "open",
        terminals: ["23", "24"],
      },
      ...type.functions,
    };
    await writeFile(
      join(root, "local/library.json"),
      JSON.stringify({
        name: "local",
        version: "0.1.0",
        sources: ["type.json"],
      }),
    );
    await writeFile(
      join(root, "local/type.json"),
      JSON.stringify({ types: [type] }),
    );
    const manifest = JSON.parse(
      await readFile(join(root, "system.json"), "utf8"),
    );
    manifest.libraries.push({ name: "local", version: "0.1.0", path: "local" });
    await writeFile(join(root, "system.json"), JSON.stringify(manifest));
    const p = join(root, "devices/equipment.json");
    await writeFile(
      p,
      (await readFile(p, "utf8")).replace("core:limit-switch-2wire", type.id),
    );
    expect((await lockProject(root)).ok).toBe(true);
    const c = await compileProject(root);
    if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
    const r = await renderSchematic(c.ir, {
      format: "schematic-view-request/0.2",
      root: { by: "designation", value: "LS1" },
      intent: {
        kind: "trace",
        to: { by: "designation", value: "PLC1" },
        includePower: false,
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("R001");
      expect(r.error.message).toContain("one supported mapped trace-root rule");
    }
  });
  it("names the unfed starter AC line precisely", async () => {
    const c = await compileProject(
      resolve("packages/cli/templates/starter-default"),
    );
    if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
    const ps = c.ir.devices.find((d) => d.designation === "PS1")!;
    expect(
      c.ir.wires
        .flatMap((w) => w.endpoints)
        .filter(
          (e) =>
            e.terminal.deviceUid === ps.uid &&
            ["L", "N"].includes(e.terminal.terminalKey),
        ),
    ).toEqual([]);
    const r = await renderSchematic(c.ir, {
      format: "schematic-view-request/0.1",
      root: { by: "designation", value: "PS1" },
      family: "power",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatchObject({ code: "R002", lane: "line" });
      expect(r.error.message).toContain("PS1.L");
      expect(r.error.message).toContain("unfed");
    }
  });
});
