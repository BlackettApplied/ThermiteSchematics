import { mkdir, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileProject, lockProject } from "@thermite/compiler";
import type { SignalLoopViewRequest } from "../src/signal-loop.js";

export const seriesRequest = {
  format: "signal-loop-view-request/0.1",
  from: { device: "TX1", function: "signal" },
  to: { device: "AI1", function: "input" },
  loopPower: { device: "PS1", function: "output" },
} as const;

export const uid = (n: number) =>
  `74000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const endpoint = (device: string, terminal: string) => ({
  device,
  terminal,
});
export const wire = (
  n: number,
  a: string,
  at: string,
  b: string,
  bt: string,
) => ({
  kind: "wire",
  uid: uid(n),
  designation: `W${n}`,
  endpoints: [endpoint(a, at), endpoint(b, bt)],
});
const terminals = (roles: Record<string, string | undefined>) =>
  Object.fromEntries(
    Object.entries(roles).map(([key, role]) => [
      key,
      { ...(role === undefined ? {} : { role }), connection_policy: "shared" },
    ]),
  );

export function seriesModel(highSide = false) {
  const types: any[] = [
    {
      kind: "device_type",
      id: "series:ps",
      symbol: "thermite:dc-supply",
      terminals: terminals({ p: "dc_positive_output", n: "dc_return_output" }),
      functions: { output: { kind: "source", terminals: ["p", "n"] } },
    },
    {
      kind: "device_type",
      id: "series:tx",
      symbol: "thermite:two-wire-transmitter",
      terminals: terminals({
        p: "loop_positive",
        n: "loop_negative",
        spare: undefined,
      }),
      functions: { signal: { kind: "other", terminals: ["p", "n"] } },
    },
    {
      kind: "device_type",
      id: "series:ai",
      symbol: "thermite:io-module",
      terminals: terminals({
        p: "analog_input_0_positive",
        n: "analog_input_0_negative",
        spare: undefined,
      }),
      functions: {
        input: { kind: "channel", direction: "input", terminals: ["p", "n"] },
      },
    },
    {
      kind: "device_type",
      id: "series:strip",
      symbol: "thermite:terminal-strip",
      terminals: terminals(
        Object.fromEntries(
          Array.from({ length: 8 }, (_, i) => [String(i + 1), undefined]),
        ),
      ),
      functions: {},
    },
    {
      kind: "device_type",
      id: "series:load",
      symbol: "thermite:dc-load",
      terminals: terminals({ p: undefined, n: undefined }),
      functions: { supply: { kind: "load", terminals: ["p", "n"] } },
    },
  ];
  const objects: any[] = [
    ...[
      ["PS1", "ps"],
      ["TX1", "tx"],
      ["AI1", "ai"],
      ["TB1", "strip"],
      ["PLC1", "load"],
    ].map(([designation, type], i) => ({
      kind: "device",
      uid: uid(i + 1),
      designation,
      type: `series:${type}`,
    })),
    ...(highSide
      ? [
          wire(10, "PS1", "p", "AI1", "p"),
          wire(11, "AI1", "n", "TX1", "p"),
          wire(12, "TX1", "n", "PS1", "n"),
        ]
      : [
          wire(10, "PS1", "p", "TX1", "p"),
          wire(11, "TX1", "n", "AI1", "p"),
          wire(12, "AI1", "n", "PS1", "n"),
        ]),
  ];
  return { types, objects };
}
export type SeriesModel = ReturnType<typeof seriesModel>;

/** Each visit uses a separate contact, so revisiting a device is not a wire cycle. */
export function withFieldChains(
  model: SeriesModel,
  a: readonly string[],
  b = a,
) {
  const names = [...new Set([...a, ...b])];
  names.forEach((designation, i) => {
    if (
      !model.objects.some(
        (o) => o.kind === "device" && o.designation === designation,
      )
    )
      model.objects.push({
        kind: "device",
        uid: uid(40 + i),
        designation,
        type: "series:strip",
      });
  });
  model.objects = model.objects.filter(
    (o) => ![uid(10), uid(11)].includes(o.uid),
  );
  let serial = 100;
  for (const [chain, pin, target, targetPin] of [
    [a, "p", "PS1", "p"],
    [b, "n", "AI1", "p"],
  ] as const) {
    const visits = new Map<string, number>();
    let previous = { device: "TX1", terminal: pin as string };
    for (const name of chain) {
      const visit = visits.get(name) ?? 0;
      visits.set(name, visit + 1);
      const terminal = String(visit * 2 + (pin === "p" ? 1 : 2));
      model.objects.push(
        wire(serial++, previous.device, previous.terminal, name, terminal),
      );
      previous = { device: name, terminal };
    }
    model.objects.push(
      wire(serial++, previous.device, previous.terminal, target, targetPin),
    );
  }
}

/** Two field legs share a feed-through stage; the third remains a separate net. */
export function withFeedThroughs(model: SeriesModel) {
  model.objects = model.objects.filter(
    (o) => ![uid(10), uid(11)].includes(o.uid),
  );
  model.objects.push(
    wire(10, "PS1", "p", "TB1", "1"),
    wire(11, "AI1", "p", "TB1", "2"),
    wire(13, "TB1", "1", "TX1", "p"),
    wire(14, "TB1", "2", "TX1", "n"),
  );
}

export function withCable(model: SeriesModel) {
  withFeedThroughs(model);
  model.objects = model.objects.filter(
    (o) => ![uid(13), uid(14)].includes(o.uid),
  );
  model.types.push({
    kind: "cable_type",
    id: "series:cable",
    conductors: [
      { id: "A", color: "red" },
      { id: "B", color: "black" },
      { id: "C", color: "white" },
    ],
  });
  model.objects.push({
    kind: "cable",
    uid: uid(30),
    designation: "CB1",
    type: "series:cable",
    conductors: [
      {
        id: "A",
        usage: "in-use",
        endpoints: [endpoint("TX1", "p"), endpoint("TB1", "1")],
      },
      {
        id: "B",
        usage: "in-use",
        endpoints: [endpoint("TX1", "n"), endpoint("TB1", "2")],
      },
      {
        id: "C",
        usage: "spare",
        endpoints: [endpoint("TX1", "spare"), endpoint("TB1", "3")],
      },
    ],
  });
}

export async function seriesFixture(
  edit?: (m: SeriesModel) => void | Promise<void>,
  highSide = false,
) {
  const root = await mkdtemp(join(tmpdir(), "thermite-series-"));
  const dispose = () => rm(root, { recursive: true, force: true });
  try {
    const model = seriesModel(highSide);
    await edit?.(model);
    await mkdir(join(root, "library"));
    const files = {
      "system.json": {
        format: "electrical-system/0.1",
        project: { name: "Synthetic series loop" },
        sources: ["source.json"],
        libraries: [{ name: "series", version: "0.1.0", path: "library" }],
      },
      "library/library.json": {
        name: "series",
        version: "0.1.0",
        sources: ["types.json"],
      },
      "library/types.json": { types: model.types },
      "source.json": { objects: model.objects },
    };
    for (const [path, value] of Object.entries(files))
      await writeFile(join(root, path), JSON.stringify(value));
    const locked = await lockProject(root);
    if (!locked.ok) throw Error(JSON.stringify(locked.diagnostics));
    const compiled = await compileProject(root);
    if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
    return { ir: compiled.ir, root, dispose };
  } catch (e) {
    await dispose();
    throw e;
  }
}

export async function coreSupply(
  model: SeriesModel,
  version: "0.1.0" | "0.2.0",
) {
  const path = version === "0.1.0" ? "library" : `versions/${version}`;
  const data = JSON.parse(
    await readFile(
      new URL(
        `../../core-library/${path}/types/psu-24vdc.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  );
  model.types[0] = { ...data.types[0], id: "series:ps" };
  for (const object of model.objects)
    for (const end of object.endpoints ?? [])
      if (end.device === "PS1") end.terminal = end.terminal === "p" ? "+" : "-";
}

export function request(
  extra: Record<string, unknown> = {},
): SignalLoopViewRequest {
  return { ...seriesRequest, ...extra } as SignalLoopViewRequest;
}
