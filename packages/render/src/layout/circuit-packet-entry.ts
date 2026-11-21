import { withRenderCache } from "../packet/render-cache.js";
import { renderSchematicPacket as renderOriginalPacket } from "../sheets.js";
import { withFontMetricCache } from "../symbols/font-metric-cache.js";
import { selectCircuitPacket } from "./circuit-packet-selection.js";

/** Keep final printable comparison outside NAV's packet implementation. */
export function renderSchematicPacket(
  ...args: Parameters<typeof renderOriginalPacket>
) {
  return withRenderCache(() =>
    withFontMetricCache(() =>
      selectCircuitPacket(args[1], () => renderOriginalPacket(...args)),
    ),
  );
}
