import { it, expect } from "vitest";
import { score } from "./score-log.mjs";
const url =
  "https://api.github.com/repos/BlackettApplied/ThermiteSchematics/contents/libraries/field-interfaces";
function metric(command, allowed = true) {
  return score({
    engineRoots: ["/engine"],
    allowedLibraryPaths: allowed ? ["libraries/field-interfaces"] : [],
    transcript: [
      {
        type: "item.completed",
        item: {
          id: "x",
          type: "command_execution",
          command,
          exit_code: 0,
          status: "completed",
        },
      },
    ],
  });
}
it("separates an allowed acquisition from local JSON response processing", () => {
  const cmd = `curl '${url}' -o /tmp/library.json && bun -e 'const d=await Bun.file("/tmp/library.json").json(); console.log(JSON.stringify(d.map(x=>({name:x.name,path:x.path}))))'`;
  expect(metric(cmd).sourceReads).toBe(0);
  expect(metric(cmd).libraryAcquisitions).toHaveLength(1);
  expect(metric(cmd, false).sourceReads).toBe(1);
  const issue = cmd.replace(
    url,
    "https://api.github.com/repos/BlackettApplied/ThermiteSchematics/issues",
  );
  expect(metric(issue).sourceReads).toBe(0);
  expect(metric(issue).issueLookups).toHaveLength(1);
});
it("still flags implementation reads in the remainder and non-GET fetches", () => {
  for (const tail of [
    "cat /engine/packages/query/src/ordering.ts",
    "bun -e 'console.log(await Bun.file(\"/engine/source.ts\").text())'",
    "curl https://raw.githubusercontent.com/BlackettApplied/ThermiteSchematics/dev/packages/render/src/index.ts",
    "gh search code repo:BlackettApplied/ThermiteSchematics",
  ])
    expect(
      metric(`curl '${url}' -o /tmp/lib && ${tail}`).sourceReads,
      tail,
    ).toBe(1);
  expect(metric(`curl -X POST '${url}'`).sourceReads).toBe(1);
  expect(metric(`curl --config /tmp/config '${url}'`).sourceReads).toBe(1);
});
