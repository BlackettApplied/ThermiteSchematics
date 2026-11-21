import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { classifyToolCall } from "./github-call.mjs";
import { score } from "./score-log.mjs";
const cases = [
  "github-calls.json",
  "github-calls-r6.json",
  "local-commands-r7.json",
  "github-calls-r7.json",
  "github-calls-r8.json",
].flatMap((file) =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/${file}`, import.meta.url), "utf8"),
  ),
);
for (const fixture of cases)
  it(`classifies ${fixture.label}`, () => {
    const event = { id: "call", type: "tool", ...fixture.event };
    const options = {
      engineRoots: ["/engine"],
      allowedLibraryPaths: ["libraries/field-interfaces"],
    };
    expect(classifyToolCall(event, options).class).toBe(fixture.class);
    if (fixture.curlEquivalent)
      expect(classifyToolCall(event, options)).toEqual(
        classifyToolCall(
          { ...event, input: `curl '${fixture.curlEquivalent}'` },
          options,
        ),
      );
    // Exercise structured Claude arguments and the actual scorer, not only helpers.
    const result = score({
      ...options,
      transcript:
        event.server || event.tool
          ? [
              {
                type: "item.completed",
                item: {
                  type: "mcp_tool_call",
                  id: event.id,
                  server: event.server ?? event.name,
                  tool: event.tool ?? event.name,
                  arguments: event.input,
                },
              },
            ]
          : [
              {
                type: "assistant",
                message: { content: [{ ...event, type: "tool_use" }] },
              },
            ],
    });
    if (fixture.libraryAcquisitions !== undefined)
      expect(result.libraryAcquisitions).toHaveLength(
        fixture.libraryAcquisitions,
      );
    expect(result.sourceReads).toBe(Number(fixture.class === "source-read"));
    expect(result.issueLookups).toHaveLength(
      Number(fixture.class === "issue-lookup"),
    );
    expect(result.violations.filter((v) => v.rule === "V8")).toHaveLength(
      Number(fixture.class === "source-read"),
    );
  });
