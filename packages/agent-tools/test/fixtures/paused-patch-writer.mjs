import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";

import {
  createInternalApplySourcePatchTool,
  defaultApplySourcePatchDependencies,
} from "../../dist/apply-source-patch.js";

// Hold the first process precisely between its last guard and replacement.
const input = createInterface({ input: process.stdin });
const resume = new Promise((resolve) => input.once("line", resolve));
const request = JSON.parse(await readFile(process.argv[2], "utf8"));
const outcome = await createInternalApplySourcePatchTool(
  {},
  {
    ...defaultApplySourcePatchDependencies,
    async writeFileAtomically(path, bytes, options) {
      process.stdout.write("ready\n");
      await resume;
      await defaultApplySourcePatchDependencies.writeFileAtomically(
        path,
        bytes,
        options,
      );
    },
  },
).applySourcePatch(request);
process.stdout.write(`${JSON.stringify(outcome)}\n`);
input.close();
process.exitCode = outcome.ok ? 0 : outcome.failureClass === "expected" ? 1 : 2;
