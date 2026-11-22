import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  compileProject,
  lockProject,
  type ElectricalIr,
} from "@thermite/compiler";
import type { ValidatedDeviceType } from "@thermite/schema";
import {
  contractProject,
  type RootedFamily,
} from "./rooted-profile-contracts.js";

export async function identityProject(
  profile: string,
  mode: string,
  family: RootedFamily,
  author?: (type: ValidatedDeviceType) => void,
) {
  const fixture = await contractProject(profile, mode, family);
  const file = join(fixture.root, "local/type.json");
  const document = JSON.parse(await readFile(file, "utf8"));
  author?.(document.types[0]);
  await writeFile(file, JSON.stringify(document, null, 2) + "\n");
  const lock = await lockProject(fixture.root);
  if (!lock.ok) throw Error(JSON.stringify(lock));
  const compiled = await compileProject(fixture.root);
  if (!compiled.ok) throw Error(JSON.stringify(compiled));
  return { ...fixture, ir: compiled.ir, diagnostics: compiled.diagnostics };
}

export function mixedDisconnector(type: ValidatedDeviceType) {
  type.terminals = {
    ...type.terminals,
    L: { role: "power_input" },
    T: { role: "power_output" },
    P: { role: "power_input" },
    Q: { role: "power_output" },
    C: { role: "aux" },
    D: { role: "aux" },
  };
  type.functions = {
    main1: { kind: "contact", normal_state: "open", terminals: ["L", "T"] },
    main2: { kind: "contact", normal_state: "open", terminals: ["P", "Q"] },
    ...type.functions,
    spare: { kind: "contact", normal_state: "closed", terminals: ["C", "D"] },
  };
  type.internal_relations = [
    { relation: "ganged_with", from: "main1", to: "main2" },
  ];
}

export function identityCircuit(
  ir: ElectricalIr,
  flow: "left-to-right" | "top-to-bottom",
  wholePath = false,
  designation = "DUT",
) {
  const dut = ir.devices.find((d) => d.designation === designation)!;
  const used = new Set(
    ir.wires.flatMap((w) => w.endpoints.map((e) => JSON.stringify(e.terminal))),
  );
  const functions = ir.functions.filter(
    (f) =>
      f.kind !== "mechanism" &&
      (f.id.deviceUid === dut.uid ||
        (wholePath && f.terminals.some((t) => used.has(JSON.stringify(t))))),
  );
  return {
    format: "circuit-view-request/0.1" as const,
    title: "Authored function identities",
    flow,
    groups: [
      {
        id: "identity",
        functions: functions.map((f) => ({
          device: { by: "uid" as const, value: f.id.deviceUid },
          key: f.id.functionKey,
        })),
        conductors: wholePath
          ? ir.wires.map((w) => w.designation!)
          : ([] as string[]),
      },
    ],
  };
}
