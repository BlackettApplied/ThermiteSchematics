import { describe, expect, it } from "vitest";
import { classifyToolCall } from "./github-call.mjs";
import { score } from "./score-log.mjs";

const repository = "BlackettApplied/ThermiteSchematics";
const ref = "d58b6d6357e4b3107d4938d80c3bcbdc20f3988d";
const raw = `https://raw.githubusercontent.com/${repository}/${ref}`;
const allowedLibraryPaths = [
  "libraries/field-interfaces",
  "libraries/industrial-pilot",
];
const library = `${raw}/libraries/field-interfaces/library.json`;
const engine = `${raw}/packages/cli/src/alpha.ts`;
const acquisition = { class: "other", libraryAcquisition: true };
const classify = (command, name = "command_execution") =>
  classifyToolCall({ name, input: { command } }, { allowedLibraryPaths });

describe("C2 T07 attempt 002 literal acquisitions", () => {
  it.each([
    [
      "Codex item_21",
      `/bin/zsh -lc "gh api 'repos/${repository}/contents/libraries/field-interfaces/library.json?ref=${ref}' > drawings/audit/field-interfaces-fetch.json 2> drawings/audit/field-interfaces-fetch.stderr.txt"`,
    ],
    [
      "Codex item_24",
      `/bin/zsh -lc 'curl -fsSL -o libraries/field-interfaces/library.json ${library} 2> drawings/audit/field-interfaces-curl.stderr.txt'`,
    ],
    [
      "Codex item_25",
      `/bin/zsh -lc 'curl -fsSL -o libraries/industrial-pilot/library.json ${raw}/libraries/industrial-pilot/library.json 2> drawings/audit/industrial-pilot-curl.stderr.txt'`,
    ],
  ])("%s", (_id, command) => {
    expect(classify(command)).toEqual(acquisition);
  });

  it("accepts Claude's literal directory lookup with stderr merged into the pipe", () => {
    expect(
      classify(
        `gh api 'repos/${repository}/contents/libraries/industrial-pilot/types?ref=${ref}' --jq '.[] | [.type,.name,.size,.sha] | @tsv' 2>&1 | head -60`,
        "Bash",
      ),
    ).toEqual(acquisition);
  });
});

describe("literal shell redirections", () => {
  it.each([
    "2>error.log",
    ">output.json",
    "2>&1",
    ">/dev/null",
    ">>output.json",
    "2>>error.log",
    '> "output data.json" 2> error.log',
    "1>output.json 2>&1",
  ])("keeps the fetched resource classification with %s", (redirect) => {
    expect(classify(`curl -fsSL ${library} ${redirect}`)).toEqual(acquisition);
    expect(classify(`curl -fsSL ${engine} ${redirect}`)).toEqual({
      class: "source-read",
    });
  });

  it("treats redirect destinations as shell operands, regardless of placement", () => {
    expect(classify(`curl 2>error.log -fsSL ${library}`)).toEqual(acquisition);
    expect(classify(` 2>error.log curl -fsSL ${library}`)).toEqual(acquisition);
    expect(classify(`curl -fsSL ${library} > '-XPOST'`)).toEqual(acquisition);
  });

  it.each(["2 >error.log", "'2'>error.log", '2>"$output"', "2>", "2>&bad"])(
    "leaves an ordinary argument or unresolved redirect fail-closed: %s",
    (suffix) => {
      expect(classify(`curl -fsSL ${library} ${suffix}`)).toEqual({
        class: "source-read",
      });
    },
  );

  it("keeps an observed project source write in V1 and the fetch in acquisition", () => {
    const path = "devices/model.json";
    const initial = {
      files: { "system.json": "s", [path]: "before" },
      documents: { "system.json": { sources: [path] } },
    };
    const final = { ...initial, files: { ...initial.files, [path]: "after" } };
    const command = `curl -fsSL ${library} >${path} 2>error.log`;
    const transcript = [
      {
        type: "item.completed",
        item: {
          type: "command_execution",
          id: "redirect-write",
          command,
          exit_code: 0,
        },
      },
    ];
    const result = score({ initial, final, transcript, allowedLibraryPaths });
    expect(result.libraryAcquisitions.map(({ id }) => id)).toEqual([
      "redirect-write",
    ]);
    expect(result.sourceReads).toBe(0);
    expect(result.violations).toEqual([
      expect.objectContaining({ rule: "V1", path }),
    ]);
  });
});
