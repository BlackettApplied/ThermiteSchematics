/** Render capabilities only. These records never grant electrical continuity.
 * Keep JSON-serializable so runtime guides can print the catalog directly.
 * Support is per function/role, not a promise that a whole view can be laid out.
 */
export type SymbolRendererFamily =
  "power" | "control" | "loads" | "circuit" | "signal-loop";

export interface SymbolFunctionShape {
  readonly kind:
    "contact" | "coil" | "load" | "source" | "bus" | "channel" | "other";
  readonly minTerminals: number;
  readonly maxTerminals: number;
  /** Constraints on terminals in authored function order. */
  readonly terminalRoles?: readonly string[];
  readonly firstTerminalVoltageType?: "DC";
  /** Existing authored contact state; this is an internal catalog constraint. */
  readonly normalState?: "open";
  readonly notes?: string;
}

export interface SymbolFamilySupport {
  readonly family: SymbolRendererFamily;
  readonly role:
    | "function"
    | "boundary"
    | "from"
    | "to"
    | "intermediate"
    | "auxiliary"
    | "series-power";
  /** Alternative shapes. Explicit circuitSymbols are checked separately. */
  readonly functions: readonly SymbolFunctionShape[];
  /** Terminal-only roles do not require a declared function. */
  readonly terminalOnly?: { readonly minTerminals: number };
  readonly notes?: string;
}

export interface CoreSymbolBinding {
  readonly typeId: string;
  readonly symbol: string;
  readonly binding: "symbol-alias";
  readonly equivalent?: string;
}

/** Original core metadata and reusable IEC aliases. Binding always requires the
 * equivalent profile's authored function shapes, regardless of the type ID. */
export const CORE_SYMBOL_BINDINGS: readonly CoreSymbolBinding[] = [
  {
    typeId: "core:supply-480v-3ph",
    symbol: "iec:three-phase-supply",
    binding: "symbol-alias",
    equivalent: "thermite:power-source",
  },
  {
    typeId: "core:breaker-3p",
    symbol: "iec:circuit-breaker",
    binding: "symbol-alias",
    equivalent: "thermite:breaker",
  },
  {
    typeId: "core:contactor-3p-1no",
    symbol: "iec:contactor",
    binding: "symbol-alias",
    equivalent: "thermite:contactor",
  },
  {
    typeId: "core:overload-3p-1nc",
    symbol: "iec:overload-relay",
    binding: "symbol-alias",
    equivalent: "thermite:overload",
  },
  {
    typeId: "core:motor-3ph",
    symbol: "iec:three-phase-motor",
    binding: "symbol-alias",
    equivalent: "thermite:motor-3ph",
  },
  {
    typeId: "core:pushbutton-nc",
    symbol: "iec:pushbutton-nc",
    binding: "symbol-alias",
    equivalent: "thermite:pushbutton",
  },
  {
    typeId: "core:limit-switch-2wire",
    symbol: "iec:limit-switch-no",
    binding: "symbol-alias",
    equivalent: "thermite:switch",
  },
  {
    typeId: "core:plc-compact",
    symbol: "iec:plc",
    binding: "symbol-alias",
    equivalent: "thermite:io-module",
  },
  {
    typeId: "core:psu-24vdc",
    symbol: "iec:dc-power-supply",
    binding: "symbol-alias",
    equivalent: "thermite:dc-supply",
  },
  {
    typeId: "core:terminal-block-8",
    symbol: "iec:terminal-block",
    binding: "symbol-alias",
    equivalent: "thermite:terminal-strip",
  },
  {
    typeId: "core:junction-box-8",
    symbol: "iec:junction-box",
    binding: "symbol-alias",
    equivalent: "thermite:terminal-strip",
  },
  {
    typeId: "core:prox-pnp-3wire",
    symbol: "iec:proximity-sensor",
    binding: "symbol-alias",
    equivalent: "thermite:sensor-3wire",
  },
];

export interface SymbolProfile {
  readonly id: string;
  /** Additional aliases; original core IEC aliases are recorded in coreAliases. */
  readonly aliases: readonly string[];
  readonly coreAliases: readonly CoreSymbolBinding[];
  readonly support: readonly SymbolFamilySupport[];
  readonly notes?: string;
}

const BUS = { kind: "bus", minTerminals: 1, maxTerminals: 1 } as const;
const CONTACT = { kind: "contact", minTerminals: 2, maxTerminals: 2 } as const;
const COIL = { kind: "coil", minTerminals: 2, maxTerminals: 2 } as const;
const LOAD2 = { kind: "load", minTerminals: 2, maxTerminals: 2 } as const;
const LOAD23 = { kind: "load", minTerminals: 2, maxTerminals: 3 } as const;
const SOURCE = { kind: "source", minTerminals: 1, maxTerminals: 4 } as const;
const SOURCE2 = { kind: "source", minTerminals: 2, maxTerminals: 2 } as const;
const CHANNEL = { kind: "channel", minTerminals: 1, maxTerminals: 2 } as const;
const OTHER2 = { kind: "other", minTerminals: 2, maxTerminals: 2 } as const;
// Signal-loop endpoints accept schema-authorable two-terminal functions.
const LOOP_ENDPOINT_SHAPES: readonly SymbolFunctionShape[] = [
  CONTACT,
  COIL,
  LOAD2,
  SOURCE2,
  { ...BUS, minTerminals: 2, maxTerminals: 2 },
  { ...CHANNEL, minTerminals: 2 },
  OTHER2,
];
const DC_LOAD = { ...LOAD2, firstTerminalVoltageType: "DC" } as const;
const DC_SOURCE = {
  ...SOURCE2,
  terminalRoles: ["dc_positive_output", "dc_return_output"],
} as const;
const ROOTED_CONTROL_SHAPES = [BUS, DC_LOAD, DC_SOURCE];
const ROOTED_SUPPORT: readonly SymbolFamilySupport[] = [
  { family: "power", role: "function", functions: [BUS] },
  { family: "control", role: "function", functions: ROOTED_CONTROL_SHAPES },
  {
    family: "loads",
    role: "function",
    functions: ROOTED_CONTROL_SHAPES,
    notes:
      "Uses control-family bindings; view selection still requires a source/load path.",
  },
];
const LOOP_INTERMEDIATE: SymbolFamilySupport = {
  family: "signal-loop",
  role: "intermediate",
  functions: [],
  terminalOnly: { minTerminals: 2 },
  notes:
    "Both conductors must traverse the same authored device stages. Auxiliary pairs may be selected separately; no function kind is inferred.",
};

const LOOP_AUXILIARY: SymbolFamilySupport = {
  family: "signal-loop",
  role: "auxiliary",
  functions: [OTHER2],
  notes:
    "Declared other/2 auxiliary pairs may begin/end at an intermediate stage, on separate nets. This catalog deliberately limits auxiliary shape support; contact/2 and bus/2 need their own supported circuit binding.",
};

const POWER_CONTACT = {
  ...CONTACT,
  terminalRoles: ["power_input", "power_output"],
} as const;
const AUX_CONTACT = { ...CONTACT, terminalRoles: ["aux", "aux"] } as const;
const EARTH = { ...BUS, terminalRoles: ["protective_earth"] } as const;
const LOAD3 = { kind: "load", minTerminals: 3, maxTerminals: 3 } as const;
const PHASE_SOURCE = {
  kind: "source",
  minTerminals: 3,
  maxTerminals: 3,
  terminalRoles: ["phase_1_source", "phase_2_source", "phase_3_source"],
} as const;
const AC_INPUT = {
  ...LOAD2,
  terminalRoles: ["ac_line_input", "ac_input_return"],
} as const;
function rooted(
  power: readonly SymbolFunctionShape[],
  control: readonly SymbolFunctionShape[],
  loads: readonly SymbolFunctionShape[] = control,
): SymbolFamilySupport[] {
  return [
    ...(power.length
      ? [
          {
            family: "power" as const,
            role: "function" as const,
            functions: power,
          },
        ]
      : []),
    ...(control.length
      ? [
          {
            family: "control" as const,
            role: "function" as const,
            functions: control,
          },
        ]
      : []),
    ...(loads.length
      ? [
          {
            family: "loads" as const,
            role: "function" as const,
            functions: loads,
            notes:
              "Loads selection admits load functions and their explicit terminal/source context; it does not traverse contacts or coils.",
          },
        ]
      : []),
  ];
}

/** The supported reusable profiles. Circuit accepts a one-terminal bus on each.
 * Circuit/rooted mechanisms are metadata, not drawable functions. Support does not imply
 * full device coverage, connectivity, a valid root, or printable layout.
 */
export const SYMBOL_PROFILES: readonly SymbolProfile[] = [
  {
    id: "thermite:sensor-3wire",
    notes:
      "Two-terminal supply load in authored positive/return order and one-terminal output channel. Supply roles are authoritative: require one supply_positive and one supply_return when either supply terminal has any role; use authored order only when neither terminal has a role. Names and pin numbers never identify polarity. Rooted control/loads combine one supply and one output without electrical continuity. PNP/NPN text recognizes standalone positive type descriptions: Three-wire PNP proximity sensor or NPN output sensor (PNP/NPN and proximity/output variants, optional final period). Free prose is not interpreted; the profile alone declares neither.",
    aliases: [],
    coreAliases: CORE_SYMBOL_BINDINGS.filter(
      (b) => b.equivalent === "thermite:sensor-3wire",
    ),
    support: [
      ...rooted(
        [],
        [
          {
            ...LOAD2,
            notes:
              "Rooted binding requires one output channel/1 companion on three distinct terminals.",
          },
          {
            kind: "channel",
            minTerminals: 1,
            maxTerminals: 1,
            notes:
              "Output direction required; rooted binding requires one load/2 supply companion on distinct terminals.",
          },
        ],
      ),
      {
        family: "circuit",
        role: "function",
        functions: [
          BUS,
          LOAD2,
          {
            kind: "channel",
            minTerminals: 1,
            maxTerminals: 1,
            notes:
              "Output direction required; rooted binding requires one load/2 supply companion on distinct terminals.",
          },
        ],
      },
    ],
  },
  {
    id: "thermite:contactor",
    notes:
      "Two-terminal coils and contacts, with authored normal state. Internal relationships provide non-conductive coil/contact references.",
    aliases: [],
    coreAliases: CORE_SYMBOL_BINDINGS.filter(
      (b) => b.equivalent === "thermite:contactor",
    ),
    support: [
      ...rooted([POWER_CONTACT], [COIL, AUX_CONTACT], []),
      { family: "circuit", role: "function", functions: [BUS, CONTACT, COIL] },
    ],
  },
  {
    id: "thermite:relay",
    notes:
      "Two-terminal coils and contacts; relay power can be a separate two- or three-terminal load.",
    aliases: [],
    coreAliases: [],
    support: [
      ...rooted([], [CONTACT, COIL, DC_LOAD], [DC_LOAD]),
      {
        family: "circuit",
        role: "function",
        functions: [BUS, CONTACT, COIL, LOAD23],
      },
    ],
  },
  {
    id: "thermite:breaker",
    notes:
      "Protection contacts; explicit circuitSymbols marks distinguish main protection poles from auxiliary contacts.",
    aliases: [],
    coreAliases: CORE_SYMBOL_BINDINGS.filter(
      (b) => b.equivalent === "thermite:breaker",
    ),
    support: [
      ...rooted([CONTACT], []),
      { family: "circuit", role: "function", functions: [BUS, CONTACT] },
    ],
  },
  {
    id: "thermite:overload",
    notes:
      "Protection contacts; explicit circuitSymbols marks distinguish main protection poles from auxiliary contacts.",
    aliases: [],
    coreAliases: CORE_SYMBOL_BINDINGS.filter(
      (b) => b.equivalent === "thermite:overload",
    ),
    support: [
      ...rooted([POWER_CONTACT], [AUX_CONTACT], []),
      { family: "circuit", role: "function", functions: [BUS, CONTACT] },
    ],
  },
  {
    id: "thermite:fuse",
    notes:
      "Protection contacts or a two-terminal other function; explicit marks distinguish main and auxiliary functions.",
    aliases: [],
    coreAliases: [],
    support: [
      ...rooted([CONTACT, OTHER2], []),
      {
        family: "circuit",
        role: "function",
        functions: [BUS, CONTACT, OTHER2],
      },
    ],
  },
  {
    id: "thermite:motor-3ph",
    notes:
      "Three-terminal motor load; phase terminals stay electrically distinct.",
    aliases: [],
    coreAliases: CORE_SYMBOL_BINDINGS.filter(
      (b) => b.equivalent === "thermite:motor-3ph",
    ),
    support: [
      ...rooted([LOAD3, EARTH], []),
      {
        family: "circuit",
        role: "function",
        functions: [BUS, { kind: "load", minTerminals: 3, maxTerminals: 3 }],
      },
    ],
  },
  {
    id: "thermite:motor",
    notes: "Two-terminal motor load.",
    aliases: [],
    coreAliases: [],
    support: [
      ...rooted([LOAD2], []),
      { family: "circuit", role: "function", functions: [BUS, LOAD2] },
    ],
  },
  {
    id: "thermite:heater",
    notes:
      "Two- or three-terminal resistive loads; no star/delta connection is inferred.",
    aliases: [],
    coreAliases: [],
    support: [
      { family: "circuit", role: "function", functions: [BUS, LOAD23] },
    ],
  },
  {
    id: "thermite:transformer",
    notes:
      "Two-terminal primary load and secondary source windings face opposite sides of a shared magnetic core. The core is a presentation association, not a conductive connection.",
    aliases: [],
    coreAliases: [],
    support: [
      { family: "circuit", role: "function", functions: [BUS, LOAD2, SOURCE2] },
    ],
  },
  {
    id: "thermite:power-source",
    notes: "Supply boundaries from authored source functions.",
    aliases: [],
    coreAliases: CORE_SYMBOL_BINDINGS.filter(
      (b) => b.equivalent === "thermite:power-source",
    ),
    support: [
      ...rooted([PHASE_SOURCE, EARTH], [DC_SOURCE]),
      { family: "circuit", role: "function", functions: [BUS, SOURCE] },
    ],
  },
  {
    id: "thermite:dc-supply",
    notes:
      "Supply boundaries; AC input and DC output are separate authored functions, with no implicit conductive step through the supply.",
    aliases: [],
    coreAliases: CORE_SYMBOL_BINDINGS.filter(
      (b) => b.equivalent === "thermite:dc-supply",
    ),
    support: [
      ...rooted([BUS, AC_INPUT], ROOTED_CONTROL_SHAPES),
      { family: "circuit", role: "function", functions: [BUS, LOAD23, SOURCE] },
      {
        family: "signal-loop",
        role: "series-power",
        functions: [DC_SOURCE],
        notes:
          "Selection and polarity are checked; series loop drawing is not available yet.",
      },
    ],
  },
  {
    id: "thermite:io-module",
    notes:
      "One/two-terminal circuit channels, supply functions, contacts and generic interfaces. Rooted control binds one-terminal channels; loads support covers buses and declared DC load/source context rather than standalone channels. Authored I/O address and signal meaning identify channels.",
    aliases: [],
    coreAliases: CORE_SYMBOL_BINDINGS.filter(
      (b) => b.equivalent === "thermite:io-module",
    ),
    support: [
      { family: "power", role: "function", functions: [BUS] },
      ...rooted(
        [],
        [
          ...ROOTED_CONTROL_SHAPES,
          { kind: "channel", minTerminals: 1, maxTerminals: 1 },
        ],
        ROOTED_CONTROL_SHAPES,
      ),
      {
        family: "circuit",
        role: "function",
        functions: [
          BUS,
          CONTACT,
          LOAD23,
          SOURCE,
          CHANNEL,
          {
            kind: "other",
            minTerminals: 1,
            maxTerminals: 32,
            notes:
              "Mark binding accepts 1-32 terminals. Measured 2026-11-04 on base 7a7c1fb plus P1 (review probe-io32): left-to-right samples fit 24 terminals on tabloid and 12 on A4; larger sampled interfaces failed with R006. These are measured examples, not guaranteed paper limits. Larger interfaces may need top-to-bottom or larger paper; labels and selection affect printability.",
          },
        ],
      },
    ],
  },
  {
    id: "thermite:terminal-strip",
    notes:
      "One-terminal buses have pass-through display ports for the same physical terminal. Terminal-only boundaries do not invent bus functions or common adjacent terminals.",
    aliases: [],
    coreAliases: CORE_SYMBOL_BINDINGS.filter(
      (b) => b.equivalent === "thermite:terminal-strip",
    ),
    support: [
      ...ROOTED_SUPPORT,
      { family: "circuit", role: "function", functions: [BUS] },
      {
        family: "circuit",
        role: "boundary",
        functions: [],
        terminalOnly: { minTerminals: 1 },
        notes:
          "Unselected terminals can be conductor boundaries without bus functions, including distributed terminal layout.",
      },
      LOOP_INTERMEDIATE,
      LOOP_AUXILIARY,
    ],
  },
  {
    id: "thermite:solenoid",
    notes: "Two-terminal coil with a solenoid mark.",
    aliases: [],
    coreAliases: [],
    support: [{ family: "circuit", role: "function", functions: [BUS, COIL] }],
  },
  {
    id: "thermite:lamp",
    notes: "Two-terminal lamp load.",
    aliases: [],
    coreAliases: [],
    support: [
      ...rooted([], [LOAD2]),
      { family: "circuit", role: "function", functions: [BUS, LOAD2] },
    ],
  },
  {
    id: "thermite:switch",
    notes: "Two-terminal contact; the mark uses the authored normal state.",
    aliases: [],
    coreAliases: CORE_SYMBOL_BINDINGS.filter(
      (b) => b.equivalent === "thermite:switch",
    ),
    support: [
      ...rooted([], [CONTACT], []),
      { family: "circuit", role: "function", functions: [BUS, CONTACT] },
    ],
  },
  {
    id: "thermite:disconnector",
    notes:
      "Open contact only. Opting in asserts author-selected disconnector-function identity. Isolation suitability (impulse withstand, contact gap, position indication, lockability), load-break and ratings are not asserted.",
    aliases: [],
    coreAliases: [],
    support: [
      ...rooted(
        [{ ...POWER_CONTACT, normalState: "open" }],
        [{ ...CONTACT, normalState: "open" }],
        [],
      ),
      {
        family: "circuit",
        role: "function",
        functions: [BUS, { ...CONTACT, normalState: "open" }],
      },
    ],
  },
  {
    id: "thermite:pushbutton",
    notes:
      "Two-terminal contact with pushbutton actuation and authored normal state; a separate lamp needs its own supported explicit circuit mark.",
    aliases: [],
    coreAliases: CORE_SYMBOL_BINDINGS.filter(
      (b) => b.equivalent === "thermite:pushbutton",
    ),
    support: [
      ...rooted([], [CONTACT], []),
      { family: "circuit", role: "function", functions: [BUS, CONTACT] },
    ],
  },
  {
    id: "thermite:estop",
    notes:
      "Latching mushroom-head emergency-stop operator with authored contact state. The profile declares operator identity, not safety performance or simulated retention.",
    aliases: [],
    coreAliases: [],
    support: [
      ...rooted([], [CONTACT], []),
      { family: "circuit", role: "function", functions: [BUS, CONTACT] },
    ],
  },
  {
    id: "thermite:selector",
    notes:
      "Maintained rotary selector; authored contact state, without simulated retention.",
    aliases: [],
    coreAliases: [],
    support: [
      ...rooted([], [CONTACT], []),
      { family: "circuit", role: "function", functions: [BUS, CONTACT] },
    ],
  },
  {
    id: "thermite:thermocouple",
    notes: "Two-terminal other function representing the sensor interface.",
    aliases: [],
    coreAliases: [],
    support: [
      { family: "circuit", role: "function", functions: [BUS, OTHER2] },
    ],
  },
  {
    id: "thermite:pressure-switch",
    notes:
      "Two-terminal contacts with pressure actuation and declared normal state.",
    aliases: [],
    coreAliases: [],
    support: [
      { family: "circuit", role: "function", functions: [BUS, CONTACT] },
    ],
  },
  {
    id: "thermite:level-switch",
    notes:
      "Two-terminal contacts with float actuation and declared normal state.",
    aliases: [],
    coreAliases: [],
    support: [
      { family: "circuit", role: "function", functions: [BUS, CONTACT] },
    ],
  },
  {
    id: "thermite:level-sensor",
    notes:
      "Two/three-terminal other interfaces or one/two-terminal channels with their authored address and signal meaning.",
    aliases: [],
    coreAliases: [],
    support: [
      {
        family: "circuit",
        role: "function",
        functions: [
          BUS,
          CHANNEL,
          { kind: "other", minTerminals: 2, maxTerminals: 3 },
        ],
      },
    ],
  },
  {
    id: "thermite:conductivity-probe",
    notes:
      "Two-eight-terminal other interfaces; no internal commoning is inferred.",
    aliases: [],
    coreAliases: [],
    support: [
      {
        family: "circuit",
        role: "function",
        functions: [BUS, { kind: "other", minTerminals: 2, maxTerminals: 8 }],
      },
    ],
  },
  {
    id: "thermite:receptacle",
    notes:
      "Two/three-terminal loads; protective earth may be a separate one-terminal bus.",
    aliases: [],
    coreAliases: [],
    support: [
      { family: "circuit", role: "function", functions: [BUS, LOAD23] },
    ],
  },
  {
    id: "thermite:pressure-transmitter",
    notes:
      "Signal-loop only; unsupported in circuit and rooted power/control/loads views. The two-wire-transmitter alias shares the loop endpoint gate.",
    aliases: ["thermite:two-wire-transmitter"],
    coreAliases: [],
    support: [
      {
        family: "signal-loop",
        role: "from",
        functions: LOOP_ENDPOINT_SHAPES,
        notes:
          "Selected two-terminal endpoint to an input channel; the loop renderer does not restrict the transmitter function kind.",
      },
    ],
  },
  {
    id: "thermite:analog-actuator",
    notes:
      "Signal-loop only; unsupported in circuit and rooted power/control/loads views.",
    aliases: [],
    coreAliases: [],
    support: [
      {
        family: "signal-loop",
        role: "to",
        functions: LOOP_ENDPOINT_SHAPES,
        notes:
          "Selected two-terminal endpoint from an output channel; auxiliary supply pairs are optional selections.",
      },
    ],
  },
  {
    id: "thermite:bulkhead-connector",
    notes:
      "Signal-loop intermediate/auxiliary role only; unsupported as a circuit or rooted symbol.",
    aliases: [],
    coreAliases: [],
    support: [LOOP_INTERMEDIATE, LOOP_AUXILIARY],
  },
];

/** Resolve declared profile aliases without consulting type identity. */
export function symbolProfile(type: {
  readonly symbol?: string | undefined;
}): string | undefined {
  const equivalent =
    CORE_SYMBOL_BINDINGS.find((b) => b.symbol === type.symbol)?.equivalent ??
    type.symbol;
  return (
    SYMBOL_PROFILES.find(
      (p) => p.id === equivalent || p.aliases.includes(equivalent ?? ""),
    )?.id ?? equivalent
  );
}

export type SensorSupplyResolution =
  | { readonly ok: true; readonly positive: string; readonly return: string }
  | { readonly ok: false; readonly reason: string };

/** Supply roles are authoritative. Authored order is a fallback only when
 * neither supply terminal has any role. This helper neither assigns roles nor joins nets. */
export function resolveSensorSupply(
  terminals: readonly {
    readonly key: string;
    readonly role?: string | undefined;
  }[],
): SensorSupplyResolution {
  const declared = terminals
    .map((t) => `${JSON.stringify(t.key)} (${t.role ?? "no role"})`)
    .join(", ");
  if (terminals.length !== 2 || terminals[0]!.key === terminals[1]!.key)
    return {
      ok: false,
      reason: `Sensor supply requires two distinct terminals; declared ${declared}.`,
    };
  if (!terminals.some((t) => t.role !== undefined))
    return { ok: true, positive: terminals[0]!.key, return: terminals[1]!.key };
  const positive = terminals.filter((t) => t.role === "supply_positive"),
    ret = terminals.filter((t) => t.role === "supply_return");
  if (positive.length !== 1 || ret.length !== 1)
    return {
      ok: false,
      reason: `Sensor supply roles require exactly one supply_positive and one supply_return; declared ${declared}. Review the authored roles; polarity cannot be inferred.`,
    };
  return { ok: true, positive: positive[0]!.key, return: ret[0]!.key };
}
