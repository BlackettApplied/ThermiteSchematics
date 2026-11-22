import type { RenderedPacket, RenderedSheet } from "../src/packet/types.js";
import { escapeXmlAttribute } from "../src/svg/escape.js";

export function yieldSheet(
  number: number,
  view: string,
  owner?: string,
): RenderedSheet {
  const terminal = escapeXmlAttribute(
    JSON.stringify({ deviceUid: `device-${owner}`, terminalKey: "1" }),
  );
  const conductors = escapeXmlAttribute(
    JSON.stringify([{ kind: "wire", uid: `wire-${owner}` }]),
  );
  return {
    number,
    view: {
      format: "documentation-view/0.1",
      kind: "circuit",
      title: "Identical printed title",
    },
    references: [],
    continuations: [],
    svg: `<svg><g data-navigation-view="${view}">${owner ? `<circle data-device-uid="device-${owner}" data-terminal-key="1" cx="10" cy="15"/><g data-off-view-terminal-id="${terminal}" data-off-view-conductors="${conductors}"><rect class="off-view-card" x="20" y="10" width="20" height="10" stroke-width=".75"/></g>` : ""}</g></svg>`,
  };
}

const counts = { total: 0, represented: 0, outsideAuditedViews: 0 };
export function yieldPacket(sheets: RenderedSheet[]): RenderedPacket {
  return {
    format: "schematic-packet/0.1",
    page: {
      size: "a3",
      orientation: "landscape",
      widthMm: 420,
      heightMm: 297,
      marginMm: 10,
    },
    sheets,
    html: "",
    coverage: {
      format: "schematic-coverage/0.1",
      scope: "circuit-and-wiring",
      counts: { conductors: counts, functions: counts },
      conductors: [],
      functions: [],
      unauditedSheets: [],
      limitations: [],
      topology: {
        format: "schematic-topology-coverage/0.1",
        scope: "connector-assemblies-and-communications",
        counts: {
          assemblies: counts,
          communicationLinks: counts,
          connectorPorts: counts,
          communicationPorts: counts,
          devices: counts,
        },
        assemblies: [],
        communicationLinks: [],
        connectorPorts: [],
        communicationPorts: [],
        devices: [],
        unauditedSheets: [],
        limitations: [],
      },
    },
  };
}
