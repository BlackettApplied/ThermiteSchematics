import { expect, it } from "vitest";
import type { TerminalId } from "@thermite/compiler";
import { circuitJunctionIdentity } from "../src/circuit/junction-identity.js";
import type { PhysicalConductor } from "../src/circuit/types.js";

const end = (terminalKey: string): TerminalId => ({
  deviceUid: "synthetic-device",
  terminalKey,
});
const wire = (id: string, a: string, b: string): PhysicalConductor => ({
  id,
  name: id,
  label: id,
  ends: [end(a), end(b)],
  netId: "same-net",
  detail: "",
  jumper: false,
});
const segments = [
  { index: 0, a: { x: -5, y: 0 }, b: { x: 5, y: 0 } },
  { index: 1, a: { x: 0, y: 0 }, b: { x: 0, y: 5 } },
];
const state = (cs: PhysicalConductor[]) => ({
  cs,
  segments,
  key: (t: TerminalId) => JSON.stringify([t.deviceUid, t.terminalKey]),
  on: () => true,
});

it("binds the unique common native terminal, never a same-net neighbour", () => {
  expect(
    circuitJunctionIdentity(
      { x: 0, y: 0 },
      state([wire("A", "left", "T"), wire("B", "T", "bottom")]),
    ),
  ).toEqual(end("T"));
  expect(
    circuitJunctionIdentity(
      { x: 0, y: 0 },
      state([wire("A", "left", "T"), wire("B", "foreign", "bottom")]),
    ),
  ).toBeUndefined();
});

it("does not invent an owner for duplicate common ends or a missing route owner", () => {
  expect(
    circuitJunctionIdentity(
      { x: 0, y: 0 },
      state([wire("A", "left", "T"), wire("B", "left", "T")]),
    ),
  ).toBeUndefined();
  expect(
    circuitJunctionIdentity({ x: 0, y: 0 }, state([wire("A", "left", "T")])),
  ).toBeUndefined();
});
