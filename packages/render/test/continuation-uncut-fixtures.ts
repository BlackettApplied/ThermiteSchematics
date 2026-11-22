import { createHash } from "node:crypto";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import type { RenderedPacket, SchematicPacketRequest } from "../src/sheets.js";

// Bun 1.4.2 Linux x64 returns one-ULP differences from Math.hypot in the raw
// returnLocality.distanceMm metadata. Both Ubuntu jobs in run 43777116134
// agree. Each SVG and the other layout data match the shared reference.
// Keep the reviewed layout hashes for that platform.
export function uncutReferenceKey(
  name: "init-starter" | "motor-starter",
  platform = process.platform,
  arch = process.arch,
) {
  return name === "motor-starter" && platform === "linux" && arch === "x64"
    ? "motor-starter-linux-x64"
    : name;
}

/** Hash the layout bytes, including HTML markup, without the print font payload. */
export function uncutLayoutDigest(packet: RenderedPacket): string {
  const fontStyle = /<style data-thermite-font="[^"]+">[^<]*<\/style>/gu;
  if (packet.html.match(fontStyle)?.length !== 1)
    throw Error("Expected one packet HTML font block");
  const layout = { ...packet, html: packet.html.replace(fontStyle, "") };
  return createHash("sha256").update(JSON.stringify(layout)).digest("hex");
}

export async function uncutFixture(name: "init-starter" | "motor-starter") {
  const c = await compileProject(
    name === "init-starter"
      ? "packages/cli/templates/starter-default"
      : "examples/motor-starter",
  );
  if (!c.ok) throw Error(JSON.stringify(c));
  const root = (value: string) => ({ by: "designation" as const, value });
  const flow = "left-to-right" as const;
  const loads = {
    format: "schematic-view-request/0.2",
    root: root("PS1"),
    intent: { kind: "loads" },
    flow,
  } as const;
  const request: SchematicPacketRequest = {
    format: "schematic-packet-request/0.1",
    page: {
      size: "tabloid",
      orientation: "landscape",
      ...(name === "motor-starter" ? { marginMm: 10 } : {}),
    },
    ...(name === "init-starter" ? { layout: "compact" } : {}),
    views:
      name === "init-starter"
        ? [loads]
        : [
            {
              format: "schematic-view-request/0.1",
              root: root("M1"),
              family: "power",
              flow,
            },
            {
              format: "schematic-view-request/0.1",
              root: root("K1"),
              family: "control",
              flow,
            },
            loads,
            {
              format: "schematic-view-request/0.2",
              root: root("LS1"),
              intent: { kind: "trace", to: root("PLC1"), includePower: true },
              flow,
            },
            {
              format: "schematic-view-request/0.2",
              root: root("CBL1"),
              intent: { kind: "conductors" },
              flow,
            },
          ],
  };
  return { ir: c.ir, presentation: c.presentation, request };
}

/** Same authored-label mutations for the oracle and its explicit digest updater. */
export function uncutLabelVariant(
  source: ElectricalIr,
  crossed: ReadonlySet<string | undefined>,
  name: "init-starter" | "motor-starter",
  label: string,
) {
  const ir = structuredClone(source);
  const changed = ir.wires.filter(
    (w) =>
      !crossed.has(w.uid) &&
      (label !== "" ||
        name === "init-starter" ||
        w.designation === "W-PWR-001"),
  );
  for (const w of changed) w.properties = { ...w.properties, label };
  return { ir, changed };
}
