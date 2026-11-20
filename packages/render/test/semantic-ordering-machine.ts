import { compileProject } from "@thermite/compiler";
import { expect, it } from "vitest";
import {
  checkSeeds,
  flows,
  rootedRequests,
} from "./semantic-ordering-fixture.js";

export function checkMachineOrdering(flow: (typeof flows)[number]) {
  let project: ReturnType<typeof compileProject> | undefined;
  it.each([0, 10, 20])(
    `shipped machine-demo rooted views have one ELK input sequence and SVG (${flow}, seed block starting at %i)`,
    async (first) => {
      const compiled = await (project ??= compileProject(
        "examples/machine-demo",
      ));
      if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
      const requests = rootedRequests(compiled.ir);
      expect(requests.length).toBeGreaterThan(0);
      const seeds = Array.from({ length: 10 }, (_, offset) => first + offset);
      if (first !== 0) seeds.unshift(0);
      await checkSeeds("machine-demo", compiled.ir, requests, [flow], seeds);
    },
    600000,
  );
}
