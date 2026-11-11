import type { IrFunction, TerminalId } from "@thermite/compiler";

type Conductor = { ends: readonly TerminalId[] };
const key = (t: TerminalId) => JSON.stringify([t.deviceUid, t.terminalKey]);

/** A shared common need not repeat every channel when each channel also has
 * its own selected conductor. Keep equally specific appearances and all gangs;
 * this chooses drawing ownership only, never conduction through a function.
 * The per-conductor scan is quadratic in selected conductors; circuit requests
 * bound each group to 120 conductors and 80 functions. */
export function circuitConductorFunctions(
  functions: IrFunction[],
  conductors: readonly Conductor[],
  conductor: Conductor,
): IrFunction[] {
  const membership = new Map<string, number>();
  for (const fn of functions)
    for (const terminal of fn.terminals) {
      const id = key(terminal);
      membership.set(id, (membership.get(id) ?? 0) + 1);
    }
  const score = (fn: IrFunction, c: Conductor) =>
    Math.min(
      Infinity,
      ...fn.terminals
        .filter((t) => c.ends.some((e) => key(e) === key(t)))
        .map((t) => membership.get(key(t)) ?? Infinity),
    );
  return functions.filter((fn) => {
    const own = score(fn, conductor);
    return (
      Number.isFinite(own) &&
      own <= Math.min(...conductors.map((c) => score(fn, c)))
    );
  });
}
