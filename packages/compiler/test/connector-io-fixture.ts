import type { Device, DeviceType, Relation } from "@thermite/schema";
import { connectorFixture } from "./connector-fixture.js";

/** Original synthetic socket coverage, unrelated to any installed machine. */
export function connectorIoFixture(
  change?: (types: DeviceType[], objects: (Device | Relation)[]) => void,
) {
  return connectorFixture((types, objects) => {
    const rack = objects.find((o) => o.designation === "R1") as Device;
    types[0]!.terminals = {};
    types[0]!.functions = {};
    rack.connectorIo = {
      addressSpace: "PLC1",
      ports: {
        X1: {
          direction: "input",
          address: "%IW64",
          signal: "Pressure",
          usage: "in-use",
        },
        X3: { usage: "spare" },
        X4: { direction: "bidirectional", signal: "Position assembly" },
      },
    };
    rack.connectionReview = {
      connectorPorts: {
        X3: { status: "intentionally-unused", reason: "Reserved socket." },
      },
    };
    types.push({
      kind: "device_type",
      id: "connector-fixture:cpu",
      description: "Synthetic CPU input",
      terminals: { I0: {} },
      functions: {
        di1: { kind: "channel", direction: "input", terminals: ["I0"] },
      },
    });
    objects.push({
      uid: "42000000-0000-4000-8000-000000000021",
      kind: "device",
      designation: "PLC1",
      type: "connector-fixture:cpu",
      io: {
        addressSpace: "PLC1",
        channels: { di1: { address: "%I0.0", signal: "Start" } },
      },
    });
    change?.(types, objects);
  });
}
