import { compileProject } from "@thermite/compiler";
import { expect, it } from "vitest";
import {
  checkSeeds,
  flows,
  rootedRequests,
} from "./semantic-ordering-fixture.js";

export function checkMachineOrdering(flow: (typeof flows)[number]) {
  it(`shipped machine-demo rooted views have one ELK input sequence and SVG over 30 internal UID assignments (${flow})`, async () => {
    const compiled = await compileProject("examples/machine-demo");
    if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
    const requests = rootedRequests(compiled.ir);
    expect(requests.length).toBeGreaterThan(0);
    await checkSeeds("machine-demo", compiled.ir, requests, [flow]);
  }, 600000);
}
