import type { Device, Relation } from "@thermite/schema";
import { connectorFixture } from "../../compiler/test/connector-fixture.js";

/** Original synthetic mixed topology; no installed-machine or manufacturer facts. */
export function topologyFixture() {
  return connectorFixture((types, objects) => {
    const ethernet = { medium: "ethernet" as const, connector: "RJ45" };
    const bus = { medium: "nrg-bus" as const, connector: "Synthetic bus" };
    types[0]!.ports = { ETH1: ethernet, ETH2: ethernet, BUS: bus };
    types[1]!.ports = {
      ETH1: ethernet,
      ETH2: ethernet,
      ETH3: ethernet,
      BUS: bus,
    };
    objects.push({
      uid: "42000000-0000-4000-8000-000000000022",
      kind: "device",
      designation: "N3",
      type: types[1]!.id,
    } as Device);
    for (const [i, designation, from, fromPort, to, toPort, medium] of [
      [31, "NET1", "R1", "ETH1", "S1", "ETH1", "ethernet"],
      [32, "NET2", "S1", "ETH2", "S2", "ETH1", "ethernet"],
      [33, "BUS1", "R1", "BUS", "S1", "BUS", "nrg-bus"],
    ] as const)
      objects.push({
        uid: `42000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        kind: "relation",
        designation,
        relation: "associated_with",
        from: { device: from },
        to: { device: to },
        connection: {
          fromPort,
          toPort,
          medium,
          protocol: medium === "ethernet" ? "Ethernet" : "NRG",
          status: "planned",
        },
      } as Relation);
  });
}
