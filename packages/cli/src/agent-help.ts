import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  AGENT_REQUEST_VOCABULARY,
  type AgentToolName,
} from "@thermite/agent-tools";

/** Requests run unchanged in a freshly initialized default starter. */
export function agentHelp(tool: AgentToolName): string {
  const base = { format: "agent-tool-request/0.1", project: "." };
  const selector = { by: "designation", value: "PS1" };
  let minimal: object;
  let complete: object;
  switch (tool) {
    case "validate":
      minimal = complete = base;
      break;
    case "resolve":
      minimal = { ...base, target: selector };
      complete = { ...minimal, include: ["source"] };
      break;
    case "inspect":
      minimal = { ...base, selector };
      complete = { ...minimal, include: ["source"] };
      break;
    case "query":
      minimal = complete = {
        ...base,
        query: {
          operation: "net",
          selector: { by: "parts", deviceDesignation: "PS1", terminalKey: "+" },
        },
      };
      break;
    case "create-view": {
      const spec = {
        format: "schematic-view-request/0.2",
        root: selector,
        intent: { kind: "loads" },
      };
      minimal = { ...base, spec };
      complete = { ...base, spec: { ...spec, flow: "left-to-right" } };
      break;
    }
    case "apply-source-patch": {
      const bytes = readFileSync(
        new URL(
          "../templates/starter-default/devices/equipment.json",
          import.meta.url,
        ),
      );
      const starter = JSON.parse(bytes.toString("utf8"));
      minimal = complete = {
        ...base,
        patchFormat: "json-patch/0.1",
        dryRun: true,
        files: [
          {
            path: "devices/equipment.json",
            expectedIntegrity: `sha256-${createHash("sha256").update(bytes).digest("base64")}`,
            operations: [
              {
                op: "test",
                path: "/objects/0/uid",
                value: starter.objects[0].uid,
              },
            ],
          },
        ],
      };
      break;
    }
  }
  const block = (value: object) =>
    `\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n`;
  return `\nRun these requests from a fresh default starter project (thermite init <new-directory>).\nSave a JSON block as request.json and run: thermite agent ${tool} --input request.json\nOr send it on stdin: thermite agent ${tool} --input -\n${tool === "query" ? "Operation and selector are nested under query; resolve.target and inspect.selector are top-level. The flat query form is not accepted.\n" : ""}${tool === "apply-source-patch" ? 'This dry-run tests the starter UUID without editing. On an existing project, inspect with include: ["source"] and rebuild the guard and UUID test from that snapshot (thermite guide agent-requests).\n' : ""}Complete request:${block(complete)}${minimal !== complete ? `Minimal request (optional fields omitted):${block(minimal)}` : "This request is also minimal.\n"}\nAccepted literals (JSON):\n${JSON.stringify(AGENT_REQUEST_VOCABULARY[tool], null, 2)}\n`;
}
