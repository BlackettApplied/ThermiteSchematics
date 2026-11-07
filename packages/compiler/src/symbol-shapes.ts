import type {
  SymbolFunctionShape,
  ValidatedDeviceType,
} from "@thermite/schema";

import type { IrDeviceType, IrDeviceTypeFunction } from "./expansion.js";

type ShapeType =
  Pick<ValidatedDeviceType, "terminals"> | Pick<IrDeviceType, "terminals">;
type ShapeFunction =
  | ValidatedDeviceType["functions"][string]
  | (Pick<IrDeviceTypeFunction, "kind" | "terminalKeys"> & {
      readonly normal_state?: "open" | "closed";
    });

/** Match source or IR facts in the function's authored terminal order, never the
 * type's terminal display order. Shared by validation and render conformance.
 */
export function symbolFunctionMatchesShape(
  type: ShapeType,
  fn: ShapeFunction,
  shape: SymbolFunctionShape,
): boolean {
  const keys = "terminalKeys" in fn ? fn.terminalKeys : fn.terminals;
  const terminalAt = (index: number) => {
    const key = keys[index];
    if (key === undefined) return undefined;
    return Array.isArray(type.terminals)
      ? type.terminals.find((t) => t.key === key)
      : type.terminals[key];
  };
  return (
    fn.kind === shape.kind &&
    keys.length >= shape.minTerminals &&
    keys.length <= shape.maxTerminals &&
    (shape.normalState === undefined ||
      ("normal_state" in fn && fn.normal_state === shape.normalState)) &&
    (shape.firstTerminalVoltageType === undefined ||
      terminalAt(0)?.rating?.voltage_type === shape.firstTerminalVoltageType) &&
    (shape.terminalRoles === undefined ||
      shape.terminalRoles.every((role, i) => terminalAt(i)?.role === role))
  );
}

/** Compact shape description suitable for diagnostics and future symbol guides. */
export function formatSymbolFunctionShape(shape: SymbolFunctionShape): string {
  const count =
    shape.minTerminals === shape.maxTerminals
      ? String(shape.minTerminals)
      : `${shape.minTerminals}-${shape.maxTerminals}`;
  const constraints: string[] = [];
  if (shape.normalState) constraints.push(`${shape.normalState} normal state`);
  if (shape.firstTerminalVoltageType)
    constraints.push(`${shape.firstTerminalVoltageType} first terminal`);
  if (shape.terminalRoles) constraints.push(shape.terminalRoles.join(", "));
  const suffix = constraints.length ? ` (${constraints.join("; ")})` : "";
  return `${shape.kind}/${count}${suffix}`;
}
