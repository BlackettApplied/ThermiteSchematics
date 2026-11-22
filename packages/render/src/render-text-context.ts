import type { ElectricalIr, TerminalId } from "@thermite/compiler";
import type {
  InvalidRenderTextError,
  InvalidTitleTextError,
  InvalidViewRequestError,
} from "./errors.js";
import {
  decodeSvgSemanticId,
  preflightTitleRenderText,
  type SvgSemanticIdPrefix,
} from "./svg/escape.js";
import type { NormalizedSchematicView, RenderTextSource } from "./types.js";

export function preflightNamedTitle(
  view: Readonly<NormalizedSchematicView>,
  sources: readonly RenderTextSource[],
) {
  const result = preflightTitleRenderText(view, sources);
  if (result.ok || result.error.ownerKind !== "view") return result;
  return {
    ok: false as const,
    error: {
      ...result.error,
      details: {
        ...result.error.details,
        designation: diagnosticText(view.root.designation),
        ...(view.format === "schematic-view/0.2" && view.intent === "trace"
          ? { targetDesignation: diagnosticText(view.target.designation) }
          : {}),
      },
    },
  };
}

export function renderInputErrorContext(
  ir: Readonly<ElectricalIr>,
  error:
    InvalidRenderTextError | InvalidTitleTextError | InvalidViewRequestError,
) {
  if (error.code === "R005" && error.ownerKind === "title-field") return error;
  if (error.code === "R005") return renderTextErrorContext(ir, error);
  const selector = error.requestedRoot;
  const device = ir.devices.find(
    (d) =>
      d.uid === error.deviceUid ||
      (selector?.kind === "selector" &&
        (selector.by === "uid" ? d.uid : d.designation) === selector.value),
  );
  return device && !error.details?.designation
    ? {
        ...error,
        details: { ...error.details, designation: device.designation },
      }
    : error;
}

const LOCATABLE_TEXT_OWNERS = new Set([
  "device",
  "terminal",
  "function",
  "aggregate",
  "wire",
  "jumper",
  "cable",
  "cable-conductor",
  "potential",
  "boundary",
]);

/** Resolve the existing text owner, retaining its stable ID and original error. */
export function renderTextErrorContext(
  ir: Readonly<ElectricalIr>,
  error: InvalidRenderTextError,
): InvalidRenderTextError {
  const kind = error.ownerKind;
  if (!LOCATABLE_TEXT_OWNERS.has(kind)) return error;
  let parts: readonly string[];
  try {
    parts = decodeSvgSemanticId(kind as SvgSemanticIdPrefix, error.ownerId);
  } catch {
    // Cable schedule text uses the original cable UID directly.
    parts = [error.ownerId];
  }
  const [uid, key] = parts;
  const potential =
    kind === "potential" ? ir.potentials.find((p) => p.uid === uid) : undefined;
  const device = ir.devices.find(
    (d) => d.uid === (potential?.terminal.deviceUid ?? uid),
  );
  const conductor =
    kind === "wire"
      ? ir.wires.find((w) => w.uid === uid)
      : kind === "jumper"
        ? ir.jumpers.find((j) => j.uid === uid)
        : undefined;
  const cable = ir.cables.find((c) => c.uid === uid);
  const designation =
    device?.designation ?? conductor?.designation ?? cable?.designation;
  if (!designation) return error;
  const endpoints: readonly TerminalId[] =
    conductor?.endpoints.map((e) => e.terminal) ??
    (kind === "cable-conductor"
      ? ir.cableConductors
          .find((c) => c.cableUid === uid && c.id.conductorId === key)
          ?.endpoints.map((e) => e.terminal)
      : undefined) ??
    [];
  return {
    ...error,
    details: {
      ...error.details,
      designation: diagnosticText(designation),
      ...(kind === "terminal" || kind === "boundary"
        ? { terminalKey: diagnosticText(key) }
        : {}),
      ...(potential
        ? {
            potentialName: diagnosticText(potential.name),
            terminalKey: diagnosticText(potential.terminal.terminalKey),
          }
        : {}),
      ...(kind === "function" ? { functionKey: diagnosticText(key) } : {}),
      ...(kind === "aggregate" ? { aggregateKey: diagnosticText(key) } : {}),
      ...(kind === "cable-conductor"
        ? { conductorId: diagnosticText(key) }
        : {}),
      ...(endpoints.length
        ? {
            terminals: namedTextTerminals(ir, endpoints),
          }
        : {}),
    },
  };
}

/** Keep rejected XML characters visible without copying them into diagnostics. */
function namedTextTerminals(
  ir: Readonly<ElectricalIr>,
  endpoints: readonly TerminalId[],
) {
  return endpoints.map((t) => {
    const endpoint = ir.devices.find((d) => d.uid === t.deviceUid);
    return {
      ...t,
      terminalKey: diagnosticText(t.terminalKey),
      ...(endpoint
        ? { designation: diagnosticText(endpoint.designation) }
        : {}),
    };
  });
}

function diagnosticText(value: string | undefined): string | undefined {
  return value?.replace(
    /[\u0000-\u001f\u0085\u2028\u2029\ud800-\udfff\ufffe\uffff]/gu,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}
