import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createInternalApplySourcePatchTool,
  defaultApplySourcePatchDependencies,
} from "../../dist/apply-source-patch.js";

const request = JSON.parse(await readFile(process.argv[2], "utf8"));
const mode = process.argv[3];
let hostCalls = 0;
let signalHandled;
const handled = new Promise((resolve) => {
  signalHandled = resolve;
});
const host = () => {
  hostCalls++;
  signalHandled();
};
if (mode === "before") process.on("SIGINT", host);
let heldDuringWrite;
const outcome = await createInternalApplySourcePatchTool(
  {},
  {
    ...defaultApplySourcePatchDependencies,
    async writeFileAtomically(path, bytes, options) {
      if (mode === "after-write") {
        heldDuringWrite = existsSync(
          join(request.project, ".thermite-schematics-write.lock"),
        );
        await defaultApplySourcePatchDependencies.writeFileAtomically(
          path,
          bytes,
          options,
        );
        process.on("SIGINT", host);
        process.kill(process.pid, "SIGINT");
        await handled;
        return;
      }
      if (mode === "after") process.on("SIGINT", host);
      process.kill(process.pid, "SIGINT");
      await handled;
      heldDuringWrite = existsSync(
        join(request.project, ".thermite-schematics-write.lock"),
      );
      await defaultApplySourcePatchDependencies.writeFileAtomically(
        path,
        bytes,
        options,
      );
    },
  },
).applySourcePatch(request);
process.removeListener("SIGINT", host);
process.stdout.write(
  `${JSON.stringify({ hostCalls, heldDuringWrite, outcome })}\n`,
);
