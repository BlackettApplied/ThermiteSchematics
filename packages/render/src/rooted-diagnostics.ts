import type { ElectricalIr, TerminalId } from "@thermite/compiler";
import type { DeviceTypeSymbolMapping } from "./symbols/mappings.js";
import type { RenderFailure, NormalizedSchematicView } from "./types.js";
import {
  hasFunctionBinding,
  preflightRootedProfiles,
  unsupportedProfileError,
} from "./preflight.js";
import { renderErrorContext } from "./render-error-context.js";
function unsupportedStops(
  ir: Readonly<ElectricalIr>,
  mappings: readonly DeviceTypeSymbolMapping[],
  family: "power" | "control",
  stops: readonly TerminalId[],
): boolean {
  return (
    stops.length > 0 &&
    stops.every((t) => {
      const stoppedDevice = ir.devices.find((d) => d.uid === t.deviceUid);
      if (!stoppedDevice) throw Error("Missing stopped device");
      const mapping = mappings.find((m) => m.typeId === stoppedDevice.typeId);
      const functions = ir.functions.filter(
        (f) =>
          f.id.deviceUid === t.deviceUid &&
          f.kind !== "mechanism" &&
          f.terminals.some((p) => p.terminalKey === t.terminalKey),
      );
      return (
        functions.length > 0 &&
        functions.every((f) => !hasFunctionBinding(mapping, f, family))
      );
    })
  );
}
/** Preserve existing rooted diagnostics; pair failures already name their endpoints. */
export function diagnoseRooted(
  ir: Readonly<ElectricalIr>,
  view: NormalizedSchematicView,
  mappings: readonly DeviceTypeSymbolMapping[],
  error: RenderFailure,
): RenderFailure {
  if (
    error.code === "R002" &&
    error.details?.reason === "transformer-source-pair"
  )
    return error;
  if (error.code !== "R002" && error.code !== "R003")
    return renderErrorContext(ir, error);
  const unrepresented =
    error.code === "R003" && error.details?.reason === "unrepresented-terminal";
  const profile = preflightRootedProfiles(ir, view, mappings);
  if (!profile) return renderErrorContext(ir, error);
  // An unselected terminal is not evidence that its device's profile is bad.
  // Keep independent limitations elsewhere on the path as secondary context.
  if (unrepresented && error.deviceUid === profile.deviceUid)
    return renderErrorContext(ir, error);
  const device = ir.devices.find((d) => d.uid === profile.deviceUid);
  if (!device) throw Error("Missing profile device");
  const f = ir.functions.find(
    (f) =>
      f.id.deviceUid === device.uid && f.id.functionKey === profile.functionKey,
  );
  const contextual = renderErrorContext(ir, error, false);
  const stops = (error.details?.terminalIds ??
    []) as readonly import("@thermite/compiler").TerminalId[];
  const allStopsUnsupported = unsupportedStops(
    ir,
    mappings,
    profile.family,
    stops,
  );
  // Trace leaves describe physical dead ends, not proof that a profile blocked
  // the signal. Preserve the connectivity refusal and report the candidate only.
  const traceConnectivity =
    error.code === "R002" && "intent" in error && error.intent === "trace";
  const directBinding =
    error.code === "R003" &&
    stops.length === 0 &&
    error.deviceUid === device.uid;
  if (
    !unrepresented &&
    !traceConnectivity &&
    (allStopsUnsupported || directBinding)
  )
    return unsupportedProfileError(ir, contextual, device, f, profile.family);
  const unsupported = profile.unsupported;
  if (!unsupported) throw Error("Missing unsupported profile context");
  return {
    ...contextual,
    message:
      error.code === "R002" || unrepresented
        ? `${contextual.message} Additional profile limitation: device ${JSON.stringify(unsupported.designation)} ${unsupported.profile === "<missing>" ? "has no rendering profile for this view." : `uses profile ${JSON.stringify(unsupported.profile)}, which is unsupported for this view.`}`
        : contextual.message,
    unsupported: unsupported,
    details: { ...contextual.details, profileNote: profile.message },
  };
}
