import { hasFunctionBinding, unsupportedProfileError } from "./preflight.js";
import { projectDeviceTypeSymbolMappings } from "./symbols/mappings.js";
import type { ElectricalIr, TerminalId } from "@thermite/compiler";
import type { RenderError } from "./errors.js";
import type { RenderFailure } from "./types.js";

export class CircuitRenderError extends Error {
  constructor(readonly error: RenderError) {
    super(error.message);
  }
}

/** Human-readable companions to stable source identities; never replace IDs. */
export function renderErrorContext<E extends RenderFailure>(
  ir: Readonly<ElectricalIr>,
  error: E,
  classifyProfile = true,
): E {
  if (error.code !== "R002" && error.code !== "R003") return error;
  const e = error as Extract<RenderError, { code: "R002" | "R003" }>;
  const deviceUid = "deviceUid" in e ? e.deviceUid : undefined;
  const device = ir.devices.find((d) => d.uid === deviceUid);
  if (
    classifyProfile &&
    e.code === "R003" &&
    !e.reason &&
    device &&
    e.details?.reason !== "unrepresented-terminal"
  ) {
    const mapping = projectDeviceTypeSymbolMappings(ir).find(
      (m) => m.typeId === device.typeId,
    );
    const unsupported = ir.functions.find(
      (f) =>
        f.id.deviceUid === device.uid &&
        (e.functionKey === undefined || e.functionKey === f.id.functionKey) &&
        !hasFunctionBinding(mapping, f, e.family),
    );
    if (unsupported)
      return unsupportedProfileError(
        ir,
        error as E & RenderError,
        device,
        unsupported,
        e.family,
      );
  }
  const terminalIds = (e.details?.terminalIds ?? []) as TerminalId[];
  const terminalDetails = (ids: readonly TerminalId[]) =>
    ids.map((t) => ({
      ...t,
      designation:
        ir.devices.find((d) => d.uid === t.deviceUid)?.designation ??
        t.deviceUid,
    }));
  const functions = ir.functions.filter((f) => {
    if (f.id.deviceUid !== deviceUid) return false;
    if ("functionKey" in e && e.functionKey)
      return f.id.functionKey === e.functionKey;
    if (e.code !== "R002") return true;
    if ("intent" in e && e.intent === "loads") return f.kind === "source";
    if ("intent" in e && e.intent === "trace")
      return f.kind === "contact" || f.kind === "load" || f.kind === "channel";
    return e.family === "power" ? f.kind === "load" : f.kind === "coil";
  });
  const stops = terminalDetails(terminalIds).map((t) => ({
    ...t,
    functionKeys: ir.functions
      .filter((f) =>
        f.terminals.some(
          (p) => p.deviceUid === t.deviceUid && p.terminalKey === t.terminalKey,
        ),
      )
      .map((f) => f.id.functionKey),
  }));
  let message = e.message;
  const unrepresented = e.details?.reason === "unrepresented-terminal";
  if (
    !unrepresented &&
    device &&
    !message.includes(`device ${JSON.stringify(device.designation)}`)
  ) {
    message += ` Device ${JSON.stringify(device.designation)}${functions.length ? `, function${functions.length === 1 ? "" : "s"} ${functions.map((f) => JSON.stringify(f.id.functionKey)).join(", ")}` : ""}.`;
  }
  const target =
    "targetDeviceUid" in e
      ? ir.devices.find((d) => d.uid === e.targetDeviceUid)
      : undefined;
  if (target && !unrepresented)
    message += ` Target device ${JSON.stringify(target.designation)}.`;
  if (stops.length && !unrepresented)
    message += ` Path stopped at ${stops.map((t) => `${t.designation}.${t.terminalKey}${t.functionKeys.length ? ` (function ${t.functionKeys.join(", ")})` : ""}`).join(", ")}.`;
  return {
    ...error,
    message,
    details: {
      ...e.details,
      ...(device
        ? { designation: device.designation, typeId: device.typeId }
        : {}),
      ...(functions.length
        ? {
            functions: functions.map((f) => ({
              functionKey: f.id.functionKey,
              terminals: terminalDetails(f.terminals),
            })),
          }
        : {}),
      ...(stops.length ? { stoppedAt: stops } : {}),
      ...(target
        ? { target: { deviceUid: target.uid, designation: target.designation } }
        : {}),
    },
  };
}
