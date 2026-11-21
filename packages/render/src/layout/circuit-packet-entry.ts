import { withRenderCache } from "../packet/render-cache.js";
import {
  renderSchematicPacket as renderOriginalPacket,
  renderSchematicSheets as renderOriginalSheets,
} from "../sheets.js";
import { withFontMetricCache } from "../symbols/font-metric-cache.js";
import { selectCircuitPacket } from "./circuit-packet-selection.js";
import { selectControlPrint } from "../packet/rooted-control-print.js";

/** Keep final printable comparison outside NAV's packet implementation. */
export function renderSchematicPacket(
  ...args: Parameters<typeof renderOriginalPacket>
) {
  return withRenderCache(() =>
    withFontMetricCache(() =>
      selectControlPrint(() =>
        selectCircuitPacket(args[1], () => renderOriginalPacket(...args)),
      ),
    ),
  );
}

export function renderSchematicSheets(
  ...args: Parameters<typeof renderOriginalSheets>
) {
  return withRenderCache(() =>
    withFontMetricCache(() =>
      selectControlPrint(() => renderOriginalSheets(...args)),
    ),
  );
}
