import { expect, it, vi } from "vitest";
import { renderPair } from "./paired.mjs";

function engine(marker) {
  return {
    compiler: {
      compileProject: vi.fn(async () => ({
        ok: true,
        ir: { marker },
        presentation: { compiledBy: marker },
      })),
    },
    renderer: {
      renderSchematicPacket: vi.fn(async () => ({
        ok: true,
        value: { sheets: [{ number: 1, svg: marker }] },
      })),
    },
  };
}
it("compiles and renders each side with its own built engine and separate cache", async () => {
  const engines = { before: engine("base"), after: engine("head") },
    request = { views: [{ flow: "top-to-bottom" }] },
    caches = { before: new Map(), after: new Map() },
    pair = await renderPair(engines, "same/project", request, caches);
  for (const [side, marker] of [
    ["before", "base"],
    ["after", "head"],
  ]) {
    expect(
      engines[side].compiler.compileProject,
    ).toHaveBeenCalledExactlyOnceWith("same/project");
    expect(
      engines[side].renderer.renderSchematicPacket,
    ).toHaveBeenCalledExactlyOnceWith({ marker }, request, {
      compiledBy: marker,
    });
    expect(pair[side].input).toEqual({
      ir: { marker },
      request,
      presentation: { compiledBy: marker },
    });
  }
  expect(pair.before.inputSha256).not.toBe(pair.after.inputSha256);
  await renderPair(engines, "same/project", request, caches);
  expect(engines.before.compiler.compileProject).toHaveBeenCalledTimes(1);
  expect(engines.after.compiler.compileProject).toHaveBeenCalledTimes(1);
});
