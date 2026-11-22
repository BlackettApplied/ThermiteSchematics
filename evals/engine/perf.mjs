import assert from "node:assert/strict";
import { join } from "node:path";
import {
  compileProject,
  renderSchematicPacket,
  engineRoot,
} from "./engine.mjs";
import { synthetic } from "./generate.mjs";
import { temporary, sha256, readJson, probe } from "./support.mjs";
import { inventoryPacket, conveyorPacket } from "./packets.mjs";
export function median(values) {
  const sorted = [...values].sort((a, b) => a - b),
    middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}
async function benchmark(project, packet, samples) {
  const compiles = [],
    renders = [],
    compileHashes = [],
    packetHashes = [];
  let compiled, rendered;
  // Separate loops: each operation has one warmup; renderer uses the final
  // precompiled IR. Generation, locking and JSON hashing are never timed.
  for (let i = 0; i <= samples; i++) {
    const start = performance.now();
    compiled = await compileProject(project);
    const elapsed = performance.now() - start;
    assert(compiled.ok, JSON.stringify(compiled.diagnostics));
    compileHashes.push(sha256(JSON.stringify(compiled)));
    if (i) compiles.push(elapsed);
  }
  for (let i = 0; i <= samples; i++) {
    const start = performance.now();
    rendered = await renderSchematicPacket(
      compiled.ir,
      packet,
      compiled.presentation,
    );
    const elapsed = performance.now() - start;
    assert(rendered.ok, JSON.stringify(rendered.error));
    packetHashes.push(sha256(JSON.stringify(rendered)));
    if (i) renders.push(elapsed);
  }
  assert.equal(
    new Set(compileHashes).size,
    1,
    "Compile bytes vary across identical runs",
  );
  assert.equal(
    new Set(packetHashes).size,
    1,
    "Packet bytes vary across identical runs",
  );
  return {
    samples,
    warmup: 1,
    compileMedianMs: median(compiles),
    packetMedianMs: median(renders),
    compileMs: compiles,
    packetMs: renders,
    sheets: rendered.value.sheets.length,
    compileSha256: compileHashes[0],
    packetSha256: packetHashes[0],
    rendered,
    compiled,
  };
}
export async function perf(samples = 5) {
  assert(Number.isInteger(samples) && samples > 0 && samples <= 100);
  const rows = [];
  rows.push(
    await probe("perf/synthetic-inventory", () =>
      temporary(async (project) => {
        await synthetic(project);
        const { rendered, compiled, ...metrics } = await benchmark(
          project,
          inventoryPacket,
          samples,
        );
        const ids = rendered.value.sheets.flatMap((sheet) =>
          [...sheet.svg.matchAll(/data-report-row="([^"]+)"/g)].map(
            (m) => m[1],
          ),
        );
        assert.equal(ids.length, 1500);
        assert.equal(new Set(ids).size, 1500);
        assert.deepEqual(
          [...ids].sort(),
          compiled.ir.wires.map((w) => w.uid).sort(),
        );
        return {
          ...metrics,
          devices: 300,
          wires: 1500,
          inventoryRows: ids.length,
          scope:
            "Complete wire-inventory schedule, not a whole-project schematic; timings informational",
        };
      }, null),
    ),
  );
  for (const [name, packet] of [
    [
      "machine-demo",
      await readJson(
        join(engineRoot, "examples/machine-demo/packet.request.json"),
      ),
    ],
    ["conveyor-line", conveyorPacket],
  ])
    rows.push(
      await probe(`perf/${name}`, async () => {
        if (name === "machine-demo") assert.equal(packet.views.length, 12);
        const { rendered, compiled, ...metrics } = await benchmark(
          join(engineRoot, "examples", name),
          packet,
          samples,
        );
        return {
          ...metrics,
          views: packet.views.length,
          scope:
            "EA authored schematic packet; 400 ms gate reported, never enforced by timing",
          referenceGateMs: 400,
          informationalGate: {
            compile: metrics.compileMedianMs <= 400,
            packet: metrics.packetMedianMs <= 400,
          },
        };
      }),
    );
  return rows;
}
