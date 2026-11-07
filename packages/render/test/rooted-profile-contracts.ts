import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compileProject,
  lockProject,
  type ElectricalIr,
} from "@thermite/compiler";
import type {
  SymbolFunctionShape,
  ValidatedDeviceType,
} from "@thermite/schema";
import type { BoundaryKind, TraversalRole } from "../src/symbols/mappings.js";

export type RootedFamily = "power" | "control" | "loads";
interface Contract {
  readonly mode: string;
  readonly shape: SymbolFunctionShape;
  readonly symbol: string;
  readonly role: TraversalRole;
  readonly boundary: readonly BoundaryKind[];
  readonly series: boolean;
}
const shape = (
  kind: SymbolFunctionShape["kind"],
  n: number,
  roles?: string[],
  dc = false,
): SymbolFunctionShape => ({
  kind,
  minTerminals: n,
  maxTerminals: n,
  ...(roles ? { terminalRoles: roles } : {}),
  ...(dc ? { firstTerminalVoltageType: "DC" as const } : {}),
});
const c = (
  mode: string,
  shape: SymbolFunctionShape,
  symbol: string,
  role: TraversalRole,
  boundary: readonly BoundaryKind[] = [],
  series = false,
): Contract => ({ mode, shape, symbol, role, boundary, series });
const bus = c("terminal", shape("bus", 1), "ais:terminal", "terminal-display");
const earth = c(
  "earth",
  shape("bus", 1, ["protective_earth"]),
  "ais:terminal",
  "terminal-display",
);
const dcLoad = c(
  "dc-load",
  shape("load", 2, undefined, true),
  "ais:dc-load",
  "load-boundary",
);
const dcSource = c(
  "dc-source",
  shape("source", 2, ["dc_positive_output", "dc_return_output"]),
  "ais:power-source-dc",
  "source-boundary",
  ["control-source", "control-return"],
);
const coil = c("coil", shape("coil", 2), "ais:coil", "coil-root");
const contact = c(
  "contact-open",
  shape("contact", 2),
  "ais:contact-no",
  "control-contact",
  [],
  true,
);
const aux = c(
  "aux-open",
  shape("contact", 2, ["aux", "aux"]),
  "ais:contact-no",
  "control-contact",
  [],
  true,
);
const sensorSupply = c(
  "sensor-supply",
  shape("load", 2),
  "ais:switch-sensor-pnp",
  "non-traversable",
);
const sensorOutput = c(
  "sensor-output",
  shape("channel", 1),
  "ais:switch-sensor-pnp",
  "non-traversable",
);
const ioInput = c(
  "channel-input",
  shape("channel", 1),
  "ais:plc-di",
  "channel-boundary",
);
const ioOutput = c(
  "channel-output",
  shape("channel", 1),
  "ais:plc-do",
  "channel-boundary",
);

/** Independent, hand-authored renderer contracts. Never derive this table from
 * SYMBOL_PROFILES or projectDeviceTypeSymbolMappings: it is their oracle.
 * [] boundary means no source boundary; endpoint/terminal/aggregate roles are
 * deliberately not series traversal. Complete views exercise those roles.
 */
export const ROOTED_CONTRACTS: Readonly<
  Record<string, Readonly<Record<RootedFamily, readonly Contract[]>>>
> = {
  "thermite:contactor": {
    power: [
      c(
        "power-open",
        shape("contact", 2, ["power_input", "power_output"]),
        "ais:contact-no",
        "power-contact",
        [],
        true,
      ),
    ],
    control: [coil, aux],
    loads: [],
  },
  "thermite:relay": {
    power: [],
    control: [coil, contact, dcLoad],
    loads: [dcLoad],
  },
  "thermite:breaker": {
    power: [
      c(
        "contact-closed",
        shape("contact", 2),
        "ais:contact-nc",
        "power-contact",
        [],
        true,
      ),
    ],
    control: [],
    loads: [],
  },
  "thermite:overload": {
    power: [
      c(
        "power-closed",
        shape("contact", 2, ["power_input", "power_output"]),
        "ais:overload-pole",
        "overload-pole",
        [],
        true,
      ),
    ],
    control: [
      c(
        "aux-closed",
        shape("contact", 2, ["aux", "aux"]),
        "ais:overload-contact-nc",
        "protection-contact",
        [],
        true,
      ),
    ],
    loads: [],
  },
  "thermite:fuse": {
    power: [
      c(
        "contact-closed",
        shape("contact", 2),
        "ais:fuse",
        "breaker-pole",
        [],
        true,
      ),
      c("other", shape("other", 2), "ais:fuse", "breaker-pole", [], true),
    ],
    control: [],
    loads: [],
  },
  "thermite:motor-3ph": {
    power: [
      c("motor3", shape("load", 3), "ais:motor-3ph", "load-boundary"),
      earth,
    ],
    control: [],
    loads: [],
  },
  "thermite:motor": {
    power: [c("motor2", shape("load", 2), "ais:motor", "load-boundary")],
    control: [],
    loads: [],
  },
  "thermite:power-source": {
    power: [
      c(
        "source3",
        shape("source", 3, [
          "phase_1_source",
          "phase_2_source",
          "phase_3_source",
        ]),
        "ais:power-source-3ph",
        "source-boundary",
        [
          "power-source",
          "power-source",
          "power-source",
          "protective-earth-source",
        ],
      ),
      earth,
    ],
    control: [dcSource],
    loads: [dcSource],
  },
  "thermite:dc-supply": {
    power: [
      c(
        "ac",
        shape("load", 2, ["ac_line_input", "ac_input_return"]),
        "ais:ac-load",
        "load-boundary",
      ),
      bus,
    ],
    control: [dcSource, bus, dcLoad],
    loads: [dcSource, bus, dcLoad],
  },
  "thermite:io-module": {
    power: [bus],
    control: [ioOutput, ioInput, bus, dcLoad, dcSource],
    loads: [dcLoad, bus, dcSource],
  },
  "thermite:terminal-strip": {
    power: [bus],
    control: [bus, dcLoad, dcSource],
    loads: [bus, dcLoad, dcSource],
  },
  "thermite:lamp": {
    power: [],
    control: [c("load", shape("load", 2), "ais:lamp", "load-boundary")],
    loads: [c("load", shape("load", 2), "ais:lamp", "load-boundary")],
  },
  "thermite:switch": {
    power: [],
    control: [
      c(
        "contact-open",
        shape("contact", 2),
        "ais:switch-no",
        "permissive-contact",
        [],
        true,
      ),
    ],
    loads: [],
  },
  "thermite:pushbutton": {
    power: [],
    control: [
      c(
        "contact-open",
        shape("contact", 2),
        "ais:pushbutton-no",
        "command-contact",
        [],
        true,
      ),
    ],
    loads: [],
  },
  "thermite:disconnector": {
    power: [
      c(
        "power-open",
        {
          ...shape("contact", 2, ["power_input", "power_output"]),
          normalState: "open",
        },
        "ais:disconnector",
        "power-contact",
        [],
        true,
      ),
    ],
    control: [
      c(
        "contact-open",
        { ...shape("contact", 2), normalState: "open" },
        "ais:disconnector",
        "permissive-contact",
        [],
        true,
      ),
    ],
    loads: [],
  },
  "thermite:estop": {
    power: [],
    control: [
      c(
        "contact-open",
        shape("contact", 2),
        "ais:estop-no",
        "command-contact",
        [],
        true,
      ),
    ],
    loads: [],
  },
  "thermite:selector": {
    power: [],
    control: [
      c(
        "contact-open",
        shape("contact", 2),
        "ais:selector-no",
        "permissive-contact",
        [],
        true,
      ),
    ],
    loads: [],
  },
  "thermite:sensor-3wire": {
    power: [],
    control: [sensorSupply, sensorOutput],
    loads: [sensorSupply, sensorOutput],
  },
};

/** Each contract has a declared function named f. Aggregate fixtures include
 * their explicitly authored companion functions and distinct physical points. */
export function contractType(
  profile: string,
  mode: string,
): ValidatedDeviceType {
  const terminals: ValidatedDeviceType["terminals"] = {};
  const fn = (kind: string, keys: string[], extra: object = {}) => ({
    kind,
    terminals: keys,
    ...extra,
  });
  let functions: Record<string, unknown> = {};
  const add = (keys: string[], roles?: string[]) =>
    keys.forEach(
      (key, i) => (terminals[key] = roles ? { role: roles[i]! } : {}),
    );
  if (mode === "terminal" || mode === "earth") {
    add(["T"], mode === "earth" ? ["protective_earth"] : undefined);
    functions = { f: fn("bus", ["T"]) };
  } else if (mode === "source3" || mode === "motor3") {
    const source = mode === "source3",
      keys = source ? ["L1", "L2", "L3"] : ["U", "V", "W"];
    add(
      keys,
      source
        ? ["phase_1_source", "phase_2_source", "phase_3_source"]
        : undefined,
    );
    add(["PE"], ["protective_earth"]);
    functions = {
      f: fn(source ? "source" : "load", keys),
      earth: fn("bus", ["PE"]),
    };
  } else if (mode.startsWith("sensor-")) {
    add(["P", "N", "Q"], ["supply_positive", "supply_return", "signal_output"]);
    functions =
      mode === "sensor-supply"
        ? {
            f: fn("load", ["P", "N"]),
            out: fn("channel", ["Q"], { direction: "output" }),
          }
        : {
            supply: fn("load", ["P", "N"]),
            f: fn("channel", ["Q"], { direction: "output" }),
          };
  } else if (mode.startsWith("channel-")) {
    add(["Q"]);
    functions = {
      f: fn("channel", ["Q"], {
        direction: mode === "channel-input" ? "input" : "output",
      }),
    };
  } else if (["dc-load", "dc-source", "load", "motor2", "ac"].includes(mode)) {
    add(
      ["P", "N"],
      mode === "dc-source"
        ? ["dc_positive_output", "dc_return_output"]
        : mode === "ac"
          ? ["ac_line_input", "ac_input_return"]
          : undefined,
    );
    if (mode === "dc-load") terminals.P = { rating: { voltage_type: "DC" } };
    functions = { f: fn(mode === "dc-source" ? "source" : "load", ["P", "N"]) };
  } else {
    add(
      ["A", "B"],
      mode.startsWith("power-")
        ? ["power_input", "power_output"]
        : mode.startsWith("aux-")
          ? ["aux", "aux"]
          : undefined,
    );
    functions = {
      f: fn(
        mode === "coil" ? "coil" : mode === "other" ? "other" : "contact",
        ["A", "B"],
        mode === "coil" || mode === "other"
          ? {}
          : { normal_state: mode.endsWith("closed") ? "closed" : "open" },
      ),
    };
  }
  return {
    kind: "device_type",
    id: "local:dut",
    symbol: profile,
    terminals,
    functions: Object.fromEntries(
      Object.entries(functions).map(([key, f]) => [
        key === "f" ? "function" : key,
        f,
      ]),
    ),
    internal_relations: [],
  } as ValidatedDeviceType;
}

export async function contractProject(
  profile: string,
  mode: string,
  family: RootedFamily,
): Promise<{
  ir: ElectricalIr;
  request: unknown;
  dispose: () => Promise<void>;
}> {
  const root = await mkdtemp(join(tmpdir(), "thermite-rooted-contract-"));
  await mkdir(join(root, "local"));
  const type = contractType(profile, mode);
  await writeFile(
    join(root, "system.json"),
    JSON.stringify({
      format: "electrical-system/0.1",
      project: { name: "Rooted profile contract" },
      sources: ["source.json"],
      libraries: [
        { name: "core", version: "0.1.0" },
        { name: "local", version: "0.1.0", path: "local" },
      ],
    }),
  );
  await writeFile(
    join(root, "local/library.json"),
    JSON.stringify({ name: "local", version: "0.1.0", sources: ["type.json"] }),
  );
  await writeFile(
    join(root, "local/type.json"),
    JSON.stringify({ types: [type] }),
  );
  let uid = 0;
  const objects: object[] = [];
  const next = () =>
    `00000000-0000-4000-8000-${String(++uid).padStart(12, "0")}`;
  const device = (designation: string, type: string) =>
    objects.push({ uid: next(), kind: "device", designation, type });
  const wire = (a: string, b: string) =>
    objects.push({
      uid: next(),
      kind: "wire",
      designation: `W${uid}`,
      endpoints: [a, b].map((s) => {
        const i = s.indexOf(".");
        return { device: s.slice(0, i), terminal: s.slice(i + 1) };
      }),
    });
  device("DUT", "local:dut");
  let view: object;
  if (family === "power") {
    if (mode === "source3") {
      device("M1", "core:motor-3ph");
      for (const [a, b] of [
        ["L1", "U"],
        ["L2", "V"],
        ["L3", "W"],
        ["PE", "PE"],
      ])
        wire(`DUT.${a}`, `M1.${b}`);
    } else {
      device("SRC", "core:supply-480v-3ph");
      if (mode === "motor3") {
        for (const [a, b] of [
          ["L1", "U"],
          ["L2", "V"],
          ["L3", "W"],
          ["PE", "PE"],
        ])
          wire(`SRC.${a}`, `DUT.${b}`);
      } else if (mode === "motor2" || mode === "ac") {
        wire("SRC.L1", "DUT.P");
        wire("SRC.L2", "DUT.N");
      } else {
        device("M1", "core:motor-3ph");
        wire("SRC.L2", "M1.V");
        wire("SRC.L3", "M1.W");
        if (mode === "earth") {
          wire("SRC.L1", "M1.U");
          wire("SRC.PE", "DUT.T");
          wire("DUT.T", "M1.PE");
        } else {
          wire("SRC.PE", "M1.PE");
          wire("SRC.L1", mode === "terminal" ? "DUT.T" : "DUT.A");
          wire(mode === "terminal" ? "DUT.T" : "DUT.B", "M1.U");
        }
      }
    }
    view = {
      format: "schematic-view-request/0.1",
      root: {
        by: "designation",
        value:
          mode === "motor3" || mode === "motor2" || mode === "ac"
            ? "DUT"
            : "M1",
      },
      family: "power",
    };
  } else if (mode.startsWith("sensor-")) {
    device("PS1", "core:psu-24vdc");
    device("PLC1", "core:plc-compact");
    wire("PS1.+", "DUT.P");
    wire("PS1.-", "DUT.N");
    wire("DUT.Q", "PLC1.X1.0");
    view = {
      format: "schematic-view-request/0.2",
      root: { by: "designation", value: family === "loads" ? "PS1" : "DUT" },
      intent:
        family === "loads"
          ? { kind: "loads" }
          : {
              kind: "trace",
              to: { by: "designation", value: "PLC1" },
              includePower: true,
            },
    };
  } else if (mode === "dc-source") {
    device("K1", "core:contactor-3p-1no");
    device("PLC1", "core:plc-compact");
    if (family === "loads") {
      wire("DUT.P", "PLC1.L+");
      wire("DUT.N", "PLC1.M");
      view = {
        format: "schematic-view-request/0.2",
        root: { by: "designation", value: "DUT" },
        intent: { kind: "loads" },
      };
    } else {
      wire("DUT.P", "K1.A1");
      wire("DUT.N", "K1.A2");
      view = {
        format: "schematic-view-request/0.1",
        root: { by: "designation", value: "K1" },
        family: "control",
      };
    }
  } else {
    device("PS1", "core:psu-24vdc");
    if (mode === "dc-load" || mode === "load") {
      wire("PS1.+", "DUT.P");
      wire("PS1.-", "DUT.N");
      view = {
        format: "schematic-view-request/0.2",
        root: { by: "designation", value: "PS1" },
        intent: { kind: "loads" },
      };
    } else if (mode === "coil") {
      wire("PS1.+", "DUT.A");
      wire("PS1.-", "DUT.B");
      view = {
        format: "schematic-view-request/0.1",
        root: { by: "designation", value: "DUT" },
        family: "control",
      };
    } else {
      const loads = family === "loads";
      device(
        loads ? "PLC1" : "K1",
        loads ? "core:plc-compact" : "core:contactor-3p-1no",
      );
      const target = loads ? "PLC1.L+" : "K1.A1";
      if (mode === "channel-output") wire("DUT.Q", target);
      else {
        wire("PS1.+", mode === "terminal" ? "DUT.T" : "DUT.A");
        wire(mode === "terminal" ? "DUT.T" : "DUT.B", target);
      }
      wire("PS1.-", loads ? "PLC1.M" : "K1.A2");
      view = loads
        ? {
            format: "schematic-view-request/0.2",
            root: { by: "designation", value: "PS1" },
            intent: { kind: "loads" },
          }
        : {
            format: "schematic-view-request/0.1",
            root: { by: "designation", value: "K1" },
            family: "control",
          };
    }
  }
  await writeFile(join(root, "source.json"), JSON.stringify({ objects }));
  const locked = await lockProject(root);
  if (!locked.ok) throw Error(JSON.stringify(locked.diagnostics));
  const result = await compileProject(root);
  if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
  return {
    ir: result.ir,
    request: view,
    dispose: () => rm(root, { recursive: true, force: true }),
  };
}
