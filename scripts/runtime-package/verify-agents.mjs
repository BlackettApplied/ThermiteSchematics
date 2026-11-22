import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { json } from "./common.mjs";

function createAgentInvoker(project, invoke) {
  const agent = (tool, fields = {}, expected = 0) => {
    const request = { format: "agent-tool-request/0.1", project, ...fields };
    const result = invoke(
      ["agent", tool, "--input", "-"],
      json(request),
      expected,
    );
    assert.equal(JSON.parse(result.stderr).format, "agent-tool-report/0.1");
    if (expected !== 0) {
      assert.equal(result.stdout, "");
      return;
    }
    const value = JSON.parse(result.stdout);
    assert.equal(value.format, "agent-tool-result/0.1");
    return value.value;
  };
  return agent;
}

function sourcePatch(original, source) {
  const patch = {
    patchFormat: "json-patch/0.1",
    files: [
      {
        path: "devices/equipment.json",
        expectedIntegrity: `sha256-${createHash("sha256").update(original).digest("base64")}`,
        operations: [
          {
            op: "test",
            path: "/objects/0/description",
            value: source.objects[0].description,
          },
          {
            op: "replace",
            path: "/objects/0/description",
            value: "Package acceptance description",
          },
        ],
      },
    ],
  };
  return patch;
}

async function verifyPatchWorkflow({ project, agent, check }) {
  const sourcePath = join(project, "devices/equipment.json");
  const original = await readFile(sourcePath);
  const source = JSON.parse(original.toString());
  const patch = sourcePatch(original, source);
  agent("apply-source-patch", { ...patch, dryRun: true });
  assert.deepEqual(await readFile(sourcePath), original);
  agent("apply-source-patch", { ...patch, dryRun: false });
  const changed = await readFile(sourcePath);
  assert.equal(
    JSON.parse(changed.toString()).objects[0].description,
    "Package acceptance description",
  );
  agent("apply-source-patch", { ...patch, dryRun: false }, 1);
  assert.deepEqual(await readFile(sourcePath), changed);
  assert.equal(agent("validate").valid, true);
  check(
    "all six agent commands, split streams, dry-run/apply, stale integrity refusal",
  );
}

export async function verifyAgentCommands(context) {
  const { project, invoke } = context;
  const agent = createAgentInvoker(project, invoke);
  assert.equal(agent("validate").valid, true);
  agent("resolve", { target: { by: "designation", value: "PS1" } });
  agent("inspect", { selector: { by: "designation", value: "PS1" } });
  agent("query", {
    query: {
      operation: "net",
      selector: { by: "parts", deviceDesignation: "PS1", terminalKey: "+" },
    },
  });
  agent("create-view", {
    spec: {
      format: "schematic-view-request/0.2",
      root: { by: "designation", value: "PS1" },
      intent: { kind: "loads" },
      flow: "left-to-right",
    },
  });
  agent(
    "resolve",
    { target: { by: "designation", value: "DOES-NOT-EXIST" } },
    1,
  );
  await verifyPatchWorkflow({ ...context, agent });
}
