import assert from "node:assert/strict";
import { cpus, totalmem, loadavg, platform, arch } from "node:os";
import { correctnessFailure } from "./errors.mjs";
export { startWorker } from "./worker-client.mjs";

export const workloads = { "machine-demo": 12, "conveyor-line": 4 };
export const operations = ["compile", "packet"];
export const sampleCounts = { compile: 21, packet: 5 };
export function machineClass() {
  return {
    platform: platform(),
    arch: arch(),
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    memoryBytes: totalmem(),
    bun: process.versions.bun,
  };
}
export function median(values) {
  assert(values.length > 0);
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}
export function comparison(base, head) {
  assert(Number.isFinite(base) && base > 0, "Invalid base median");
  assert(Number.isFinite(head) && head > 0, "Invalid head median");
  const ratio = head / base;
  return { baseMedianMs: base, headMedianMs: head, ratio, pass: ratio <= 1.2 };
}
export function measurementOrder(samples, extraSide, seed) {
  const opposite = (side) => (side === "base" ? "head" : "base");
  const order = [[extraSide, opposite(extraSide)]]; // excluded warmup
  let state = seed >>> 0;
  for (let i = 0; i < Math.floor(samples / 2); i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const first = state < 0x80000000 ? "base" : "head";
    order.push([first, opposite(first)], [opposite(first), first]);
  }
  if (samples % 2) order.push([extraSide, opposite(extraSide)]);
  return order;
}
function validateSide(observations, side, views) {
  const fail = (message) => {
    throw correctnessFailure(side, message);
  };
  if (observations.some((r) => r.views !== views))
    fail(`Expected ${views} views`);
  if (new Set(observations.map((r) => r.sha256)).size !== 1)
    fail("Nondeterministic output");
  if (new Set(observations.map((r) => r.inputSha256)).size !== 1)
    fail("Workload changed during measurement");
}
async function observationsFor(base, head, request, order) {
  const observations = { base: [], head: [] };
  for (const [round, sides] of order.entries()) {
    for (const side of sides) {
      const loadBefore = loadavg();
      const result = await (side === "base" ? base : head).sample(request);
      assert(
        Number.isFinite(result.ms) && result.ms > 0,
        "Invalid sample duration",
      );
      observations[side].push({
        ...result,
        warmup: round === 0,
        loadBefore,
        loadAfter: loadavg(),
      });
    }
  }
  return observations;
}
export async function measureRow(
  base,
  head,
  name,
  operation,
  { samples, seed, extraSide },
) {
  assert(Number.isInteger(samples) && samples >= 3 && samples <= 100);
  const order = measurementOrder(samples, extraSide, seed);
  const observations = await observationsFor(
    base,
    head,
    { name, operation },
    order,
  );
  for (const side of ["base", "head"])
    validateSide(observations[side], side, workloads[name]);
  if (observations.base[0].inputSha256 !== observations.head[0].inputSha256)
    throw correctnessFailure(
      "head",
      `${name}: workload differs from the PR base`,
    );
  return {
    seed,
    order,
    observations,
    ...comparison(
      median(observations.base.slice(1).map((r) => r.ms)),
      median(observations.head.slice(1).map((r) => r.ms)),
    ),
  };
}
async function confirmedRow(base, head, name, operation, settings) {
  const measurements = [
    await measureRow(base, head, name, operation, settings),
  ];
  if (!measurements[0].pass)
    measurements.push(
      await measureRow(base, head, name, operation, {
        ...settings,
        seed: (settings.seed + 1) >>> 0,
        extraSide: settings.extraSide === "base" ? "head" : "base",
      }),
    );
  const last = measurements.at(-1);
  return {
    name,
    operation,
    views: workloads[name],
    samples: settings.samples,
    warmup: 1,
    baseMedianMs: last.baseMedianMs,
    headMedianMs: last.headMedianMs,
    ratio: last.ratio,
    pass: measurements.some((m) => m.pass),
    measurements,
  };
}
export async function measurePair(
  base,
  head,
  { counts = sampleCounts, seed = 20261116 } = {},
) {
  const rows = [];
  for (const [index, name] of Object.keys(workloads).entries()) {
    for (const operation of operations)
      rows.push(
        await confirmedRow(base, head, name, operation, {
          samples: counts[operation],
          seed,
          // Odd counts need one extra first position. Opposite workloads balance
          // that position for each operation; confirmation reverses it as well.
          extraSide: (index + seed) % 2 ? "head" : "base",
        }),
      );
  }
  return {
    samples: counts,
    warmup: 1,
    seed,
    rows,
    pass: rows.every((r) => r.pass),
  };
}
