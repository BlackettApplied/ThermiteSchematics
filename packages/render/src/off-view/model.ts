import type { ConductiveElementId, TerminalId } from "@thermite/compiler";
import type { LayoutPoint, RenderTextSource } from "../types.js";

/** An authored endpoint record, never an electrical edge or coverage appearance. */
export interface OffViewConnection {
  readonly elementId: ConductiveElementId;
  readonly designation: string;
  readonly terminal: TerminalId;
  readonly other: TerminalId | null;
  readonly destination: string;
  readonly textSources: readonly RenderTextSource[];
}

export interface OffViewCard {
  readonly terminal: TerminalId;
  readonly terminalName: string;
  readonly connections: readonly OffViewConnection[];
  readonly lines: readonly {
    readonly text: string;
    readonly bold: boolean;
    readonly baseline: number;
    readonly offsetX: number;
  }[];
  readonly placementCount?: number;
  readonly placementRank?: number;
  /** Fixed owner-local position, reserved before ELK. */
  readonly position: LayoutPoint;
}
