// Packet metadata and resolver model. Presentation structure belongs to schema.
import type { LegacySchematicPacketRequest } from "../../packet/types.js";
import type { Slot } from "#title-schema/model";
export {
  slots,
  bindings,
  type Slot,
  type Binding,
  type Field,
  type Grid,
  type Presentation,
} from "#title-schema/model";
export type { TitleDiagnostic, Result } from "#title-schema/diagnostics";
export interface RevisionRow {
  readonly version: string;
  readonly comment?: string;
  readonly date?: string;
  readonly drawnBy?: string;
}
export interface TitleRecord {
  readonly values?: Readonly<Record<string, string | null>>;
  readonly sheetTitle?: string | null;
  readonly revision?: string | null;
  readonly revisionRows?: readonly RevisionRow[];
}
export interface TitleData {
  readonly defaults?: TitleRecord & { readonly drawingBase?: string | null };
  readonly byView?: readonly (TitleRecord & { readonly viewIndex: number })[];
  readonly bySheet?: readonly (TitleRecord & { readonly sheetKey: string })[];
}
export interface PacketRequest extends Omit<
  LegacySchematicPacketRequest,
  "format"
> {
  readonly format: "schematic-packet-request/0.2";
  readonly titleData?: TitleData;
}
/** These identities come from native producers, never from titles/page numbers. */
export type SheetIdentity =
  | { readonly kind: "view"; readonly viewKey: string }
  | { readonly kind: "document"; readonly documentId: string }
  | { readonly kind: "companion"; readonly documentId: string }
  | { readonly kind: "index" }
  | { readonly kind: "references" };
export interface FinalSheet {
  readonly identity: SheetIdentity;
  readonly partIndex: number;
  readonly partTotal: number;
  /** One-based authored view; absent on independent index/reference documents. */
  readonly viewIndex?: number;
  /** Native companion ownership, never inferred from titles or packet order.
   * A singleton inherits byView metadata; multiple owners use defaults only. */
  readonly ownerViewIndexes?: readonly number[];
  readonly title: string;
}
export type Source =
  | "presentation"
  | "request-defaults"
  | "request-view"
  | "request-sheet"
  | "project"
  | "title"
  | "page";
export interface Fact<T> {
  readonly value: T | null;
  readonly known: boolean;
  readonly source: Source | null;
  readonly pointer: string | null;
  readonly inputs?: readonly Fact<string>[];
}
export interface ResolvedField {
  readonly key: string;
  readonly slot: Slot;
  readonly label: string;
  readonly fact: Fact<string>;
  /** Unknown revision displays UNSPECIFIED, while its fact remains unknown. */
  readonly text: string;
}
export interface ResolvedTitle {
  readonly sheetKey: string;
  readonly fields: readonly ResolvedField[];
  readonly revisionRows: Fact<readonly RevisionRow[]>;
  readonly history: readonly Readonly<
    Record<keyof Required<RevisionRow>, Fact<string>>
  >[];
}

export interface TitleSource {
  readonly file: string;
  readonly nodes: import("@thermite/schema").JsonPointerNodeMap;
}
export interface TitleSources {
  readonly packet?: TitleSource;
  readonly presentation?: TitleSource;
}
