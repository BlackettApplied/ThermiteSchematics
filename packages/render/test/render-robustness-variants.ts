import type {
  RobustnessDraft,
  RobustnessVariant,
} from "./render-robustness-draft.js";

export function addActuation({
  returnVia,
  eq,
  w,
  device,
  wire,
}: RobustnessDraft) {
  eq.objects.push(
    device("K1", "contactor-3p-1no", "2f1d8c4a-6b7e-4f0a-9c3d-1a2b3c4d5e01"),
  );

  w.objects.push(
    wire(
      "W-K1-1",
      "PLC1.X2.0",
      "K1.A1",
      "2f1d8c4a-6b7e-4f0a-9c3d-1a2b3c4d5e02",
    ),
    wire("W-K1-2", "K1.A2", returnVia, "2f1d8c4a-6b7e-4f0a-9c3d-1a2b3c4d5e03"),
  );

  if (returnVia === "K2.A2" || returnVia === "TB1.1") {
    eq.objects.push(
      device(
        returnVia.split(".")[0]!,
        returnVia === "K2.A2" ? "contactor-3p-1no" : "terminal-block-8",
      ),
    );
    w.objects.push(wire("W-VIA", returnVia, "PS1.-"));
  }
}

export function addSecondPlc({ eq, w, device, wire }: RobustnessDraft) {
  eq.objects.push(
    device("PLC2", "plc-compact", "add5aa10-cef8-4b63-94c6-a69511867702"),
  );

  w.objects.push(
    wire(
      "W-PLC2-1",
      "PS1.+",
      "PLC2.L+",
      "66a38e78-10a6-48fc-af0e-a444e1281a52",
    ),
    wire("W-PLC2-2", "PS1.-", "PLC2.M", "7407ac4a-5beb-42f8-b639-a70d8123d462"),
  );
}

export function createVariantConnections({
  eq,
  w,
  device,
  wire,
}: RobustnessDraft) {
  const D = (name: string, type: string) => eq.objects.push(device(name, type));

  let next = 0;

  const W = (a: string, b: string) =>
    w.objects.push(wire(`W-X-${++next}`, a, b));

  const feed = (name: string) => {
    W("PS1.+", `${name}.L+`);
    W("PS1.-", `${name}.M`);
  };
  return { D, W, feed };
}

type VariantConnections = ReturnType<typeof createVariantConnections>;

export function addUnnamedJumpers(
  { w, wire }: RobustnessDraft,
  { D }: VariantConnections,
) {
  D("PLC2", "plc-compact");

  for (const [i, a, b] of [
    [0, "PS1.+", "PLC2.L+"],
    [1, "PS1.+", "PLC2.L+"],
    [2, "PS1.-", "PLC2.M"],
  ] as const) {
    const jumper = wire(`JP-${i}`, a, b);
    w.objects.push({
      uid: jumper.uid,
      kind: "jumper",
      endpoints: jumper.endpoints,
    });
  }
}

export function addParallel({ D, W }: VariantConnections) {
  D("B1", "prox-pnp-3wire");

  D("TB1", "terminal-block-8");

  W("B1.4", "TB1.1");

  W("B1.4", "TB1.1");

  W("TB1.1", "PLC1.X1.0");

  W("PS1.+", "B1.1");

  W("PS1.-", "B1.3");
}

export function addTwoPsu({ D, W, feed }: VariantConnections) {
  D("PLC2", "plc-compact");

  feed("PLC2");

  D("PS2", "psu-24vdc");

  for (const name of ["PLC3", "PLC4"]) {
    D(name, "plc-compact");
    W("PS2.+", `${name}.L+`);
    W("PS2.-", `${name}.M`);
  }
}

export function addTbLoads({ D, W }: VariantConnections) {
  D("PLC2", "plc-compact");

  D("TB1", "terminal-block-8");

  W("PS1.+", "TB1.1");

  W("TB1.1", "PLC2.L+");

  W("PS1.-", "TB1.2");

  W("TB1.2", "PLC2.M");
}

export function addCoilFork({ D, W }: VariantConnections) {
  for (const [name, type] of [
    ["S1", "pushbutton-nc"],
    ["LS1", "limit-switch-2wire"],
    ["TB1", "terminal-block-8"],
    ["K1", "contactor-3p-1no"],
    ["K2", "contactor-3p-1no"],
  ])
    D(name!, type!);

  for (const [a, b] of [
    ["PS1.+", "TB1.1"],
    ["TB1.1", "S1.11"],
    ["TB1.1", "LS1.13"],
    ["S1.12", "K1.A1"],
    ["LS1.14", "K2.A1"],
    ["K1.A2", "TB1.2"],
    ["K2.A2", "TB1.2"],
    ["TB1.2", "PS1.-"],
  ])
    W(a!, b!);
}

export function addPlc4(
  { D, feed }: VariantConnections,
  variant: RobustnessVariant,
) {
  for (const name of variant === "plc3"
    ? ["PLC2", "PLC3"]
    : ["PLC2", "PLC3", "PLC4"]) {
    D(name, "plc-compact");
    feed(name);
  }
}

export function addDaisy({ D, W }: VariantConnections) {
  D("PLC2", "plc-compact");

  W("PLC1.L+", "PLC2.L+");

  W("PLC1.M", "PLC2.M");
}

export function addPnp({ D, W, feed }: VariantConnections) {
  D("B1", "prox-pnp-3wire");

  D("PLC2", "plc-compact");

  W("PS1.+", "B1.1");

  W("PS1.-", "B1.3");

  feed("PLC2");

  W("B1.4", "PLC1.X1.0");
}

export function addLoadsViaK2({ D, W }: VariantConnections) {
  D("K2", "contactor-3p-1no");

  D("PLC2", "plc-compact");

  W("PS1.+", "PLC2.L+");

  W("PS1.-", "K2.A2");

  W("K2.A2", "PLC2.M");
}

export function addTraceViaK2({ D, W }: VariantConnections) {
  D("K2", "contactor-3p-1no");

  D("LS1", "limit-switch-2wire");

  W("PS1.+", "K2.A1");

  W("K2.A1", "LS1.13");

  W("LS1.14", "PLC1.X1.0");
}

export function addPowerViaK2({ D, W }: VariantConnections) {
  D("SRC1", "supply-480v-3ph");

  D("M1", "motor-3ph");

  D("K2", "contactor-3p-1no");

  for (const [a, b] of [
    ["SRC1.L1", "M1.U"],
    ["SRC1.L2", "M1.V"],
    ["SRC1.L3", "M1.W"],
    ["SRC1.PE", "K2.A1"],
    ["K2.A1", "M1.PE"],
  ])
    W(a!, b!);
}

export function addExtendedVariant(
  draft: RobustnessDraft,
  variant: RobustnessVariant,
) {
  const connections = createVariantConnections(draft);
  switch (variant) {
    case "unnamed_jumpers":
      addUnnamedJumpers(draft, connections);
      break;
    case "parallel":
      addParallel(connections);
      break;
    case "two_psu":
      addTwoPsu(connections);
      break;
    case "tb_loads":
      addTbLoads(connections);
      break;
    case "coil_fork":
      addCoilFork(connections);
      break;
    case "plc3":
    case "plc4":
      addPlc4(connections, variant);
      break;
    case "daisy":
      addDaisy(connections);
      break;
    case "pnp":
      addPnp(connections);
      break;
    case "loads_via_k2":
      addLoadsViaK2(connections);
      break;
    case "trace_via_k2":
      addTraceViaK2(connections);
      break;
    case "power_via_k2":
      addPowerViaK2(connections);
      break;
  }
}

export function addPlantDetails({ eq, w, device, wire }: RobustnessDraft) {
  delete eq.objects[0].connectionReview;

  eq.objects[1].io = {
    addressSpace: "PLC1",
    channels: {
      di0: { address: "%I0.0", signal: "Start", usage: "in-use" },
      di1: { usage: "spare" },
    },
  };

  Object.assign(eq.objects[2], {
    io: {
      addressSpace: "PLC2",
      channels: {
        di0: { address: "%IB0" },
        di1: { address: "%I0.0" },
        do0: { address: "%IW0" },
        do1: { address: "NOT-AN-ADDRESS" },
      },
    },
  });

  for (const [name, type] of [
    ["SRC1", "supply-480v-3ph"],
    ["M1", "motor-3ph"],
    ["K1", "contactor-3p-1no"],
    ["LS1", "limit-switch-2wire"],
    ["S1", "pushbutton-nc"],
  ])
    eq.objects.push(device(name!, type!));

  const ends = [
    ["SRC1.L1", "M1.U"],
    ["SRC1.L2", "M1.V"],
    ["SRC1.L3", "M1.W"],
    ["SRC1.PE", "M1.PE"],
    ["PLC1.X2.0", "K1.A1"],
    ["K1.A2", "PS1.-"],
    ["PS1.+", "LS1.13"],
    ["LS1.14", "PLC1.X1.0"],
    ["PS1.+", "S1.11"],
    ["S1.12", "PLC2.X1.0"],
    ["SRC1.L1", "PS1.L"],
    ["SRC1.L2", "PS1.N"],
  ];

  ends.forEach(([a, b], i) => w.objects.push(wire(`W-GEN-${i + 1}`, a!, b!)));
}

export function applyRobustnessVariant(
  draft: RobustnessDraft,
  variant: RobustnessVariant,
) {
  if (variant === "actuation") addActuation(draft);
  else if (variant === "minimal" || variant === "plant") addSecondPlc(draft);
  else addExtendedVariant(draft, variant);
  if (variant === "plant") addPlantDetails(draft);
}
