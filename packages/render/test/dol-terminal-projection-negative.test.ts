import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compileProject } from "@thermite/compiler";
import { expect, it } from "vitest";
import {
  coreTypes,
  machineProbe,
} from "../../core-library/test/machine-fixtures.js";
import { renderSchematic } from "../src/renderer.js";
import { selectSemanticSubgraph } from "../src/selection.js";
import { projectDeviceTypeSymbolMappings } from "../src/symbols/mappings.js";
import { normalizeSchematicView } from "../src/view-spec.js";

const cases = [
  { kind: "lamp", typeId: "core:pilot-light", key: "lamp", terminal: "X1" },
  {
    kind: "unsupported coil",
    typeId: "core:relay-1co",
    key: "contact14",
    terminal: "A1",
  },
] as const;
const flows = ["left-to-right", "top-to-bottom"] as const;
const request = (flow: (typeof flows)[number]) => ({
  format: "schematic-view-request/0.1" as const,
  root: { by: "designation" as const, value: "K1" },
  family: "control" as const,
  flow,
});
async function inputPassThrough(c: (typeof cases)[number]) {
  const type = (await coreTypes()).find((t) => t.id === c.typeId);
  const probe = await machineProbe(type, "control", c.key);
  try {
    const file = join(probe.root, "source.json");
    const source = JSON.parse(await readFile(file, "utf8"));
    source.objects = source.objects.filter((o: any) => o.kind !== "wire");
    source.objects.find((o: any) => o.designation === "DUT").designation = "H1";
    const pairs = [
      ["W-in", "PS1.+", `H1.${c.terminal}`],
      ["W-out", `H1.${c.terminal}`, "K1.A1"],
      ["W-return", "K1.A2", "PS1.-"],
    ];
    for (const [index, [designation, from, to]] of pairs.entries()) {
      source.objects.push({
        kind: "wire",
        uid: `62000000-0000-4000-8000-00000000000${index + 1}`,
        designation,
        endpoints: [from!, to!].map((value) => {
          const split = value.indexOf(".");
          return {
            device: value.slice(0, split),
            terminal: value.slice(split + 1),
          };
        }),
      });
    }
    await writeFile(file, JSON.stringify(source));
    const compiled = await compileProject(probe.root);
    if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
    const ir = structuredClone(compiled.ir);
    if (c.kind === "unsupported coil")
      ir.deviceTypes.find((t) => t.id === c.typeId)!.symbol = "thermite:lamp";
    return ir;
  } finally {
    await probe.dispose();
  }
}

function terminalMessage(c: (typeof cases)[number]): string {
  return `Unsupported terminal representation: H1.${c.terminal} on "${c.typeId}" is incident to selected conductors W-in, W-out but has no selected function, mapped terminal-display symbol, or boundary representation in this rooted view. Use a circuit view to draw these conductors with their real endpoint terminals. Put details.alternative in the views array of a schematic-packet-request/0.1 file and run thermite packet --input <file>. The alternative selects K1.coil.`;
}
const unsupportedCoilMessage =
  'Unsupported symbol profile: device "H1", type "core:relay-1co", profile "thermite:lamp" has no control rule for function "coil" (coil/2; terminals H1.A1, H1.A2). Check the profile and authored function shape against the symbol catalog; a profile change does not change connectivity.';

it.each(cases.flatMap((c) => flows.map((flow) => ({ c, flow }))))(
  "refuses a $c.kind on the input path with the exact R003 in $flow",
  async ({ c, flow }) => {
    const ir = await inputPassThrough(c);
    const before = JSON.stringify(ir);
    const rendered = await renderSchematic(ir, request(flow));
    expect(rendered).toMatchObject({
      ok: false,
      error: {
        code: "R003",
        message:
          c.kind === "lamp" ? terminalMessage(c) : unsupportedCoilMessage,
        details: {
          reason:
            c.kind === "lamp"
              ? "unrepresented-terminal"
              : "unsupported-symbol-profile",
        },
      },
    });
    expect(JSON.stringify(ir)).toBe(before);
  },
);

it.each(cases.flatMap((c) => flows.map((flow) => ({ c, flow }))))(
  "checks the $c.kind owner independently of the other guard in $flow",
  async ({ c, flow }) => {
    const ir = await inputPassThrough(c);
    const mappings = projectDeviceTypeSymbolMappings(ir);
    const normalized = normalizeSchematicView(ir, request(flow), { mappings });
    if (!normalized.ok) throw Error(JSON.stringify(normalized));
    const owner = ir.functions.find(
      (f) =>
        f.id.deviceUid ===
          ir.devices.find((d) => d.designation === "H1")!.uid &&
        f.terminals.some((t) => t.terminalKey === c.terminal),
    )!;
    // Catalog roles normally imply kind. Supply a deliberately inconsistent
    // mapping at the selection boundary to exercise each guard independently:
    // a lamp must not become a coil through a role, and an actual coil needs
    // coil-root support, not merely a binding for each of its terminals.
    const supplied = mappings.map((m) =>
      m.typeId !== c.typeId
        ? m
        : {
            ...m,
            functions: [
              {
                functionKey: owner.id.functionKey,
                families: ["control"] as const,
                symbolId: "ais:coil" as const,
                bindings: owner.terminals.map((t, i) => ({
                  portId: i === 0 ? "A1" : "A2",
                  terminalKey: t.terminalKey,
                })),
                classification: "coil" as const,
                traversalRole:
                  c.kind === "lamp"
                    ? ("coil-root" as const)
                    : ("load-boundary" as const),
              },
            ],
          },
    );
    const selected = selectSemanticSubgraph({
      ir,
      ...normalized.value,
      mappings: supplied,
    });
    expect(selected).toMatchObject({
      ok: false,
      error: {
        code: "R003",
        message: terminalMessage(c),
        details: { reason: "unrepresented-terminal", alternative: { flow } },
      },
    });
  },
);
