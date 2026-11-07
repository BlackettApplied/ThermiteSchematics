import { expect, it } from "vitest";
import { runAgentCommand } from "../src/agent-command.js";
import {
  expectExplained,
  fault,
} from "../../agent-tools/test/failure-explanation-fixture.js";

const tools = [
  "resolve",
  "inspect",
  "query",
  "validate",
  "create-view",
  "apply-source-patch",
] as const;
it.each(tools)(
  "%s explains unreadable requests and dispatch exceptions",
  async (tool) => {
    const unreadable = await runAgentCommand(tool, "not-present.request.json");
    expect(unreadable.exitCode).toBe(2);
    expect(unreadable.stdout).toBe("");
    expectExplained({ ok: false, ...JSON.parse(unreadable.stderr) });
    const fail = async () => {
      throw fault();
    };
    const result = await runAgentCommand(tool, "-", {
      stdin: {
        async *[Symbol.asyncIterator]() {
          yield '{"format":"agent-tool-request/0.1","project":"."}';
        },
      },
      createTools: () => ({
        resolve: fail,
        inspect: fail,
        query: fail,
        validate: fail,
        createView: fail,
        applySourcePatch: fail,
      }),
    });
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expectExplained({ ok: false, ...JSON.parse(result.stderr) });
  },
);
