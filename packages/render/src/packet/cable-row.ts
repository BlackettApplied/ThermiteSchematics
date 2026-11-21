import { text } from "./svg.js";
import {
  CABLE_USAGE_EM,
  CABLE_USAGE_PITCH,
  type cableUsagePlan,
} from "./cable-usage.js";
import {
  CABLE_ROW_PITCH,
  CABLE_ENDPOINT_BASELINE,
  CABLE_OPEN_END_CAPTION_LIFT,
  CABLE_CORE_BASELINE,
  CABLE_USAGE_BASELINE,
} from "./cable-row-metrics.js";

type CableRowLabels = {
  a: readonly string[];
  z: readonly string[];
  centerRows: readonly string[];
  usage: ReturnType<typeof cableUsagePlan>;
};

export function cableRowLabels(
  { a, z, centerRows, usage }: CableRowLabels,
  position: { left: number; right: number; y: number; midY: number },
  endpoints: readonly unknown[],
): string[] {
  const { left, right, y, midY } = position;
  const result: string[] = [];
  a.forEach((row, index) =>
    result.push(
      text(
        left,
        y +
          index * CABLE_ROW_PITCH +
          CABLE_ENDPOINT_BASELINE -
          (endpoints[0] === null ? CABLE_OPEN_END_CAPTION_LIFT : 0),
        row,
        2.7,
        "start",
        400,
        true,
      ),
    ),
  );
  z.forEach((row, index) =>
    result.push(
      text(
        right,
        y +
          index * CABLE_ROW_PITCH +
          CABLE_ENDPOINT_BASELINE -
          (endpoints[1] === null ? CABLE_OPEN_END_CAPTION_LIFT : 0),
        row,
        2.7,
        "end",
        400,
        true,
      ),
    ),
  );
  centerRows.forEach((row, index) =>
    result.push(
      text(
        (left + right) / 2,
        y + index * CABLE_ROW_PITCH + CABLE_CORE_BASELINE,
        row,
        2.6,
        "middle",
        400,
        true,
      ),
    ),
  );
  usage.rows.forEach((row, index) =>
    result.push(
      text(
        (left + right) / 2,
        midY + CABLE_USAGE_BASELINE + index * CABLE_USAGE_PITCH,
        row,
        CABLE_USAGE_EM,
        "middle",
        400,
        true,
      ),
    ),
  );
  return result;
}
