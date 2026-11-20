import { expect, it } from "vitest";
import { exampleFindings } from "../../../scripts/docs-examples-lib.mjs";
import { corpus, registerDocsExampleTests } from "./docs-examples-fixture.js";

it("has a fresh, exhaustive runnable-example inventory and real test bindings", async () => {
  expect(await exampleFindings(corpus)).toEqual([]);
});

registerDocsExampleTests("other");
