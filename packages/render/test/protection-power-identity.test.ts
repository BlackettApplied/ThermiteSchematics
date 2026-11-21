import { expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { compareProject } from "../../../evals/engine/oracle.mjs";
import { renderSchematic } from "../src/renderer.js";
import { prepareCircuitView } from "../src/circuit.js";
import { circuitMark } from "../src/symbols/circuit.js";
import { projectDeviceTypeSymbolMappings } from "../src/symbols/mappings.js";
import { printableCaption } from "../src/symbols/printable-policy.js";
import { contractProject } from "./rooted-profile-contracts.js";
import { identityCircuit, identityProject } from "./symbol-identity-fixture.js";

const marks = [
  undefined,
  "fuse",
  "breaker",
  "overload",
  "contact-no",
  "contact-nc",
  "switch-no",
  "switch-nc",
  "pushbutton-no",
  "pushbutton-nc",
  "pressure-no",
  "pressure-nc",
  "level-no",
  "level-nc",
] as const;
const powerIdentities = {
  fuse: ["ais:fuse", "protection", "breaker-pole"],
  breaker: ["ais:breaker-pole", "protection", "breaker-pole"],
  overload: ["ais:overload-pole", "overload", "overload-pole"],
  "contact-no": ["ais:contact-no", "power-contact", "power-contact"],
  "contact-nc": ["ais:contact-nc", "power-contact", "power-contact"],
  "switch-no": ["ais:switch-no", "power-contact", "power-contact"],
  "switch-nc": ["ais:switch-nc", "power-contact", "power-contact"],
  "pushbutton-no": ["ais:pushbutton-no", "power-contact", "power-contact"],
  "pushbutton-nc": ["ais:pushbutton-nc", "power-contact", "power-contact"],
} as const;
const advice =
  "Check the profile and authored function shape against the symbol catalog; a profile change does not change connectivity.";

function refusal(
  profile: string,
  state: string,
  mark: string,
  kind = "contact",
) {
  return `Unsupported symbol profile: device "DUT", type "local:dut", profile "${profile}" has no power rule for function "function" (${kind}/2; terminals DUT.A, DUT.B). Unsupported power protection identity: normal_state=${kind === "contact" ? JSON.stringify(state) : "not applicable"}, circuitSymbols=${JSON.stringify(mark)}. No rooted power primitive for this authored mark. Use a circuit view to retain the authored identity. ${advice}`;
}

for (const profile of ["thermite:fuse", "thermite:breaker"])
  for (const state of ["open", "closed"] as const)
    for (const mark of marks)
      it.each(["left-to-right", "top-to-bottom"] as const)(
        `${profile}/${state}/${mark ?? "unmarked"} preserves power and circuit identity in %s`,
        async (flow) => {
          const f = await contractProject(profile, `contact-${state}`, "power");
          try {
            const type = f.ir.deviceTypes.find((t) => t.id === "local:dut")!;
            if (mark) type.circuitSymbols = { function: mark };
            const fn = f.ir.functions.find(
              (v) => v.id.functionKey === "function",
            )!;
            const before = JSON.stringify(f.ir);
            const powerIdentity = mark
              ? powerIdentities[mark as keyof typeof powerIdentities]
              : profile === "thermite:fuse" && state === "closed"
                ? powerIdentities.fuse
                : powerIdentities[
                    state === "open" ? "contact-no" : "contact-nc"
                  ];
            const expected = powerIdentity?.[0];
            const rules = projectDeviceTypeSymbolMappings(f.ir)
              .find((m) => m.typeId === type.id)!
              .functions.filter((r) => r.families.includes("power"));
            expect(rules).toEqual(
              powerIdentity
                ? [
                    {
                      functionKey: "function",
                      families: ["power"],
                      symbolId: powerIdentity[0],
                      bindings: [
                        { portId: "in", terminalKey: "A" },
                        { portId: "out", terminalKey: "B" },
                      ],
                      classification: powerIdentity[1],
                      traversalRole: powerIdentity[2],
                    },
                  ]
                : [],
            );
            const wrongState =
              (mark?.endsWith("-no") && state !== "open") ||
              (mark?.endsWith("-nc") && state !== "closed");
            const r = await renderSchematic(f.ir, {
              ...(f.request as object),
              flow,
            });
            if (!expected) {
              expect(r).toMatchObject({
                ok: false,
                error: {
                  code: "R002",
                  reason: "unsupported-symbol-profile",
                  message: refusal(profile, state, mark!),
                },
              });
            } else if (wrongState) {
              expect(r).toMatchObject({ ok: false, error: { code: "R003" } });
            } else {
              expect(r.ok, JSON.stringify(r)).toBe(true);
              if (!r.ok) throw Error(r.error.message);
              expect(r.value.svg).toContain(`data-symbol-id="${expected}"`);
              expect(r.value.summary.conductiveElementIds).toEqual(
                f.ir.wires
                  .map((w) => ({ kind: "wire", uid: w.uid }))
                  .sort((a, b) => a.uid.localeCompare(b.uid)),
              );
              const caption = printableCaption({
                kind: "function",
                fn,
                type,
                mark: expected,
              });
              expect(caption).toBe(
                ["ais:fuse", "ais:breaker-pole", "ais:overload-pole"].includes(
                  expected,
                )
                  ? ""
                  : state === "open"
                    ? "NO"
                    : "NC",
              );
            }
            if (wrongState) {
              expect(() => circuitMark(type, fn)).toThrow(
                "incompatible with its declared function",
              );
            } else {
              const markExpected =
                mark ??
                (profile === "thermite:fuse" && state === "closed"
                  ? "fuse"
                  : state === "open"
                    ? "contact-no"
                    : "contact-nc");
              expect(circuitMark(type, fn)).toBe(markExpected);
              const drawing = await prepareCircuitView(
                f.ir,
                identityCircuit(f.ir, flow),
              );
              const doc = parseHTML(
                `<svg>${drawing.groups[0]!.content}</svg>`,
              ).document;
              expect(
                [...doc.querySelectorAll("[data-circuit-mark]")].map((m) =>
                  m.getAttribute("data-circuit-mark"),
                ),
              ).toEqual([markExpected]);
              expect(drawing.groups[0]!.coverage.functionIds).toEqual([
                JSON.stringify([fn.id.deviceUid, fn.id.functionKey]),
              ]);
            }
            expect(JSON.stringify(f.ir)).toBe(before);
          } finally {
            await f.dispose();
          }
        },
      );

for (const mark of [
  undefined,
  "fuse",
  "interface",
  "thermocouple",
  "level-sensor",
  "conductivity-probe",
] as const)
  it.each(["left-to-right", "top-to-bottom"] as const)(
    `fuse other/2 ${mark ?? "unmarked"} never loses its power identity in %s`,
    async (flow) => {
      const f = await contractProject("thermite:fuse", "other", "power");
      try {
        const type = f.ir.deviceTypes.find((t) => t.id === "local:dut")!;
        if (mark) type.circuitSymbols = { function: mark };
        expect(
          projectDeviceTypeSymbolMappings(f.ir)
            .find((m) => m.typeId === type.id)!
            .functions.filter((r) => r.families.includes("power")),
        ).toEqual(
          !mark || mark === "fuse"
            ? [
                {
                  functionKey: "function",
                  families: ["power"],
                  symbolId: "ais:fuse",
                  bindings: [
                    { portId: "in", terminalKey: "A" },
                    { portId: "out", terminalKey: "B" },
                  ],
                  classification: "protection",
                  traversalRole: "breaker-pole",
                },
              ]
            : [],
        );
        const r = await renderSchematic(f.ir, {
          ...(f.request as object),
          flow,
        });
        if (!mark || mark === "fuse") {
          expect(r.ok, JSON.stringify(r)).toBe(true);
          if (r.ok) expect(r.value.svg).toContain('data-symbol-id="ais:fuse"');
        } else
          expect(r).toMatchObject({
            ok: false,
            error: {
              code: "R002",
              message: refusal("thermite:fuse", "", mark, "other"),
            },
          });
        const drawing = await prepareCircuitView(
          f.ir,
          identityCircuit(f.ir, flow),
        );
        expect(drawing.groups[0]!.content).toContain(
          `data-circuit-mark="${mark ?? "fuse"}"`,
        );
      } finally {
        await f.dispose();
      }
    },
  );

it.each(["left-to-right", "top-to-bottom"] as const)(
  "renders a source-backed monitor with exact physical nets, clones and both inventories in %s",
  async (flow) => {
    const f = await identityProject(
      "thermite:fuse",
      "contact-open",
      "power",
      (t) => {
        t.circuitSymbols = { function: "contact-no" };
      },
    );
    try {
      await compareProject(f.root);
      const before = JSON.stringify(f.ir);
      const r = await renderSchematic(f.ir, { ...(f.request as object), flow });
      expect(r.ok, JSON.stringify(r)).toBe(true);
      if (!r.ok) throw Error(r.error.message);
      const dut = f.ir.devices.find((d) => d.designation === "DUT")!;
      const nets = ["A", "B"].map(
        (key) =>
          f.ir.nets.find((n) =>
            n.terminalIds.some(
              (t) => t.deviceUid === dut.uid && t.terminalKey === key,
            ),
          )!.id,
      );
      expect(new Set(nets).size).toBe(2);
      const circuit = await prepareCircuitView(
        f.ir,
        identityCircuit(f.ir, flow, true),
      );
      expect(circuit.groups[0]!.coverage.conductorIds).toHaveLength(
        f.ir.wires.length,
      );
      const clone = structuredClone(f.ir),
        type = clone.deviceTypes.find((t) => t.id === dut.typeId)!;
      type.id = "local:renamed";
      type.terminals.reverse();
      type.functions.reverse();
      clone.devices.find((d) => d.uid === dut.uid)!.typeId = type.id;
      clone.devices.find((d) => d.uid === dut.uid)!.designation = "Z91";
      clone.indexes.instanceRefsByTypeId.find(
        (i) => i.key === dut.typeId,
      )!.key = type.id;
      clone.indexes.objectRefByDesignation.find((i) => i.key === "DUT")!.key =
        "Z91";
      const rendered = await renderSchematic(clone, {
        ...(f.request as object),
        flow,
      });
      expect(rendered.ok, JSON.stringify(rendered)).toBe(true);
      if (rendered.ok) {
        expect(rendered.value.svg).toContain('data-symbol-id="ais:contact-no"');
        expect(rendered.value.summary.netIds).toEqual(r.value.summary.netIds);
      }
      expect(JSON.stringify(f.ir)).toBe(before);
    } finally {
      await f.dispose();
    }
  },
);
