import type { ElectricalIr, TerminalId } from "@thermite/compiler";

export type LoopPolarityKind = "transmitter" | "input";
const pairs: Readonly<
  Record<LoopPolarityKind, readonly (readonly [string, string])[]>
> = {
  transmitter: [["loop_positive", "loop_negative"]],
  input: [
    ["analog_input_positive", "analog_input_negative"],
    ["analog_input_0_positive", "analog_input_0_negative"],
    ["analog_input_1_positive", "analog_input_1_negative"],
  ],
};

export const terminalKey = (t: TerminalId) =>
  JSON.stringify([t.deviceUid, t.terminalKey]);

/** Exact authored pairs only. Function order and terminal names supply no polarity. */
export function readLoopPolarity(
  ir: Readonly<ElectricalIr>,
  terminals: readonly TerminalId[],
  kind: LoopPolarityKind,
) {
  if (terminals.length !== 2) return undefined;
  for (const [positiveRole, negativeRole] of pairs[kind]) {
    const positive = terminals.find(
      (t) => terminalRole(ir, t) === positiveRole,
    );
    const negative = terminals.find(
      (t) => terminalRole(ir, t) === negativeRole,
    );
    if (positive && negative) return { positive, negative };
  }
  return undefined;
}

export function terminalRole(ir: Readonly<ElectricalIr>, id: TerminalId) {
  return ir.terminals.find((t) => terminalKey(t.id) === terminalKey(id))?.role;
}

/** Plain diagnostic text; the drawing boundary escapes any authored XML text. */
export function polarityTerminal(ir: Readonly<ElectricalIr>, id: TerminalId) {
  const device = ir.devices.find((d) => d.uid === id.deviceUid);
  return `${device?.designation ?? id.deviceUid}.${id.terminalKey} (${terminalRole(ir, id) ?? "<unspecified>"})`;
}

/** Shared refusal vocabulary for series loops and future direct-loop checks. */
export function assertLoopPolarityEntry(
  ir: Readonly<ElectricalIr>,
  departure: TerminalId,
  arrival: TerminalId,
  polarity: ReturnType<typeof readLoopPolarity>,
  prefix: string,
) {
  if (polarity && terminalKey(arrival) !== terminalKey(polarity.positive))
    throw new Error(
      `${prefix}: ${polarityTerminal(ir, departure)} reaches ${polarityTerminal(ir, arrival)}; correct the wiring or the authored roles.`,
    );
}
