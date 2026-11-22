import type { ElkExtendedEdge } from "elkjs/lib/elk-api.js";
import { required } from "../presentation/util.js";
import { escapeXmlAttribute as attr } from "../svg/escape.js";

/** Drawing-local ownership, independent of electrical endpoint ordering. */
export function routePortAttributes(edge: ElkExtendedEdge): string {
  return `data-layout-source-port="${attr(required(edge.sources[0], "Missing route source port"))}" data-layout-target-port="${attr(required(edge.targets[0], "Missing route target port"))}"`;
}

export function terminalPortAttribute(id: string): string {
  return `data-layout-port="${attr(id)}"`;
}
