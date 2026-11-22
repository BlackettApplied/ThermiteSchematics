import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compileProject, lockProject } from "@thermite/compiler";
import { DOMParser } from "linkedom";
import { dolProbeFixture } from "./dol-control-probes-fixture.js";

export const flows = ["left-to-right", "top-to-bottom"] as const;
export const control = (flow: (typeof flows)[number] = "left-to-right") => ({
  format: "schematic-view-request/0.1" as const,
  root: { by: "designation" as const, value: "K1" },
  family: "control" as const,
  flow,
});
export const required = <T>(value: T | undefined | null): T => {
  if (value === undefined || value === null)
    throw Error("Missing fixture fact");
  return value;
};
export const parseSvg = (svg: string) =>
  new DOMParser().parseFromString(svg, "image/svg+xml");
export const cards = (svg: string) =>
  [...parseSvg(svg).querySelectorAll("[data-off-view-terminal]")].map((g) => ({
    terminal: g.getAttribute("data-off-view-terminal"),
    rows: [...g.querySelectorAll(".off-view-row")].map((t) => t.textContent),
  }));
const uid = (n: number) =>
  `84000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const end = (value: string) => {
  const dot = value.indexOf(".");
  return { device: value.slice(0, dot), terminal: value.slice(dot + 1) };
};

export async function offViewFixture(edit?: (objects: any[]) => void) {
  const root = await mkdtemp(join(tmpdir(), "thermite-off-view-"));
  const device = (n: number, designation: string, type: string) => ({
    kind: "device",
    uid: uid(n),
    designation,
    type: `core:${type}`,
  });
  const wire = (n: number, designation: string, a: string, b: string) => ({
    kind: "wire",
    uid: uid(n),
    designation,
    endpoints: [end(a), end(b)],
  });
  const objects: any[] = [
    device(1, "PS1", "psu-24vdc"),
    device(2, "K1", "contactor-3p-1no"),
    device(3, "H1", "pilot-light"),
    device(4, "TB1", "terminal-block-8"),
    wire(10, "W1", "PS1.+", "K1.A1"),
    wire(11, "W2", "K1.A2", "PS1.-"),
    wire(12, "W3", "PS1.+", "H1.X1"),
    wire(13, "W4", "PS1.-", "H1.X2"),
    wire(14, "W3b", "PS1.+", "H1.X1"),
    wire(15, "Wfar", "TB1.1", "TB1.8"),
    {
      kind: "jumper",
      uid: uid(20),
      designation: "JP1",
      endpoints: [end("PS1.-"), end("TB1.1")],
    },
    { kind: "jumper", uid: uid(21), endpoints: [end("PS1.-"), end("TB1.2")] },
    {
      kind: "cable",
      uid: uid(30),
      designation: "CBL1",
      type: "core:cordset-sensor-4core",
      conductors: [
        { id: "1", usage: "spare", endpoints: [end("PS1.+"), end("TB1.3")] },
        { id: "2", usage: "spare", endpoints: [end("PS1.-"), null] },
        { id: "3", usage: "spare", endpoints: [null, null] },
      ],
    },
  ];
  try {
    edit?.(objects);
    await writeFile(
      join(root, "system.json"),
      JSON.stringify({
        format: "electrical-system/0.1",
        project: { name: "Off-view synthetic" },
        sources: ["source.json"],
        libraries: [{ name: "core", version: "0.2.0" }],
      }),
    );
    await writeFile(join(root, "source.json"), JSON.stringify({ objects }));
    const locked = await lockProject(root);
    if (!locked.ok) throw Error(JSON.stringify(locked.diagnostics));
    const result = await compileProject(root);
    if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
    return {
      ...result,
      root,
      dispose: () => rm(root, { recursive: true, force: true }),
    };
  } catch (e) {
    await rm(root, { recursive: true, force: true });
    throw e;
  }
}

export async function p6Fixture() {
  return dolProbeFixture("p6");
}

export function foldedControlFixture(count = 24) {
  return offViewFixture((objects) => {
    required(objects.find((o) => o.designation === "W1")).endpoints[1] =
      end("S1.11");
    for (let n = 1; n <= count; n++) {
      objects.push({
        kind: "device",
        uid: uid(100 + n),
        designation: `S${n}`,
        type: "core:pushbutton-nc",
      });
      objects.push({
        kind: "wire",
        uid: uid(200 + n),
        designation: `WS${n}`,
        endpoints: [
          end(`S${n}.12`),
          end(n === count ? "K1.A1" : `S${n + 1}.11`),
        ],
      });
    }
  });
}
