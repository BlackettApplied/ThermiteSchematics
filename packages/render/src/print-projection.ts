import { formatTerminalSet } from "@thermite/query";
import type { IrFunction, IrDeviceType } from "@thermite/compiler";

import { circuitMark } from "./symbols/circuit.js";
import { symbolProfile } from "./symbols/profiles.js";
import { printedProtectionRole } from "./symbols/printable-policy.js";

function protectionRole(fn: IrFunction, type: IrDeviceType | undefined) {
  if (!type || fn.terminals.length !== 2) return;
  const profile = symbolProfile(type);
  const explicit = type.circuitSymbols?.[fn.id.functionKey];
  if (
    fn.kind !== "contact" &&
    (fn.kind !== "other" ||
      (profile !== "thermite:fuse" && explicit !== "fuse"))
  )
    return;
  if (
    !["thermite:breaker", "thermite:overload", "thermite:fuse"].includes(
      profile ?? "",
    ) &&
    !["breaker", "overload", "fuse"].includes(explicit ?? "")
  )
    return;
  return printedProtectionRole(`circuit:${circuitMark(type, fn)}`);
}

/** Internal presentation only. Lookup keys, IR and CSV identities are unchanged. */
export function printedFunction(fn: IrFunction, type?: IrDeviceType): string {
  const role = protectionRole(fn, type);
  const noun =
    role ??
    (fn.kind === "contact"
      ? `${fn.normal_state === "open" ? "NO" : "NC"} contact`
      : fn.kind === "channel"
        ? `${fn.direction === "input" ? "Input" : "Output"} channel`
        : fn.kind.charAt(0).toUpperCase() + fn.kind.slice(1));
  const terminals = fn.terminals.map((t) => t.terminalKey);
  return [noun, formatTerminalSet(terminals)].filter(Boolean).join(" ");
}
