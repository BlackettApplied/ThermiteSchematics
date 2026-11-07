export const rooted = (value, family) => ({
  format: "schematic-view-request/0.1",
  root: { by: "designation", value },
  family,
  flow: "left-to-right",
});
export const report = (kind) => ({
  format: "documentation-view-request/0.1",
  kind,
});
export const packet = (views) => ({
  format: "schematic-packet-request/0.1",
  layout: "compact",
  page: { size: "tabloid", orientation: "landscape" },
  views,
});
export const starter = packet([
  {
    format: "schematic-view-request/0.2",
    root: { by: "designation", value: "PS1" },
    intent: { kind: "loads" },
    flow: "left-to-right",
  },
]);
export const conveyor = {
  ...packet([
    rooted("M1", "power"),
    rooted("M2", "power"),
    rooted("K1", "control"),
    rooted("K2", "control"),
    report("wires"),
    report("terminals"),
  ]),
  index: true,
};
export const wide = packet([report("wires")]);
export const signal = packet([
  {
    format: "signal-loop-view-request/0.1",
    from: { device: "PT1", function: "signal" },
    to: { device: "AI1", function: "ch0" },
    cableAssemblies: [
      {
        cable: "CB1",
        connector: "M12",
        description: "4-pole A-coded molded cordset (proposed)",
      },
    ],
    enclosures: [
      {
        label: "Main electrical cabinet",
        devices: ["XP1", "XT1", "AI1"],
        wallDevice: "XP1",
      },
    ],
  },
]);
export const sweepPower = packet([
  rooted("M1", "power"),
  rooted("K1", "control"),
]);
