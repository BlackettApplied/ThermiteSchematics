import type { ConductiveElementId, TerminalId } from "@thermite/compiler";
import type { Rect } from "../device-legend/geometry.js";

/** Source identities, never a report title or a machine-only coverage claim. */
export type DocumentFact =
  | {
      kind: "conductor-incidence";
      element: ConductiveElementId;
      end: number;
      terminal: TerminalId;
    }
  | { kind: "terminal-inventory"; terminal: TerminalId }
  | { kind: "connector-port-status"; deviceUid: string; portKey: string }
  | { kind: "port-link-status"; deviceUid: string; portKey: string }
  | { kind: "assembly-pin-map"; relationUid: string }
  | { kind: "core-inventory"; cableUid: string; conductorId: string };
export type DocumentNeed = DocumentFact["kind"];
export type SemanticColumn =
  "identity" | "endpoints" | "status" | "connections" | "protocol" | "pin-map";
export interface DocumentNeedSeed {
  viewKey?: string;
  noteId: string;
  need: DocumentNeed;
  requiredFacts: readonly DocumentFact[];
  requiredColumns: readonly SemanticColumn[];
  subject: string;
  count?: number;
}
export interface DocumentDependency extends DocumentNeedSeed {
  id: string;
  owner: { viewKey: string; noteId: string; sheet: number };
  snapshotDigest: string;
  presentationDigest: string;
  revision: string;
  resolution: readonly DocumentResolution[];
  caption?: {
    text: string;
    primitiveId: string;
    rectMm: Rect;
    form?: "identities" | "compact";
    groups?: readonly DocumentCaptionGroup[];
    locality?: {
      deviceUid: string;
      terminalKey?: string;
      anchorMm: { x: number; y: number };
      ownerLocation: { sheet: number; zone: string };
      mode: "local" | "self-located";
      distanceMm: number;
      leader?: {
        from: { x: number; y: number };
        to: { x: number; y: number };
        rect: Rect;
      };
    };
  };
}
export interface DocumentCaptionGroup {
  documentId: string;
  rows: string[];
  sheet: number;
  zone: string;
  owner: { kind: "device" | "cable"; uid: string };
  count: number;
  unit: string;
  factKeys: string[];
}
export interface DocumentResolution {
  documentId: string;
  rows: readonly string[];
}
export interface IssuedDocumentRow {
  id: string;
  nativeKey: string;
  displayName: string;
  facts: readonly DocumentFact[];
  columns: readonly SemanticColumn[];
  primitiveId: string;
  sheet: number;
  zone: string;
  rectMm: Rect;
  anchorMm: { x: number; y: number };
  anchorRule: "row-region-center/1";
}
export interface IssuedDocument {
  id: string;
  kind: string;
  label: string;
  snapshotDigest: string;
  presentationDigest: string;
  revision: string;
  authoredOrder?: number;
  autoOrigin?: GeneratedDocumentOrigin;
  rows: readonly IssuedDocumentRow[];
}
export interface DocumentIdentity {
  id: string;
  snapshotDigest: string;
  presentationDigest: string;
  revision: string;
}
export interface DocumentRowDraft {
  nativeKey: string;
  displayName: string;
  facts: readonly DocumentFact[];
  columns: readonly SemanticColumn[];
  cells: readonly string[];
  printedCells: readonly (readonly string[])[];
  primitiveId: string;
  rectMm: Rect;
}
export interface DocumentHeaderDraft {
  labelText: string;
  cells: readonly string[];
  printedCells: readonly (readonly string[])[];
  primitiveId: string;
  rectMm: Rect;
}

export interface AssemblyInlineAttempt {
  sheet: number;
  widthMm: number;
  neededHeightMm?: number;
  availableMm: Rect;
  reason: "vacancy" | "measurement";
  message: string;
}
export interface AssemblyOverflowEvidence {
  profile: "assembly-inline/1";
  rowKeys: readonly string[];
  sourceSheets: readonly number[];
  attempts: readonly AssemblyInlineAttempt[];
}
export interface GeneratedDocumentOrigin {
  dependencyIds: readonly string[];
  overflow?: AssemblyOverflowEvidence;
}
