import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compileProject, lockProject } from "@thermite/compiler";
import { uid, wire, endpoint } from "./series-loop-fixture.js";
import type { SignalLoopViewRequest } from "../src/signal-loop.js";

const device = (n: number, designation: string, type: string) => ({
  kind: "device",
  uid: uid(n),
  designation,
  type,
});
async function libraryFixture(
  objects: unknown[],
  version: string,
  local: unknown[] = [],
  field = false,
) {
  const root = await mkdtemp(
    join(await realpath(tmpdir()), "thermite-series-library-"),
  );
  const dispose = () => rm(root, { recursive: true, force: true });
  try {
    const libraries: any[] = [{ name: "core", version }];
    if (local.length) {
      await mkdir(join(root, "local"));
      await writeFile(
        join(root, "local/library.json"),
        JSON.stringify({
          name: "local",
          version: "0.1.0",
          sources: ["types.json"],
        }),
      );
      await writeFile(
        join(root, "local/types.json"),
        JSON.stringify({ types: local }),
      );
      libraries.push({ name: "local", version: "0.1.0", path: "local" });
    }
    if (field)
      for (const name of ["field-interfaces", "industrial-pilot"]) {
        await cp(
          new URL(`../../../libraries/${name}/`, import.meta.url),
          join(root, name),
          { recursive: true },
        );
        libraries.push({ name, version: "0.1.0", path: name });
      }
    await writeFile(
      join(root, "system.json"),
      JSON.stringify({
        format: "electrical-system/0.1",
        project: { name: "Series loop library reproduction" },
        sources: ["source.json"],
        libraries,
      }),
    );
    await writeFile(join(root, "source.json"), JSON.stringify({ objects }));
    const l = await lockProject(root);
    if (!l.ok) throw Error(JSON.stringify(l.diagnostics));
    const c = await compileProject(root);
    if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
    return { root, ir: c.ir, dispose };
  } catch (e) {
    await dispose();
    throw e;
  }
}
const localTypes = [
  {
    kind: "device_type",
    id: "local:tx",
    symbol: "thermite:two-wire-transmitter",
    terminals: {
      "+": { role: "loop_positive", connection_policy: "shared" },
      "-": { role: "loop_negative", connection_policy: "shared" },
    },
    functions: { signal: { kind: "other", terminals: ["+", "-"] } },
  },
  {
    kind: "device_type",
    id: "local:ai",
    symbol: "thermite:io-module",
    terminals: {
      a: { role: "analog_input_positive", connection_policy: "shared" },
      b: { role: "analog_input_negative", connection_policy: "shared" },
    },
    functions: {
      ai: { kind: "channel", direction: "input", terminals: ["a", "b"] },
    },
  },
];
export const frozenRequest: SignalLoopViewRequest = {
  format: "signal-loop-view-request/0.1",
  from: { device: "TX1", function: "signal" },
  to: { device: "AI1", function: "ai" },
  loopPower: { device: "PS1", function: "dc_output" },
};
export function frozenSeriesFixture() {
  return libraryFixture(
    [
      device(1, "PS1", "core:psu-24vdc"),
      device(2, "TB1", "core:terminal-block-8"),
      device(3, "JB1", "core:junction-box-8"),
      device(4, "TX1", "local:tx"),
      device(5, "AI1", "local:ai"),
      wire(10, "PS1", "+", "TB1", "1"),
      wire(11, "TB1", "1", "TX1", "+"),
      wire(12, "TX1", "-", "TB1", "2"),
      wire(13, "TB1", "2", "AI1", "a"),
      wire(14, "AI1", "b", "JB1", "X1.1"),
      wire(15, "JB1", "X1.1", "PS1", "-"),
    ],
    "0.1.0",
    localTypes,
  );
}
export const fieldRequest: SignalLoopViewRequest = {
  format: "signal-loop-view-request/0.1",
  from: { device: "PT1", function: "signal" },
  to: { device: "AI1", function: "ch0" },
  loopPower: { device: "PS1", function: "dc_output" },
};
export function fieldSeriesFixture(high = true) {
  return libraryFixture(
    [
      device(1, "PT1", "field-interfaces:pressure-4-20ma-m12-p1-p2"),
      device(2, "XP1", "field-interfaces:m12-a4-bulkhead"),
      device(3, "XT1", "field-interfaces:terminal-strip-6"),
      device(4, "AI1", "industrial-pilot:siemens-ai4i-st-2wire"),
      device(5, "PS1", "core:psu-24vdc"),
      {
        kind: "cable",
        uid: uid(30),
        designation: "CB1",
        type: "field-interfaces:m12-a4-cordset",
        conductors: [
          {
            id: "A",
            usage: "in-use",
            endpoints: [endpoint("PT1", "1"), endpoint("XP1", "1")],
          },
          {
            id: "B",
            usage: "in-use",
            endpoints: [endpoint("PT1", "2"), endpoint("XP1", "2")],
          },
          {
            id: "C",
            usage: "spare",
            endpoints: [endpoint("PT1", "3"), endpoint("XP1", "3")],
          },
          {
            id: "D",
            usage: "spare",
            endpoints: [endpoint("PT1", "4"), endpoint("XP1", "4")],
          },
        ],
      },
      wire(10, "XP1", "1", "XT1", "1"),
      wire(11, "XP1", "2", "XT1", "2"),
      ...(high
        ? [
            wire(12, "XT1", "1", "AI1", "13"),
            wire(13, "XT1", "2", "PS1", "-"),
            wire(14, "AI1", "9", "PS1", "+"),
          ]
        : [
            wire(12, "XT1", "1", "PS1", "+"),
            wire(13, "XT1", "2", "AI1", "9"),
            wire(14, "AI1", "13", "XT1", "3"),
            wire(15, "XT1", "3", "PS1", "-"),
          ]),
    ],
    "0.2.0",
    [],
    true,
  );
}
