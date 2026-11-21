// Real CLI dispatcher in a separate process. Only snapshot/reservation seams
// are instrumented; reads, writes, reservation results and guards stay real.
import { publicPackage, patchEngine } from "./engine.mjs";
const { runCli } = await publicPackage("cli");
const { createAgentTools } = await publicPackage("agent-tools");
const {
  createInternalApplySourcePatchTool,
  defaultApplySourcePatchDependencies,
  captureProjectControlledSnapshot,
  reserveProjectWrite,
} = await patchEngine();
function signal(name) {
  return new Promise((resolve) => {
    const listener = (message) => {
      if (message === name) {
        process.off("message", listener);
        resolve();
      }
    };
    process.on("message", listener);
  });
}
function send(message) {
  if (process.connected) process.send(message, () => {});
}
const start = signal("start");
send("ready");
await start;
let captures = 0;
const patch = createInternalApplySourcePatchTool(
  {},
  {
    ...defaultApplySourcePatchDependencies,
    ...(reserveProjectWrite && {
      reserveProjectWrite(project) {
        send("reserving");
        const reservation = reserveProjectWrite(project);
        send(reservation.ok ? "reserved" : "contended");
        return reservation;
      },
    }),
    async captureSnapshot(project) {
      const result = await captureProjectControlledSnapshot(
        project,
        defaultApplySourcePatchDependencies.filesystem,
      );
      if (++captures === 2) {
        const release = signal("release");
        send("barrier");
        await release;
      }
      return result;
    },
  },
);
process.exitCode = await runCli(
  [
    process.execPath,
    "thermite",
    "agent",
    "apply-source-patch",
    "--input",
    process.argv[2],
  ],
  {
    agentCreateTools: (options) => ({
      ...createAgentTools(options),
      applySourcePatch: patch.applySourcePatch,
    }),
  },
);
if (process.connected) process.disconnect();
