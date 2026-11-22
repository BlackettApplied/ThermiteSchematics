import type { ConductiveElementId } from "@thermite/compiler";
import type { PresentationEdge } from "../types.js";

export interface ContinuationIdentity {
  conductor: string;
  designation?: string;
  provenance: ConductiveElementId;
  descriptor?: string;
}

/** Printed wire numbers are authored data, never inferred net/display detail. */
export function continuationIdentity(
  edge: Pick<PresentationEdge, "conductor" | "elementIds" | "label">,
): ContinuationIdentity | undefined {
  const identity = authoredIdentity(edge);
  return identity && !identityProblem(edge, identity) ? identity : undefined;
}

function authoredIdentity(
  edge: Pick<PresentationEdge, "conductor" | "elementIds" | "label">,
): ContinuationIdentity | undefined {
  const c = edge.conductor;
  const source = edge.elementIds?.[0];
  if (!c || !source || edge.elementIds.length !== 1) return undefined;
  if (c.kind === "wire" && source.kind === "wire" && source.uid === c.uid) {
    const authored = edge.label?.textSources?.find(
      (s) => s.field === "wire.properties.label",
    );
    const conductor = authored ? authored.value : c.designation;
    return { conductor, designation: c.designation, provenance: { ...source } };
  }
  if (c.kind === "jumper" && source.kind === "jumper" && source.uid === c.uid) {
    const authored = edge.label?.textSources?.find(
      (s) => s.field === "jumper.designation",
    );
    return authored
      ? {
          conductor: authored.value,
          designation: authored.value,
          provenance: { ...source },
        }
      : {
          conductor: "JUMPER",
          provenance: { ...source },
        };
  }
  if (
    c.kind === "cable-conductor" &&
    source.kind === "cable_conductor" &&
    source.cableUid === c.cableUid &&
    source.conductorId === c.conductorId
  ) {
    const conductor = `${c.cableDesignation}.${c.conductorId}`;
    return { conductor, designation: conductor, provenance: { ...source } };
  }
  return undefined;
}

function identityProblem(
  edge: Pick<PresentationEdge, "conductor">,
  identity: ContinuationIdentity,
) {
  const c = edge.conductor;
  const values =
    c?.kind === "cable-conductor"
      ? [c.cableDesignation, c.conductorId]
      : [identity.conductor];
  for (const value of values) {
    if (typeof value !== "string" || !value.trim())
      return "the printed identity is missing or whitespace-only";
    const separator = /[\r\n\t\u0085\u2028\u2029]/u.exec(value)?.[0];
    if (separator)
      return `the printed identity contains a line break or separator (U+${separator.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")})`;
  }
}

/** Explain an identity only when a caller needs to reference it across a cut. */
export function continuationIdentityConstraint(
  edge: Pick<PresentationEdge, "id" | "conductor" | "elementIds" | "label">,
) {
  const identity = authoredIdentity(edge);
  const problem = identity
    ? identityProblem(edge, identity)
    : "a unique authored conductor identity and matching provenance are missing";
  if (!problem) return;
  const c = edge.conductor;
  const name =
    c?.kind === "cable-conductor"
      ? `${c.cableDesignation}.${c.conductorId} (cable ${c.cableUid})`
      : c
        ? `${c.designation ?? c.uid} (UID ${c.uid})`
        : edge.id;
  return `Conductor ${JSON.stringify(name)} cannot print a continuation identity: ${problem}. Provide a usable authored printed identity without line breaks or separators.`;
}
