import { expect, vi } from "vitest";
import { compileProject } from "@thermite/compiler";
import { readFile } from "node:fs/promises";
import { renderSchematicPacket } from "../../src/sheets.js";
import * as placement from "../../src/circuit/caption-placement.js";
import * as loops from "../../src/circuit/separate-loops.js";
import { required } from "../fixtures.js";
export async function captionHostFixture() {
  const dir = "libraries/siemens-pilot/examples/6es7132-4bb31-0aa0",
    c = await compileProject(dir);
  expect(c.ok).toBe(true);
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  const request = JSON.parse(
    await readFile(`${dir}/packet.request.json`, "utf8"),
  );
  for (const view of request.views) view.flow = "top-to-bottom";
  return renderSchematicPacket(c.ir, request);
}
export async function captionHostWitness(useNative = false) {
  const separation = useNative
    ? vi.spyOn(loops, "separateCoincidentLoops").mockReturnValue(undefined)
    : undefined;
  const original = placement.circuitCaptionPlacement;
  let witness: Parameters<typeof original> | undefined;
  const spy = vi
    .spyOn(placement, "circuitCaptionPlacement")
    .mockImplementation((...args) => {
      if (args[0] === "FIXED4" && args[3].group.id === "g2") witness ??= args;
      return original(...args);
    });
  try {
    const rendered = await captionHostFixture();
    expect(rendered.ok).toBe(true);
  } finally {
    spy.mockRestore();
    separation?.mockRestore();
  }
  return required(witness);
}
