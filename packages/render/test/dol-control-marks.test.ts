import { expect, it } from "vitest";
import { renderSchematic } from "../src/renderer.js";
import { circuitMark } from "../src/symbols/circuit.js";
import { projectDeviceTypeSymbolMappings } from "../src/symbols/mappings.js";
import { contractProject } from "./rooted-profile-contracts.js";

// Independent acceptance table, including every contact mark supported by circuit
// views. Only the listed marks may bind in rooted control; power preserves identity.
const contactMarks = [
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
const profiles = ["thermite:fuse", "thermite:breaker"] as const;
for (const profile of profiles)
  for (const state of ["open", "closed"] as const)
    for (const mark of contactMarks)
      it.each(["left-to-right", "top-to-bottom"] as const)(
        `${profile}/${state}/${mark ?? "unmarked"} respects authored control identity in %s`,
        async (flow) => {
          const fixture = await contractProject(
            profile,
            `contact-${state}`,
            "control",
          );
          try {
            const { ir } = fixture;
            const type = ir.deviceTypes.find((t) => t.id === "local:dut")!;
            if (mark) type.circuitSymbols = { function: mark };
            const expected =
              profile === "thermite:fuse"
                ? mark === "fuse" || (!mark && state === "closed")
                  ? "ais:fuse"
                  : undefined
                : !mark
                  ? `ais:contact-${state === "open" ? "no" : "nc"}`
                  : mark === "breaker"
                    ? "ais:breaker-pole"
                    : mark === "contact-no" || mark === "contact-nc"
                      ? `ais:${mark}`
                      : undefined;
            const mapping = projectDeviceTypeSymbolMappings(ir).find(
              (m) => m.typeId === type.id,
            )!;
            const control = mapping.functions.filter((f) =>
              f.families.includes("control"),
            );
            expect(control.map((f) => f.symbolId)).toEqual(
              expected ? [expected] : [],
            );
            const powerIdentity = mark
              ? powerIdentities[mark as keyof typeof powerIdentities]
              : profile === "thermite:fuse" && state === "closed"
                ? powerIdentities.fuse
                : powerIdentities[
                    state === "open" ? "contact-no" : "contact-nc"
                  ];
            expect(
              mapping.functions.filter((f) => f.families.includes("power")),
            ).toEqual(
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
            const result = await renderSchematic(ir, {
              ...(fixture.request as object),
              flow,
            });
            const incompatibleState =
              (mark?.endsWith("-no") && state !== "open") ||
              (mark?.endsWith("-nc") && state !== "closed");
            if (expected && !incompatibleState) {
              expect(result.ok, JSON.stringify(result)).toBe(true);
              if (!result.ok) throw Error(result.error.message);
              expect(result.value.svg).toContain(
                `data-symbol-id="${expected}"`,
              );
            } else if (expected) {
              // Keep the existing state/mark validation for allowed breaker marks.
              expect(result).toMatchObject({
                ok: false,
                error: { code: "R003" },
              });
            } else {
              expect(result).toMatchObject({
                ok: false,
                error: {
                  code: "R002",
                  reason: "unsupported-symbol-profile",
                  unsupported: {
                    designation: "DUT",
                    typeId: type.id,
                    profile,
                    family: "control",
                    functionKey: "function",
                  },
                  details: {
                    stoppedAt: [
                      {
                        designation: "DUT",
                        terminalKey: "B",
                        functionKeys: ["function"],
                      },
                    ],
                  },
                },
              });
              if (result.ok) throw Error("Unsupported control mark rendered");
              expect(result.error.message).toContain(
                'function "function" (contact/2; terminals DUT.A, DUT.B)',
              );
              expect(result.error.message).toContain(
                `normal_state=${JSON.stringify(state)}`,
              );
              expect(result.error.message).toContain(
                `circuitSymbols=${mark ? JSON.stringify(mark) : "unmarked"}`,
              );
              expect(result.error.message).toContain("Use a circuit view");
            }
            // In particular the monitor's circuit view keeps its contact-no mark.
            if (mark) {
              const fn = ir.functions.find(
                (f) => f.id.functionKey === "function",
              )!;
              if (incompatibleState)
                expect(() => circuitMark(type, fn)).toThrow(
                  "incompatible with its declared function",
                );
              else expect(circuitMark(type, fn)).toBe(mark);
            }
          } finally {
            await fixture.dispose();
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
    `fuse other/2 with ${mark ?? "no mark"} preserves identity in %s`,
    async (flow) => {
      const fixture = await contractProject(
        "thermite:fuse",
        "other",
        "control",
      );
      try {
        const type = fixture.ir.deviceTypes.find((t) => t.id === "local:dut")!;
        if (mark) type.circuitSymbols = { function: mark };
        expect(
          projectDeviceTypeSymbolMappings(fixture.ir)
            .find((m) => m.typeId === type.id)!
            .functions.filter((f) => f.families.includes("power")),
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
        const result = await renderSchematic(fixture.ir, {
          ...(fixture.request as object),
          flow,
        });
        expect(result.ok, JSON.stringify(result)).toBe(
          !mark || mark === "fuse",
        );
        if (result.ok)
          expect(result.value.svg).toContain('data-symbol-id="ais:fuse"');
        else
          expect(result).toMatchObject({
            error: { code: "R002", reason: "unsupported-symbol-profile" },
          });
      } finally {
        await fixture.dispose();
      }
    },
  );
