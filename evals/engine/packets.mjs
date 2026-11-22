export const inventoryPacket = {
  format: "schematic-packet-request/0.1",
  views: [{ format: "documentation-view-request/0.1", kind: "wires" }],
};
export const conveyorPacket = {
  format: "schematic-packet-request/0.1",
  layout: "compact",
  index: true,
  views: [
    ["M1", "power"],
    ["M2", "power"],
    ["K1", "control"],
    ["K2", "control"],
  ].map(([value, family]) => ({
    format: "schematic-view-request/0.1",
    root: { by: "designation", value },
    family,
    flow: "left-to-right",
  })),
};
