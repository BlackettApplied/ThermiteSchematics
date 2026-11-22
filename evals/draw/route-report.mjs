import assert from "node:assert/strict";
import { readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  launch,
  displaySheet,
  sheetMeasurementSource,
  drawingContextOptions,
} from "./browser.mjs";
import { conductorLengths } from "./conductor-lengths.mjs";
import { readCheckpointCaseFiles } from "./case-files.mjs";
const { values } = parseArgs({
  options: {
    current: { type: "string" },
    reference: { type: "string" },
    output: { type: "string" },
  },
});
assert(
  values.current && values.reference && values.output,
  "Use --current <checkpoint> --reference <checkpoint> --output <json>",
);
const browser = await launch(),
  context = await browser.newContext(drawingContextOptions),
  page = await context.newPage();
const current = resolve(values.current),
  reference = resolve(values.reference),
  cases = [];
async function capture(read, id, packet, prior) {
  const ir = JSON.parse(await read(id, "ir.json")),
    gs = [];
  for (const s of packet.sheets) {
    await displaySheet(
      page,
      (
        await read(id, `sheet-${String(s.number).padStart(3, "0")}.svg`)
      ).toString(),
    );
    gs.push(
      await page.evaluate(
        (source) => (0, eval)(`(${source})`)({ routesOnly: true }),
        sheetMeasurementSource(),
      ),
    );
  }
  return conductorLengths(packet, gs, ir, prior?.conductors);
}
try {
  const [readCurrent, readReference] = await Promise.all([
    readCheckpointCaseFiles(current),
    readCheckpointCaseFiles(reference),
  ]);
  for (const entry of await readdir(current, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    let packet;
    try {
      packet = JSON.parse(await readCurrent(entry.name, "packet.json"));
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    const referencePacket = JSON.parse(
        await readReference(entry.name, "packet.json"),
      ),
      base = await capture(readReference, entry.name, referencePacket),
      target = await capture(readCurrent, entry.name, packet, base);
    cases.push({ case: entry.name, reference: base, current: target });
    process.stdout.write(
      `${entry.name}: ${target.conductors.length} conductors\n`,
    );
  }
  await writeFile(
    values.output,
    JSON.stringify(
      { format: "thermite-route-comparison/1", reportOnly: true, cases },
      null,
      2,
    ) + "\n",
  );
} finally {
  await context.close();
  await browser.close();
}
