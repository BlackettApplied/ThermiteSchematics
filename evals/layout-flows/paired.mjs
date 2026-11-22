import assert from "node:assert/strict";
import { sha256, outcome } from "./results.mjs";

async function compiled(engine, project, cache) {
  let promise = cache.get(project);
  if (!promise) {
    promise = engine.compiler.compileProject(project);
    cache.set(project, promise);
  }
  const result = await promise;
  assert(result.ok, JSON.stringify(result.diagnostics));
  return result;
}
export async function renderPair(engines, project, request, caches) {
  const result = {};
  for (const side of ["before", "after"]) {
    const engine = engines[side],
      c = await compiled(engine, project, caches[side]),
      input = { ir: c.ir, request, presentation: c.presentation },
      inputSha256 = sha256(input),
      rendered = await engine.renderer.renderSchematicPacket(
        c.ir,
        request,
        c.presentation,
      );
    assert.equal(sha256(input), inputSha256, `${side} mutated input`);
    result[side] = { input, inputSha256, outcome: outcome(rendered) };
  }
  return result;
}
