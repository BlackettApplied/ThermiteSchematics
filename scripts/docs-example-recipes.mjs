// These are executable bindings, not labels for similar tests. Every recipe
// receives the current Markdown body and runs/consumes it in a temporary tree.
const run = (name) =>
  Object.assign(
    async (context, fence) => {
      const runner = await import("./docs-example-runner.mjs");
      return runner[name](context, fence);
    },
    {
      testName: (file, recipe) =>
        `executes Markdown fences in ${file} [${recipe}]`,
    },
  );
export const recipes = {
  "cabinets-shell": run("cabinetsShell"),
  "repo-shell": run("repoShell"),
  "runtime-shell": run("runtimeShell"),
  "workspace-shell": run("workspaceShell"),
  "sdk-example": run("sdkExample"),
  "signoff-shell": run("signoffShell"),
  "agent-workflow": run("agentWorkflow"),
  "json-project": run("jsonProject"),
  "json-packet": run("jsonPacket"),
  "json-source": run("jsonSource"),
};
