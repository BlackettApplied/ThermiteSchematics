import type { AxisSearchCap } from "./safe-cuts.js";

/** Existing packet limit; naming it does not extend legend pagination. */
export const LEGEND_PACKET_SHEET_LIMIT = 100;
export type LegendSearchCap = AxisSearchCap | "sheet-limit";
