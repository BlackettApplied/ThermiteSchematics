import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { compileProject, lockProject } from "@thermite/compiler";
import { compareProject } from "../../../evals/engine/oracle.mjs";
import { renderSchematic } from "../src/renderer.js";
import { prepareCircuitView } from "../src/circuit.js";
import { renderSchematicPacket } from "../src/sheets.js";
import {
  identityProject,
  identityCircuit,
  mixedDisconnector,
} from "./symbol-identity-fixture.js";
import { contractProject } from "./rooted-profile-contracts.js";

for (const [profile, mode, family, expected] of [
  ["thermite:fuse", "contact-open", "power", "contact-no"],
  ["thermite:disconnector", "aux-closed", "control", "contact-nc"],
] as const)
  it.each(["left-to-right", "top-to-bottom"] as const)(
    `${profile} binds facts after source/key/UID reordering and renames in %s`,
    async (flow) => {
      const f = await identityProject(profile, mode, family, (t) => {
        if (profile === "thermite:disconnector") mixedDisconnector(t);
        else t.circuitSymbols = { function: "contact-no" };
      });
      try {
        const typeFile = join(f.root, "local/type.json"),
          sourceFile = join(f.root, "source.json");
        const document = JSON.parse(await readFile(typeFile, "utf8")),
          type = document.types[0];
        type.id = "local:unrelated";
        type.functions = Object.fromEntries(
          Object.entries(type.functions)
            .reverse()
            .map(([key, value]) => [key === "function" ? "piece" : key, value]),
        );
        if (type.circuitSymbols) type.circuitSymbols = { piece: "contact-no" };
        type.terminals = Object.fromEntries(
          Object.entries(type.terminals)
            .reverse()
            .map(([key, value]) => [
              key === "A" ? "X" : key === "B" ? "Y" : key,
              value,
            ]),
        );
        for (const fn of Object.values(type.functions) as any[])
          fn.terminals = fn.terminals.map((k: string) =>
            k === "A" ? "X" : k === "B" ? "Y" : k,
          );
        const source = JSON.parse(await readFile(sourceFile, "utf8"));
        source.objects.reverse();
        for (const o of source.objects) {
          o.uid = o.uid.replace(/^00000000/, "abcdefab");
          if (o.kind === "device" && o.designation === "DUT") {
            o.designation = "Z91";
            o.type = type.id;
          }
          for (const e of o.endpoints ?? [])
            if (e.device === "DUT") {
              e.device = "Z91";
              e.terminal =
                e.terminal === "A"
                  ? "X"
                  : e.terminal === "B"
                    ? "Y"
                    : e.terminal;
            }
        }
        await writeFile(typeFile, JSON.stringify(document));
        await writeFile(sourceFile, JSON.stringify(source));
        expect((await lockProject(f.root)).ok).toBe(true);
        const c = await compileProject(f.root);
        if (!c.ok) throw Error(JSON.stringify(c));
        await compareProject(f.root);
        const before = JSON.stringify(c.ir),
          r = await renderSchematic(c.ir, { ...(f.request as object), flow });
        expect(r.ok, JSON.stringify(r)).toBe(true);
        if (!r.ok) throw Error(r.error.message);
        expect(r.value.svg).toContain(`data-symbol-id="ais:${expected}"`);
        expect(
          new Set(r.value.summary.conductiveElementIds.map((e) => e.uid)),
        ).toEqual(new Set(c.ir.wires.map((w) => w.uid)));
        const dut = c.ir.devices.find((d) => d.designation === "Z91")!;
        const nets = ["X", "Y"].map(
          (key) =>
            c.ir.nets.find((n) =>
              n.terminalIds.some(
                (t) => t.deviceUid === dut.uid && t.terminalKey === key,
              ),
            )!.id,
        );
        expect(new Set(nets).size).toBe(2);
        const circuit = await prepareCircuitView(
          c.ir,
          identityCircuit(c.ir, flow, true, "Z91"),
        );
        expect(circuit.groups[0]!.content).toContain(
          `data-circuit-mark="${expected}"`,
        );
        expect(circuit.groups[0]!.coverage.conductorIds).toHaveLength(
          c.ir.wires.length,
        );
        expect(JSON.stringify(c.ir)).toBe(before);
      } finally {
        await f.dispose();
      }
    },
  );

for (const profile of ["thermite:fuse", "thermite:breaker"])
  for (const count of [1, 3])
    it.each(["left-to-right", "top-to-bottom"] as const)(
      `${profile} refuses invalid power/circuit arity ${count} in %s`,
      async (flow) => {
        const f = await contractProject(profile, "contact-open", "power");
        try {
          const type = f.ir.deviceTypes.find((t) => t.id === "local:dut")!;
          type.circuitSymbols = { function: "contact-no" };
          const fn = f.ir.functions.find(
              (f) => f.id.functionKey === "function",
            )!,
            definition = type.functions[0]!;
          definition.terminalKeys = count === 1 ? ["A"] : ["A", "B", "A"];
          fn.terminals =
            count === 1
              ? fn.terminals.slice(0, 1)
              : [...fn.terminals, fn.terminals[0]!];
          const r = await renderSchematic(f.ir, {
            ...(f.request as object),
            flow,
          });
          expect(r).toMatchObject({
            ok: false,
            error: { code: "R002" },
          });
          if (r.ok) throw Error("Invalid contact arity rendered");
          if (count === 3)
            expect(r.error.message).toContain(`(contact/${count}; terminals `);
          expect(r.error.message).not.toContain("No rooted power primitive");
          const circuit = await renderSchematicPacket(f.ir, {
            format: "schematic-packet-request/0.1",
            views: [identityCircuit(f.ir, flow)],
          });
          expect(circuit).toMatchObject({ ok: false, error: { code: "R006" } });
        } finally {
          await f.dispose();
        }
      },
    );

for (const profile of ["thermite:fuse", "thermite:breaker"])
  it.each([
    "contact-no",
    "contact-nc",
    "switch-no",
    "switch-nc",
    "pushbutton-no",
    "pushbutton-nc",
    "pressure-no",
    "level-nc",
  ])(`${profile} preserves source E206 for incompatible %s`, async (mark) => {
    const f = await contractProject(
      profile,
      mark.endsWith("-no") ? "contact-closed" : "contact-open",
      "power",
    );
    try {
      const file = join(f.root, "local/type.json"),
        doc = JSON.parse(await readFile(file, "utf8"));
      doc.types[0].circuitSymbols = { function: mark };
      await writeFile(file, JSON.stringify(doc));
      expect((await lockProject(f.root)).ok).toBe(true);
      const c = await compileProject(f.root);
      expect(c.ok).toBe(false);
      expect(
        c.diagnostics.filter((d) => d.severity === "error").map((d) => d.code),
      ).toEqual(["E206"]);
    } finally {
      await f.dispose();
    }
  });
