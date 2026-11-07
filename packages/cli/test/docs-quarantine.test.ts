import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { checkDocs } from "../../../scripts/check-docs.mjs";
import { docsIndex } from "../../../scripts/docs-index.mjs";
import { parseDocument, resolveTarget } from "../../../scripts/docs-lib.mjs";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function put(root: string, file: string, text: string) {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
}
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "thermite-quarantine-"));
  roots.push(root);
  const policy = JSON.parse(
    readFileSync(join(repository, "scripts/docs-policy.json"), "utf8"),
  );
  policy.legacy.baseline = [];
  const frozen = "# Frozen guide\n";
  policy.legacy.frozenSha256 = createHash("sha256")
    .update(frozen)
    .digest("hex");
  put(root, "scripts/docs-policy.json", JSON.stringify(policy));
  put(root, policy.legacy.frozenFile, frozen);
  put(root, "docs/topics.json", "[]\n");
  put(root, "packages/schema/schemas/project.schema.json", "{}\n");
  put(root, "README.md", "# Example\n\n[index](docs/README.md)\n");
  await docsIndex(root, { write: true });
  expect(await checkDocs(root)).toEqual([]);
  return root;
}

// Each witness exercises one additional historical rule, independently of the
// older heading, tarball, caret range, global npm and starter-name patterns.
const historicalPhrases = [
  ["required Node version", "Requires Node.js 22.12"],
  ["required Node lower bound", "Requires Node.js >=22.12"],
  ["global pnpm install", "pnpm add -g private-runtime"],
  ["pnpm install verb", "pnpm install -g private-runtime"],
  ["pnpm global flag", "pnpm add --global private-runtime"],
  ["global Bun install", "bun add -g private-runtime"],
  ["Bun global flag", "bun add --global private-runtime"],
  ["global Yarn install", "yarn global add private-runtime"],
  ["legacy inventory command", "npm run test:legacy-package"],
  ["private packaging context", "Historical private 0.2.0 packaging"],
  [
    "current-directory init",
    "`thermite init` always targets the current existing directory.",
  ],
  [
    "past-tense init",
    "`thermite init` targeted the current existing directory.",
  ],
  [
    "empty-directory init",
    "`thermite init` always targets the current empty directory.",
  ],
  ["init without a path", "it has no path operand"],
  ["private install heading", "### Private offline install"],
  ["authorized private assets", "Obtain the authorized private Release assets"],
  ["isolated install prefix", "Create a new isolated prefix"],
  ["isolated-prefix placeholder", "<isolated-prefix>"],
  ["user npmrc placeholder", "<empty-user-npmrc>"],
  ["global npmrc placeholder", "<empty-global-npmrc>"],
  [
    "private prefix shim",
    "Invoke only the `thermite` shim installed under that prefix.",
  ],
  ["historical version output", "The version output is `0.2.0`."],
  [
    "historical init defaults",
    "name `Thermite Schematics Starter Project` and revision `0.1.0`.",
  ],
];
it.each(historicalPhrases)(
  "rejects %s in live prose/code and permits it in the archive",
  async (_name, phrase) => {
    const root = await fixture();
    const readme = readFileSync(join(root, "README.md"), "utf8");
    for (const text of [phrase, `\`\`\`sh\n${phrase}\n\`\`\``]) {
      put(root, "README.md", readme + `\n${text}\n`);
      expect(await checkDocs(root)).toContainEqual(
        expect.objectContaining({
          file: "README.md",
          reason:
            "legacy instruction outside archive (new or changed baseline match)",
        }),
      );
      put(root, "README.md", readme);
      expect(await checkDocs(root)).toEqual([]);
    }
    put(root, "docs/legacy/history.md", `# Archive reference\n\n${phrase}\n`);
    await docsIndex(root, { write: true });
    expect(await checkDocs(root)).toEqual([]);
  },
);

it("keeps the pnpm install alternative independent of the older npm rule", () => {
  // The older unanchored npm pattern also matches the suffix of pnpm install.
  // Check the dedicated rule so that overlap cannot conceal a lost alternative.
  const policy = JSON.parse(
    readFileSync(join(repository, "scripts/docs-policy.json"), "utf8"),
  );
  const pattern = policy.legacy.patterns.find((text: string) =>
    text.startsWith("\\bpnpm\\s+"),
  );
  expect(pattern).toBeDefined();
  expect(new RegExp(pattern, "i").test("pnpm install -g private-runtime")).toBe(
    true,
  );
});

it("checks continued shell commands at their first physical line", async () => {
  const root = await fixture();
  const readme = readFileSync(join(root, "README.md"), "utf8");
  put(
    root,
    "README.md",
    readme + "\n```sh\nnpm install \\\n  --global private-runtime\n```\n",
  );
  expect(await checkDocs(root)).toContainEqual(
    expect.objectContaining({
      file: "README.md",
      line: 6,
      reason:
        "legacy instruction outside archive (new or changed baseline match)",
    }),
  );
  put(root, "README.md", readme);
  expect(await checkDocs(root)).toEqual([]);
});

it("permits a factual packaging archive pointer while retaining command checks", async () => {
  const root = await fixture();
  put(root, "docs/legacy/history.md", "# Release context\n");
  put(
    root,
    "README.md",
    "# Example\n\n[index](docs/README.md)\n\nHistorical private 0.2.0 packaging is described in the [archive](docs/legacy/history.md).\n",
  );
  await docsIndex(root, { write: true });
  expect(await checkDocs(root)).toEqual([]);
  put(
    root,
    "README.md",
    readFileSync(join(root, "README.md"), "utf8") +
      "\nRun `npm run test:legacy-package`; see the [archive](docs/legacy/history.md).\n",
  );
  expect(await checkDocs(root)).toContainEqual(
    expect.objectContaining({
      reason:
        "legacy instruction outside archive (new or changed baseline match)",
    }),
  );
});

it("preserves current commands, runtime evidence and cable legacy terminology", async () => {
  const root = await fixture();
  put(
    root,
    "README.md",
    readFileSync(join(root, "README.md"), "utf8") +
      "\nthermite validate .\nRequires Bun 1.4.2\nVerification used Node.js 22.12\npnpm add left-g\nnpm i left-g\nbun add left-g\nyarn add left-g\nLegacy cable assignments remain unspecified.\n",
  );
  expect(await checkDocs(root)).toEqual([]);
});

const anchors = [
  "formats-and-compatibility",
  "paper-and-packets",
  "cable-assignments",
  "libraries-and-deployment",
  "documentation-and-library-metadata",
  "compact-sheets-and-references",
  "pdf-and-semantic-review",
  "declared-physical-continuity-review",
];
it.each(anchors)(
  "preserves the compatibility hub anchor #%s",
  async (anchor) => {
    const file = "docs/formats-and-compatibility.md";
    const doc = parseDocument(readFileSync(join(repository, file), "utf8"));
    expect(doc.anchors.has(anchor)).toBe(true);
    const target = await resolveTarget(
      repository,
      "README.md",
      `${file}#${anchor}`,
    );
    expect(target).toMatchObject({ file, fragment: anchor, markdown: true });
  },
);
it("keeps the split bodies linked through the original hub headings", async () => {
  const hub = readFileSync(
    join(repository, "docs/formats-and-compatibility.md"),
    "utf8",
  );
  for (const [heading, file] of [
    ["Cable assignments", "cable-assignments.md"],
    ["Libraries and deployment", "deployment-and-output.md"],
    ["Documentation and library metadata", "source-metadata.md"],
  ]) {
    const section = hub.split(`## ${heading}\n`)[1]?.split("\n## ")[0] ?? "";
    expect(parseDocument(section).links).toContainEqual(
      expect.objectContaining({ target: file }),
    );
    expect(readFileSync(join(repository, "docs", file), "utf8")).toContain(
      "formats-and-compatibility.md#",
    );
  }
});
