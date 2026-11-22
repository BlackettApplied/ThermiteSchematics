import type { ElectricalIr, IrDeviceTypeFunction } from "@thermite/compiler";
import type { SelectedSubgraph } from "../types.js";
import type {
  BoundaryTerminalRule,
  DeviceTypeSymbolMapping,
} from "./mappings.js";

/** Only transformer windings offer both ends to either control arm. */
export function sourceBoundaryRules(
  fn: IrDeviceTypeFunction,
  role: (key: string) => string | undefined,
  winding: boolean,
): BoundaryTerminalRule[] {
  return fn.terminalKeys.flatMap((terminalKey, index) =>
    (winding
      ? (["control-source", "control-return"] as const)
      : ([index === 0 ? "control-source" : "control-return"] as const)
    ).map((boundaryKind) => ({
      functionKey: fn.key,
      terminalKey,
      families: ["control"],
      boundaryKind,
      requiredRole: role(terminalKey) ?? "",
    })),
  );
}

/** A per-view drawing convention, detached from type mappings and electrical IR. */
export function orientSourceWindingMappings(
  ir: Readonly<ElectricalIr>,
  selected: SelectedSubgraph,
  mappings: readonly DeviceTypeSymbolMapping[],
): readonly DeviceTypeSymbolMapping[] {
  if (selected.view.family !== "control") return mappings;
  const input = selected.paths.find((p) => p.lane === "input")?.start;
  const ret = selected.paths.find((p) => p.lane === "return")?.start;
  if (
    !input?.boundary ||
    !ret?.boundary ||
    input.terminal.deviceUid !== ret.terminal.deviceUid
  )
    return mappings;
  const device = ir.devices.find((d) => d.uid === input.terminal.deviceUid);
  const functionKey = selected.functionIds.find(
    (id) =>
      id.deviceUid === device?.uid &&
      ir.functions.some(
        (fn) =>
          fn.kind === "source" &&
          fn.id.deviceUid === id.deviceUid &&
          fn.id.functionKey === id.functionKey &&
          [input, ret].every((endpoint) =>
            fn.terminals.some(
              (t) =>
                t.deviceUid === endpoint.terminal.deviceUid &&
                t.terminalKey === endpoint.terminal.terminalKey,
            ),
          ),
      ),
  )?.functionKey;
  return mappings.map((mapping) =>
    mapping.typeId !== device?.typeId
      ? mapping
      : {
          ...mapping,
          functions: mapping.functions.map((rule) =>
            rule.symbolId !== "ais:source-winding" ||
            rule.functionKey !== functionKey
              ? rule
              : {
                  ...rule,
                  bindings: [
                    { portId: "feed", terminalKey: input.terminal.terminalKey },
                    { portId: "return", terminalKey: ret.terminal.terminalKey },
                  ],
                },
          ),
        },
  );
}
