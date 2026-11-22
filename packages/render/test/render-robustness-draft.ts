import { createHash } from "node:crypto";

export type RobustnessVariant =
  | "minimal"
  | "plant"
  | "actuation"
  | "two_psu"
  | "tb_loads"
  | "coil_fork"
  | "parallel"
  | "unnamed_jumpers"
  | "plc3"
  | "plc4"
  | "daisy"
  | "pnp"
  | "loads_via_k2"
  | "trace_via_k2"
  | "power_via_k2";
export type RobustnessOptions = {
  returnVia?: string;
  plc2Designation?: string;
  plc2Location?: string;
  noPotentials?: boolean;
  duplicatePotentials?: boolean;
  reverseAuthoredOrder?: boolean;
};

export function createRobustnessDraft(
  equipment: ReturnType<typeof JSON.parse>,
  wires: ReturnType<typeof JSON.parse>,
  potentials: ReturnType<typeof JSON.parse>,
  seed: number | undefined,
  options: RobustnessOptions,
) {
  const returnVia = options.returnVia ?? "PLC1.M";

  const eq = structuredClone(equipment),
    w = structuredClone(wires),
    p = structuredClone(potentials);

  const uuid = (key: string) => {
    const h = createHash("sha256").update(`${seed}:${key}`).digest("hex");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
  };

  const device = (
    designation: string,
    type: string,
    uid = uuid(designation),
  ) => ({ uid, kind: "device", designation, type: `core:${type}` });

  const wire = (
    designation: string,
    a: string,
    b: string,
    uid = uuid(designation),
  ) => ({
    uid,
    kind: "wire",
    designation,
    endpoints: [a, b].map((v) => {
      const dot = v.indexOf(".");
      return { device: v.slice(0, dot), terminal: v.slice(dot + 1) };
    }),
  });
  return { returnVia, eq, w, p, uuid, device, wire };
}

export type RobustnessDraft = ReturnType<typeof createRobustnessDraft>;

export function applyRobustnessOptions(
  { eq, w, p, uuid }: RobustnessDraft,
  variant: RobustnessVariant,
  seed: number | undefined,
  options: RobustnessOptions,
) {
  if (variant === "minimal" || variant === "plant") {
    const plc = eq.objects.find(
      (o: { designation: string }) => o.designation === "PLC2",
    );
    if (options.plc2Location !== undefined) plc.location = options.plc2Location;
    if (options.plc2Designation !== undefined) {
      plc.designation = options.plc2Designation;
      for (const wire of w.objects)
        for (const ep of wire.endpoints)
          if (ep.device === "PLC2") ep.device = options.plc2Designation;
    }
  }

  if (options.noPotentials) p.objects = [];

  if (options.duplicatePotentials)
    p.objects.push(
      ...p.objects.map((o: { uid: string }, i: number) => ({
        ...o,
        uid: uuid(`duplicate-${o.uid}`),
        designation: `P-DUP-${i}`,
      })),
    );

  if (options.reverseAuthoredOrder)
    for (const source of [eq, w, p]) source.objects.reverse();

  if (seed !== undefined)
    for (const source of [eq, w, p])
      for (const o of source.objects)
        o.uid = uuid(o.designation ?? o.name ?? o.uid);
}
