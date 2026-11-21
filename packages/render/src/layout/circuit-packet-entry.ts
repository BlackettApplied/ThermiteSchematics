import { types } from "node:util";
import { withRenderCache } from "../packet/render-cache.js";
import {
  renderSchematicPacket as renderOriginalPacket,
  renderSchematicSheets as renderOriginalSheets,
} from "../sheets.js";
import { withFontMetricCache } from "../symbols/font-metric-cache.js";
import { selectCircuitPacket } from "./circuit-packet-selection.js";
import { selectControlPrint } from "../packet/rooted-control-print.js";
import type { SchematicPacketRequest } from "../packet/types.js";

function singleAuthoredView(request: SchematicPacketRequest) {
  if (types.isProxy(request)) return false;
  const views: unknown = Object.getOwnPropertyDescriptor(
    request,
    "views",
  )?.value;
  if (types.isProxy(views) || !Array.isArray(views) || views.length !== 1)
    return false;
  const view = Object.getOwnPropertyDescriptor(views, "0");
  return !!view && "value" in view && !types.isProxy(view.value);
}

/** Keep final printable comparison outside NAV's packet implementation. */
export function renderSchematicPacket(
  ...args: Parameters<typeof renderOriginalPacket>
) {
  return withRenderCache(() =>
    withFontMetricCache(() =>
      selectControlPrint(
        () => selectCircuitPacket(args[1], () => renderOriginalPacket(...args)),
        () => singleAuthoredView(args[1]),
      ),
    ),
  );
}

export function renderSchematicSheets(
  ...args: Parameters<typeof renderOriginalSheets>
) {
  return selectControlPrint(
    () => renderOriginalSheets(...args),
    () => !types.isProxy(args[1]),
  );
}
