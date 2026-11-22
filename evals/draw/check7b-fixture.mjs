import { elementFixture } from "./check5-navigation-fixture.mjs";
import { viewBindings } from "./tranche4-views.mjs";
export function rootedFixture() {
  const x = elementFixture(),
    { ir, packet, request, geometries } = x;
  ir.devices.push({ uid: "M", designation: "M1", typeId: "load" });
  ir.deviceTypes.push({ id: "load", terminals: [] });
  const terminal = (deviceUid, terminalKey) => ({ deviceUid, terminalKey });
  ir.functions.push(
    {
      id: { deviceUid: "M", functionKey: "load" },
      kind: "load",
      terminals: ["U", "V", "W"].map((k) => terminal("M", k)),
    },
    {
      id: { deviceUid: "S", functionKey: "supply" },
      kind: "source",
      terminals: ["L1", "L2", "L3"].map((k) => terminal("S", k)),
    },
  );
  ir.devices.push({ uid: "S", designation: "SUPPLY", typeId: "source" });
  ir.deviceTypes.push({ id: "source", terminals: [] });
  for (const [i, key] of ["U", "V", "W"].entries()) {
    const fn = ir.functions.find((f) => f.id.functionKey === `pole${i + 1}`);
    for (const [j, ends] of [
      [terminal("M", key), fn.terminals[1]],
      [fn.terminals[0], terminal("S", `L${i + 1}`)],
    ].entries())
      ir.wires.push({
        uid: `W${i}-${j}`,
        designation: `W${i}-${j}`,
        endpoints: ends.map((terminal) => ({ terminal })),
      });
  }
  request.views[0] = {
    format: "schematic-view-request/0.1",
    family: "power",
    root: { by: "uid", value: "M" },
  };
  packet.sheets[0].view = {
    family: "power",
    root: { deviceUid: "M", designation: "M1" },
  };
  const bindings = viewBindings(request, ir);
  geometries.forEach((g, i) => {
    g.navigationViews = [bindings[i]];
    [...g.shapes, ...g.terminals].forEach((s) => {
      s.navigationView = bindings[i];
    });
  });
  return x;
}
export function eraseProtection(x) {
  x.geometries[0].shapes = [];
  x.geometries[0].terminals = [];
  x.geometries.forEach((g) => {
    g.texts = g.texts.filter((t) => !t.element.startsWith("nav-"));
  });
}
