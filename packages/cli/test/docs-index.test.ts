import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { docsIndex } from "../../../scripts/docs-index.mjs";
import { checkDocs } from "../../../scripts/check-docs.mjs";
import { loadCorpus, parseDocument } from "../../../scripts/docs-lib.mjs";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const policySource = JSON.parse(
  readFileSync(join(repository, "scripts/docs-policy.json"), "utf8"),
);
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function put(root: string, file: string, text: string) {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
}
function get(root: string, file: string) {
  return readFileSync(join(root, file), "utf8");
}
function append(root: string, file: string, text: string) {
  put(root, file, get(root, file) + text);
}
function command(
  root: string,
  script = "check-docs",
  args: string[] = [],
  env = process.env,
) {
  return spawnSync(
    process.execPath,
    [join(repository, `scripts/${script}.mjs`), "--root", root, ...args],
    {
      cwd: root,
      encoding: "utf8",
      env,
    },
  );
}
async function fixture(parent = tmpdir()) {
  const root = mkdtempSync(join(parent, "thermite-docs-"));
  roots.push(root);
  const policy = structuredClone(policySource);
  policy.legacy.baseline = [];
  const frozen = "# Frozen guide\n";
  policy.legacy.frozenSha256 = createHash("sha256")
    .update(frozen)
    .digest("hex");
  put(root, "scripts/docs-policy.json", JSON.stringify(policy));
  put(root, policy.legacy.frozenFile, frozen);
  put(root, "README.md", "# Example\n\n[Documentation](docs/README.md)\n");
  put(root, "docs/one.md", "# First reference\n\n## Heading\n");
  put(root, "docs/two.md", "# Second reference\n");
  put(root, "packages/schema/schemas/project.schema.json", "{}\n");
  put(
    root,
    "docs/topics.json",
    JSON.stringify([
      {
        id: "one",
        file: "docs/one.md",
        title: "First topic",
        readBefore: ["before testing one"],
      },
      {
        id: "two",
        file: "docs/two.md",
        title: "Second topic",
        readBefore: ["before testing two"],
      },
    ]),
  );
  await docsIndex(root, { write: true });
  expect(await checkDocs(root)).toEqual([]);
  return root;
}
async function restored(root: string, file: string, text: string) {
  put(root, file, text);
  expect(await checkDocs(root)).toEqual([]);
}

it("links an actual project schema directly from the first index level", () => {
  const index = get(repository, "docs/README.md");
  expect(parseDocument(index.split("\n## ")[0]!).links).toContainEqual(
    expect.objectContaining({
      target: "../packages/schema/schemas/project.schema.json",
    }),
  );
  const schema = JSON.parse(
    get(repository, "packages/schema/schemas/project.schema.json"),
  );
  expect(schema.$id).toBe(
    "https://thermiteschematics.com/schemas/0.1/project.schema.json",
  );
});

describe("documentation targets and GitHub fragments", () => {
  it.each([
    ["[missing](missing.md)", "missing.md", "missing local target"],
    ["[data](data.json)", "data.json", "missing local target"],
    ["![drawing](image.svg)", "image.svg", "missing local target"],
    [
      "[heading](docs/one.md#renamed)",
      "docs/one.md#renamed",
      "missing Markdown fragment",
    ],
    ["[case](docs/One.md)", "docs/One.md", "target path case does not match"],
    [
      "[escape](../elsewhere.md)",
      "../elsewhere.md",
      "target is outside repository",
    ],
    [
      "[encoded escape](%2e%2e/elsewhere.md)",
      "%2e%2e/elsewhere.md",
      "target is outside repository",
    ],
    ["[bad](%zz)", "%zz", "invalid URL encoding"],
    [
      "[file](file:///synthetic/private.md)",
      "file:///synthetic/private.md",
      "file URLs are not repository links",
    ],
    [
      "[reference][bad]\n\n[bad]: missing.md",
      "missing.md",
      "missing local target",
    ],
    [
      "![reference][bad]\n\n[bad]: missing.png",
      "missing.png",
      "missing local target",
    ],
    ['<a href="missing.md">HTML</a>', "missing.md", "missing local target"],
    ["<img src='missing.png'>", "missing.png", "missing local target"],
  ])(
    "rejects %s and returns to clean after restoration",
    async (source, target, reason) => {
      const root = await fixture();
      const original = get(root, "README.md");
      append(root, "README.md", `\n${source}\n`);
      const result = command(root);
      expect(result.status, result.stderr).toBe(1);
      expect(result.stdout).toContain(`README.md:5 ${target} ${reason}`);
      await restored(root, "README.md", original);
    },
  );

  it("checks removed Markdown, JSON and image assets, but gives assets no fragment semantics", async () => {
    const root = await fixture();
    put(root, "assets/data.json", "{}");
    put(root, "assets/drawing.svg", "<svg/>");
    append(
      root,
      "README.md",
      "\n[data](assets/data.json#anything)\n![image](assets/drawing.svg#anything)\n[doc](docs/one.md#heading)\n",
    );
    expect(await checkDocs(root)).toEqual([]);
    for (const file of [
      "assets/data.json",
      "assets/drawing.svg",
      "docs/one.md",
    ]) {
      const original = get(root, file);
      rmSync(join(root, file));
      expect(
        (await checkDocs(root)).some(
          (entry) => entry.reason === "missing local target",
        ),
      ).toBe(true);
      await restored(root, file, original);
    }
    const original = get(root, "docs/one.md");
    put(root, "docs/one.md", original.replace("## Heading", "## Renamed"));
    expect(await checkDocs(root)).toContainEqual(
      expect.objectContaining({
        target: "docs/one.md#heading",
        reason: "missing Markdown fragment",
      }),
    );
    await restored(root, "docs/one.md", original);
  });

  it("uses ATX/Setext, Unicode, code, entities, duplicate collisions and explicit HTML anchors", async () => {
    const root = await fixture();
    put(
      root,
      "docs/a space.md",
      [
        "# Unicode & `code`",
        "",
        "## Café 日本語 & `x.y`",
        "## Same",
        "## Same",
        "## Same-1",
        "## Same",
        "",
        "Setext *text*",
        "---",
        "",
        '<a id="Exact-ID"></a>',
        "<a name='old-anchor'></a>",
        '<span id="entity&amp;id"></span>',
        "## A &amp; B <em>inline</em>",
        "",
      ].join("\n"),
    );
    put(root, "folder/README.md", "# Directory\n\n## Inside\n");
    append(
      root,
      "README.md",
      [
        "",
        "[root](/docs/a%20space.md#caf%C3%A9-%E6%97%A5%E6%9C%AC%E8%AA%9E--xy)",
        ...[
          "same",
          "same-1",
          "same-1-1",
          "same-2",
          "setext-text",
          "Exact-ID",
          "old-anchor",
          "entity%26id",
          "a--b-inline",
        ].map((id) => `[anchor](docs/a%20space.md#${id})`),
        "[dir](folder/#inside)",
        '<a\n href="docs/one.md#heading">HTML</a>',
        "",
      ].join("\n"),
    );
    await docsIndex(root, { write: true });
    expect(await checkDocs(root)).toEqual([]);
    const original = get(root, "docs/a space.md");
    for (const [before, after, target] of [
      ["Setext *text*", "Other *text*", "setext-text"],
      ['id="Exact-ID"', 'id="renamed"', "Exact-ID"],
      ["## Same\n## Same", "## Other\n## Same", "same-1-1"],
      ["Café 日本語", "Coffee 日本語", "caf%C3%A9"],
    ]) {
      put(root, "docs/a space.md", original.replace(before, after));
      expect(
        (await checkDocs(root)).some(
          (entry) =>
            entry.target.includes(target) &&
            entry.reason === "missing Markdown fragment",
        ),
      ).toBe(true);
      await restored(root, "docs/a space.md", original);
    }
  });

  it("tracks HTML attribute lines and ignores data attributes", async () => {
    const root = await fixture();
    const original = get(root, "README.md");
    append(
      root,
      "README.md",
      '\n<a data-href="missing.md" data-src="missing.png">data</a>\n',
    );
    expect(await checkDocs(root)).toEqual([]);
    append(root, "README.md", '\n<a title="1>2"\n HREF="missing.md">bad</a>\n');
    expect(command(root).stdout).toContain(
      "README.md:8 missing.md missing local target",
    );
    await restored(root, "README.md", original);
  });

  it("rejects outside-root Markdown sources and directory README junctions", async () => {
    const root = await fixture();
    const outside = mkdtempSync(join(tmpdir(), "thermite-outside-docs-"));
    roots.push(outside);
    put(outside, "README.md", "# Synthetic outside\n");
    const type = process.platform === "win32" ? "junction" : "dir";
    // A directory junction named *.md also proves discovery never reads through
    // an outside-root Markdown source before it validates the physical path.
    symlinkSync(outside, join(root, "outside.md"), type);
    expect(await checkDocs(root)).toContainEqual(
      expect.objectContaining({
        file: "outside.md",
        reason: "source document is outside repository",
      }),
    );
    rmSync(join(root, "outside.md"));
    mkdirSync(join(root, "folder"));
    symlinkSync(outside, join(root, "folder/README.md"), type);
    const original = get(root, "README.md");
    append(root, "README.md", "\n[escape](folder/)\n");
    expect(await checkDocs(root)).toContainEqual(
      expect.objectContaining({
        file: "README.md",
        target: "folder/",
        reason: "target is outside repository",
      }),
    );
    rmSync(join(root, "folder"), { recursive: true });
    await restored(root, "README.md", original);
  });

  it("rejects links through an outside-root symlink", async () => {
    const root = await fixture();
    const outside = mkdtempSync(join(tmpdir(), "thermite-outside-"));
    roots.push(outside);
    put(outside, "asset.json", "{}");
    symlinkSync(
      outside,
      join(root, "outside"),
      process.platform === "win32" ? "junction" : "dir",
    );
    append(root, "README.md", "\n[escape](outside/asset.json)\n");
    expect(await checkDocs(root)).toContainEqual(
      expect.objectContaining({ reason: "target is outside repository" }),
    );
    rmSync(join(root, "outside"));
  });
});

describe("exhaustive index and navigation", () => {
  it("detects new unstaged docs, self-only orphans and islands; generation gives each a real direct link", async () => {
    const root = await fixture();
    execFileSync("git", ["init", "--quiet", root]);
    execFileSync("git", ["-C", root, "add", "."]);
    for (const [file, text] of [
      ["orphan.md", "# Orphan\n\n[self](orphan.md)\n"],
      ["island-a.md", "# Island A\n\n[B](island-b.md)\n"],
      ["island-b.md", "# Island B\n\n[A](island-a.md)\n"],
    ])
      put(root, file, text);
    const findings = await checkDocs(root);
    expect(findings).toContainEqual(
      expect.objectContaining({
        file: "orphan.md",
        reason: "orphan: no inbound source-document link",
      }),
    );
    for (const file of ["orphan.md", "island-a.md", "island-b.md"])
      expect(findings).toContainEqual(
        expect.objectContaining({
          file,
          reason: "unreachable from root README",
        }),
      );
    expect(command(root).status).toBe(1);
    await docsIndex(root, { write: true });
    expect(await checkDocs(root)).toEqual([]);
    for (const file of ["orphan.md", "island-a.md", "island-b.md"])
      expect(parseDocument(get(root, "docs/README.md")).links).toContainEqual(
        expect.objectContaining({ target: `../${file}` }),
      );
    rmSync(join(root, "docs/one.md"));
    expect(await checkDocs(root)).toContainEqual(
      expect.objectContaining({
        file: "docs/one.md",
        reason: "tracked source document is missing",
      }),
    );
  });

  it("rejects missing sole index links and a README disconnected from its index", async () => {
    const root = await fixture();
    const index = get(root, "docs/README.md");
    put(
      root,
      "docs/README.md",
      index
        .split("\n")
        .filter((line) => !line.includes("](one.md)"))
        .join("\n"),
    );
    expect(await checkDocs(root)).toContainEqual(
      expect.objectContaining({
        file: "docs/one.md",
        reason: "orphan: no inbound source-document link",
      }),
    );
    await restored(root, "docs/README.md", index);
    const readme = get(root, "README.md");
    put(root, "README.md", "# Example\n");
    expect(await checkDocs(root)).toContainEqual(
      expect.objectContaining({
        file: "docs/README.md",
        reason: "unreachable from root README",
      }),
    );
    await restored(root, "README.md", readme);
  });

  it("uses BFS depth even when every doc has inbound links and is reachable", async () => {
    const root = await fixture();
    const readme = get(root, "README.md");
    put(root, "bridge.md", "# Bridge\n\n[index](docs/README.md)\n");
    await docsIndex(root, { write: true });
    put(root, "README.md", "# Example\n\n[bridge](bridge.md)\n");
    expect(await checkDocs(root)).toContainEqual(
      expect.objectContaining({
        file: "docs/one.md",
        reason: "README link depth 3 exceeds 2",
      }),
    );
    await restored(root, "README.md", readme);
  });

  it.each(["H1", "topic title", "topic order", "topic trigger"])(
    "checks %s freshness without rewriting",
    async (kind) => {
      const root = await fixture();
      if (kind === "H1") put(root, "docs/one.md", "# Changed H1\n");
      else {
        const topics = JSON.parse(get(root, "docs/topics.json"));
        if (kind === "topic title") topics[0].title = "Changed title";
        if (kind === "topic order") topics.reverse();
        if (kind === "topic trigger")
          topics[0].readBefore = ["before something else"];
        put(root, "docs/topics.json", JSON.stringify(topics));
      }
      const original = get(root, "docs/README.md");
      for (const args of [[], ["--check"]]) {
        const result = command(root, "docs-index", args);
        expect(result.status, result.stderr).toBe(1);
        expect(result.stdout).toContain("index is stale");
        expect(get(root, "docs/README.md")).toBe(original);
      }
      expect(command(root, "docs-index", ["--write"]).status).toBe(0);
      expect(command(root, "docs-index").status).toBe(0);
      expect(await checkDocs(root)).toEqual([]);
    },
  );

  it.each(["missing target", "duplicate id", "reserved id", "invalid trigger"])(
    "rejects topic %s",
    async (kind) => {
      const root = await fixture();
      const original = get(root, "docs/topics.json");
      const topics = JSON.parse(original);
      if (kind === "missing target") topics[0].file = "docs/missing.md";
      if (kind === "duplicate id") topics[1].id = topics[0].id;
      if (kind === "reserved id") topics[0].id = "diagnostics";
      if (kind === "invalid trigger") topics[0].readBefore = ["after testing"];
      put(root, "docs/topics.json", JSON.stringify(topics));
      expect(await checkDocs(root)).toContainEqual(
        expect.objectContaining({
          file: "docs/topics.json",
          reason:
            kind === "missing target"
              ? "topic is not a source document"
              : "invalid or duplicate guide topic",
        }),
      );
      await restored(root, "docs/topics.json", original);
    },
  );

  it("treats an export nested under an ignored parent directory as Git-less", async () => {
    const parent = mkdtempSync(join(tmpdir(), "thermite-parent-"));
    roots.push(parent);
    execFileSync("git", ["init", "--quiet", parent]);
    put(parent, ".gitignore", "tmp/\n");
    mkdirSync(join(parent, "tmp"));
    const root = await fixture(join(parent, "tmp"));
    expect((await loadCorpus(root)).gitAvailable).toBe(false);
    expect(command(root).status).toBe(0);
    expect(command(root, "docs-index").status).toBe(0);
  });

  it("checks links through a directory symlink by physical path in Git mode", async () => {
    const root = await fixture();
    symlinkSync(
      join(root, "docs"),
      join(root, "linkdir"),
      process.platform === "win32" ? "junction" : "dir",
    );
    append(root, "README.md", "\n[alias](linkdir/one.md#heading)\n");
    expect(await checkDocs(root)).toEqual([]);
    execFileSync("git", ["init", "--quiet", root]);
    expect(command(root).status).toBe(0);
    put(root, ".gitignore", "*.pdf\n");
    put(root, "docs/draft.pdf", "synthetic PDF");
    append(root, "README.md", "\n[draft](linkdir/draft.pdf)\n");
    const result = command(root);
    expect(result.status, result.stderr).toBe(1);
    expect(result.stdout).toContain(
      "linkdir/draft.pdf local target is ignored by Git",
    );
    rmSync(join(root, "linkdir"));
  });

  it.each([
    ["a(b.md", "a%28b.md"],
    ["a)b.md", "a%29b.md"],
  ])(
    "generates a parsed index link for parenthesis filename %s",
    async (file, href) => {
      const root = await fixture();
      put(root, `docs/${file}`, "# Parenthesis document\n");
      // Another inbound link makes BFS pass even if the generated entry is dead.
      append(root, "README.md", `\n[direct](docs/${href})\n`);
      await docsIndex(root, { write: true });
      expect(await checkDocs(root)).toEqual([]);
      expect(parseDocument(get(root, "docs/README.md")).links).toContainEqual(
        expect.objectContaining({ target: href }),
      );
    },
  );

  it("generates a parsed topic link for a lone backtick in its H1", async () => {
    const root = await fixture();
    put(root, "docs/one.md", "# Literal ` tick\n\n## Heading\n");
    append(root, "README.md", "\n[direct](docs/one.md)\n");
    await docsIndex(root, { write: true });
    expect(await checkDocs(root)).toEqual([]);
    expect(parseDocument(get(root, "docs/README.md")).links).toContainEqual(
      expect.objectContaining({ target: "one.md" }),
    );
  });

  it("has no Git dependency in source archives, including an absent Git executable", async () => {
    const root = await fixture();
    const env = {
      ...process.env,
      PATH: join(root, "no-git-bin"),
      Path: join(root, "no-git-bin"),
    };
    expect(command(root, "docs-index", [], env).status).toBe(0);
    const result = command(root, "check-docs", [], env);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("");
    put(root, "archive-added.md", "# Archive addition\n");
    expect(command(root, "check-docs", [], env).status).toBe(1);
    expect(command(root, "docs-index", ["--write"], env).status).toBe(0);
    expect(command(root, "check-docs", [], env).status).toBe(0);
  });
});

describe("narrow documentation exclusions and legacy baseline", () => {
  it("ignores code, comments, unused definitions and external URLs, then rejects the same live link", async () => {
    const root = await fixture();
    const original = get(root, "README.md");
    append(
      root,
      "README.md",
      [
        "",
        "```md",
        "[code](missing.md)",
        "```",
        "",
        "    [indented](missing.md)",
        "",
        "`[inline](missing.md)`",
        "<!-- <a href='missing.md'>comment</a> -->",
        "[unused]: missing.md",
        "",
        "[remote](https://example.invalid/missing#no-network)",
        "<https://example.invalid/>",
        "[mail](mailto:missing@example.invalid)",
        "",
      ].join("\n"),
    );
    expect(await checkDocs(root)).toEqual([]);
    append(root, "README.md", "\n[code](missing.md)\n");
    expect(command(root).status).toBe(1);
    await restored(root, "README.md", original);
  });

  it("excludes only declared output/process paths; planning cannot rescue a live orphan", async () => {
    const root = await fixture();
    const excluded = [
      "node_modules/pkg/README.md",
      "dist/README.md",
      "build/README.md",
      "coverage/README.md",
      "docs/planning/README.md",
      ".codex-reviews/review.md",
      ".claude/CLAUDE.md",
      "PR.md",
      "evals/out/README.md",
      "examples/demo/out/README.md",
      "packages/cli/assets/guide/one.md",
    ];
    for (const file of excluded)
      put(root, file, "# Ignored\n\n[broken](missing.md)\n");
    expect(await checkDocs(root)).toEqual([]);
    put(
      root,
      "docs/planning/README.md",
      "# Planning\n\n[orphan](../../live.md)\n",
    );
    put(root, "live.md", "# Live\n");
    expect(await checkDocs(root)).toContainEqual(
      expect.objectContaining({
        file: "live.md",
        reason: "orphan: no inbound source-document link",
      }),
    );
    await docsIndex(root, { write: true });
    expect(await checkDocs(root)).toEqual([]);
    for (const file of [
      "docs/fixtures/README.md",
      "libraries/example/research/README.md",
      "evals/fixtures/README.md",
      "docs/legacy/README.md",
      ".github/README.md",
      "docs/planning-notes.md",
      "docs/out/README.md",
    ]) {
      put(root, file, "# Live reference\n\n[broken](missing.md)\n");
      await docsIndex(root, { write: true });
      expect(await checkDocs(root)).toContainEqual(
        expect.objectContaining({ file, reason: "missing local target" }),
      );
      put(root, file, "# Live reference\n");
      expect(await checkDocs(root)).toEqual([]);
    }
  });

  it.each([
    "npm install --global --prefix /old",
    "npm install -g old-runtime",
    "npm i --global old-runtime",
    "## Historical private 0.2.0 runtime",
    "thermite-cli-0.2.0.tgz",
    "Node.js ^22.12.0",
    'thermite init --name "My First Electrical Project"',
  ])(
    "rejects legacy phrase %s in live prose and code, but permits the archive",
    async (phrase) => {
      const root = await fixture();
      const original = get(root, "README.md");
      for (const text of [phrase, `\`\`\`sh\n${phrase}\n\`\`\``]) {
        append(root, "README.md", `\n${text}\n`);
        expect(command(root).status).toBe(1);
        expect(await checkDocs(root)).toContainEqual(
          expect.objectContaining({
            file: "README.md",
            reason:
              "legacy instruction outside archive (new or changed baseline match)",
          }),
        );
        await restored(root, "README.md", original);
      }
      put(root, "docs/legacy/history.md", `# Archive\n\n${phrase}\n`);
      append(
        root,
        "README.md",
        "\nHistorical runtime instructions are in the [archive](docs/legacy/history.md).\nLegacy cable assignments remain unspecified.\n",
      );
      await docsIndex(root, { write: true });
      expect(await checkDocs(root)).toEqual([]);
      put(
        root,
        "docs/legacy/history.md",
        `# Archive\n\n${phrase}\n\n[bad](missing.md)\n`,
      );
      expect(await checkDocs(root)).toContainEqual(
        expect.objectContaining({
          file: "docs/legacy/history.md",
          reason: "missing local target",
        }),
      );
    },
  );

  it("allows factual archive titles while rejecting commands beside the pointer", async () => {
    const root = await fixture();
    put(root, "docs/legacy/history.md", "# History\n");
    append(
      root,
      "README.md",
      "\nSee the [Historical private 0.2.0 runtime](docs/legacy/history.md).\n",
    );
    await docsIndex(root, { write: true });
    expect(await checkDocs(root)).toEqual([]);
    const original = get(root, "README.md");
    append(
      root,
      "README.md",
      "\nnpm install --global --prefix /old; see [Historical private 0.2.0 runtime](docs/legacy/history.md).\n",
    );
    expect(command(root).status).toBe(1);
    await restored(root, "README.md", original);
    append(
      root,
      "README.md",
      "\n## Historical private 0.2.0 runtime [outside](https://example.invalid/docs/legacy/history.md)\n",
    );
    expect(command(root).status).toBe(1);
    await restored(root, "README.md", original);
    append(
      root,
      "README.md",
      "\nHistorical private 0.2.0 runtime [x](docs/one.md)\n",
    );
    expect(await checkDocs(root)).toContainEqual(
      expect.objectContaining({
        file: "README.md",
        reason:
          "legacy instruction outside archive (new or changed baseline match)",
      }),
    );
    await restored(root, "README.md", original);
  });

  it("rejects excluded local link targets even when present in a Git-less tree", async () => {
    const root = await fixture();
    const original = get(root, "README.md");
    for (const file of [
      "docs/planning/exists.md",
      "evals/out/x.json",
      "PR.md",
      "packages/cli/assets/guide/one.md",
    ]) {
      put(root, file, file.endsWith(".md") ? "# Hidden\n" : "{}");
      append(root, "README.md", `\n[x](${file})\n`);
      const result = command(root, "check-docs", [], {
        ...process.env,
        PATH: "",
        Path: "",
      });
      expect(result.status, result.stderr).toBe(1);
      expect(result.stdout).toContain(
        `${file} local target is excluded by docs policy`,
      );
      await restored(root, "README.md", original);
    }
  });

  it("rejects Git-ignored local assets and preserves Git-less existence checks", async () => {
    const root = await fixture();
    execFileSync("git", ["init", "--quiet", root]);
    put(root, ".gitignore", "*.pdf\n");
    put(root, "assets/draft.pdf", "synthetic PDF asset");
    const original = get(root, "README.md");
    append(root, "README.md", "\n[draft](assets/draft.pdf)\n");
    expect(command(root).status).toBe(1);
    expect(await checkDocs(root)).toContainEqual(
      expect.objectContaining({
        target: "assets/draft.pdf",
        reason: "local target is ignored by Git",
      }),
    );
    expect(
      command(root, "check-docs", [], {
        ...process.env,
        PATH: join(root, "no-git-bin"),
        Path: join(root, "no-git-bin"),
      }).status,
    ).toBe(0);
    await restored(root, "README.md", original);
    // A tracked asset survives a broad ignore rule in a clean checkout.
    execFileSync("git", ["-C", root, "add", "-f", "assets/draft.pdf"]);
    append(root, "README.md", "\n[draft](assets/draft.pdf)\n");
    expect(await checkDocs(root)).toEqual([]);
  });

  it.each([
    "docs/build/notes.md",
    "packages/x/dist/README.md",
    "libraries/y/coverage/sources.md",
    "PR.md",
  ])("rejects tracked source hidden by policy: %s", async (file) => {
    const root = await fixture();
    execFileSync("git", ["init", "--quiet", root]);
    put(root, file, "# Tracked source\n\n[bad](missing.md)\n");
    execFileSync("git", ["-C", root, "add", "-f", file]);
    const expected = expect.objectContaining({
      file,
      reason: "tracked document is excluded by docs policy",
    });
    expect(await checkDocs(root)).toContainEqual(expected);
    expect(await docsIndex(root)).toContainEqual(expected);
    expect(command(root).status).toBe(1);
    execFileSync("git", ["-C", root, "rm", "--cached", "-f", file]);
    expect(await checkDocs(root)).toEqual([]);
  });

  it("does not mistake a package suffix for the -g option", async () => {
    const root = await fixture();
    append(root, "README.md", "\nnpm i left-g\nnpm install right-g@1.0\n");
    expect(await checkDocs(root)).toEqual([]);
    const original = get(root, "README.md");
    append(root, "README.md", "\nnpm i -g historical-runtime\n");
    expect(command(root).status).toBe(1);
    await restored(root, "README.md", original);
  });

  it("normalizes CRLF in source, index, pinned lines and the frozen asset without writing", async () => {
    const root = await fixture();
    const phrase = "npm install --global --prefix /old";
    const policy = JSON.parse(get(root, "scripts/docs-policy.json"));
    policy.legacy.baseline = [{ file: "packages/cli/README.md", text: phrase }];
    put(root, "scripts/docs-policy.json", JSON.stringify(policy));
    put(root, "packages/cli/README.md", `# CLI\n\n${phrase}\n`);
    await docsIndex(root, { write: true });
    expect(await checkDocs(root)).toEqual([]);
    for (const file of [
      "README.md",
      "docs/one.md",
      "docs/README.md",
      "packages/cli/README.md",
      policy.legacy.frozenFile,
    ])
      put(root, file, get(root, file).replace(/\n/g, "\r\n"));
    const index = get(root, "docs/README.md");
    expect(await docsIndex(root)).toEqual([]);
    expect(await checkDocs(root)).toEqual([]);
    expect(command(root).status).toBe(0);
    expect(get(root, "docs/README.md")).toBe(index);
  });

  it("pins baseline text, location and occurrence count without a live-file exception", async () => {
    const root = await fixture();
    const phrase = "npm install --global --prefix /old";
    const policy = JSON.parse(get(root, "scripts/docs-policy.json"));
    policy.legacy.baseline = [{ file: "packages/cli/README.md", text: phrase }];
    put(root, "scripts/docs-policy.json", JSON.stringify(policy));
    put(root, "packages/cli/README.md", `# CLI\n\n${phrase}\n`);
    await docsIndex(root, { write: true });
    expect(await checkDocs(root)).toEqual([]);
    const original = get(root, "packages/cli/README.md");
    for (const text of [
      original + phrase,
      original.replace("/old", "/new"),
      "# CLI\n",
    ]) {
      put(root, "packages/cli/README.md", text);
      expect(command(root).status).toBe(1);
      await restored(root, "packages/cli/README.md", original);
    }
    append(root, "README.md", `\n${phrase}\n`);
    expect(command(root).status).toBe(1);
  });

  it("SHA-protects the frozen asset while still checking its links and inventory", async () => {
    const root = await fixture();
    const file = policySource.legacy.frozenFile;
    const original = get(root, file);
    append(root, file, "\n[bad](missing.md)\n");
    const findings = await checkDocs(root);
    expect(findings).toContainEqual(
      expect.objectContaining({
        file,
        reason: "frozen legacy asset SHA-256 changed",
      }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({ file, reason: "missing local target" }),
    );
    await restored(root, file, original);
  });
});

it("archives the frozen guide and collapses evaluation, tooling and all fixture docs", async () => {
  const root = await fixture();
  const files = [
    "packages/example/test/fixtures/demo/README.md",
    "packages/cli/fixtures/README.md",
    "docs/fixtures/README.md",
    "evals/README.md",
    "scripts/README.md",
  ];
  for (const file of files) put(root, file, "# Fixture reference\n");
  await docsIndex(root, { write: true });
  const index = get(root, "docs/README.md");
  const archive = index.slice(index.indexOf("<summary>Archive</summary>"));
  expect(archive).toContain("../packages/cli/assets/AGENTS.md");
  expect(
    index.slice(0, index.indexOf("<summary>Archive</summary>")),
  ).not.toContain("../packages/cli/assets/AGENTS.md");
  const start = index.indexOf(
    "<summary>Evaluations, tooling and fixtures</summary>",
  );
  expect(start).toBeGreaterThan(0);
  const collapsed = index.slice(start, index.indexOf("</details>", start));
  for (const file of files)
    expect(collapsed).toContain(
      file.startsWith("docs/") ? file.slice(5) : `../${file}`,
    );
  expect(await checkDocs(root)).toEqual([]);
});

it("documents checks after any Markdown change for rebased branches without process labels", () => {
  const text = get(repository, "CONTRIBUTING.md");
  const section = text.slice(
    text.indexOf("### Documentation index and checks"),
    text.indexOf("### Focused tests and timings"),
  );
  expect(section).toContain("After any Markdown change");
  expect(section.replace(/\s+/g, " ")).toContain(
    "Library, research, evaluation, tooling, fixture and archive links are inside expandable groups.",
  );
  expect(section).toContain("bun scripts/docs-index.mjs --check");
  expect(section).toMatch(/Rebased branches/);
  expect(section).not.toMatch(/\bG5[ab]\b|\blanes?\b|\breplays?\b/i);
});

function assertProse(rootText: string, toolsText: string) {
  expect(toolsText.replace(/\s+/g, " ")).toMatch(
    /R005 for render-text preflight \(project, title and graph text\) and R006 for invalid page or packet requests and unprintable layouts/,
  );
  expect(toolsText).not.toMatch(
    /Renderer failures (?:remain|are).*R001[–-]R00[5-9]/,
  );
  expect(rootText).toContain("repository's optional component libraries");
  expect(rootText).toContain("packages/core-library/library");
  expect(rootText).toContain("packages/core-library/versions/0.2.0");
  expect(rootText).toMatch(
    /`init` copies core 0\.2\.0 into the electrical project's `libraries\/core`/,
  );
  expect(rootText).toContain("[documentation index](docs/README.md)");
}
it("keeps R006 and the three core path contexts accurate in real repository prose", () => {
  assertProse(
    get(repository, "README.md"),
    get(repository, "packages/agent-tools/README.md"),
  );
});
it("kills R006, exclusive range, core-path and index-link prose mutations", () => {
  const root = get(repository, "README.md");
  const tools = get(repository, "packages/agent-tools/README.md");
  for (const changed of [
    tools.replace("R006", "R005"),
    tools.replace(
      "render-text preflight (project, title and graph text)",
      "title-text preflight",
    ),
    tools.replace(
      "invalid page or packet requests and unprintable layouts",
      "page, packet and fit failures",
    ),
    tools + "\nRenderer failures remain R001-R006.",
  ])
    expect(() => assertProse(root, changed)).toThrow();
  for (const changed of [
    root.replaceAll("packages/core-library/library", "libraries/core"),
    root.replaceAll("packages/core-library/versions/0.2.0", "libraries/core"),
    root.replace("electrical project's", "repository's"),
    root.replace("`init` copies core 0.2.0", "`init` copies the selected core"),
    root.replace("[documentation index](docs/README.md)", "documentation"),
  ])
    expect(() => assertProse(changed, tools)).toThrow();
});

it("keeps the real repository index fresh and exhaustive without rewriting", async () => {
  const before = get(repository, "docs/README.md");
  expect(await docsIndex(repository)).toEqual([]);
  expect(await checkDocs(repository)).toEqual([]);
  expect(get(repository, "docs/README.md")).toBe(before);
  const corpus = await loadCorpus(repository);
  expect(corpus.policy.legacy.baseline).toHaveLength(0);
  expect(corpus.documents.has("packages/cli/assets/AGENTS.md")).toBe(true);
  expect(before).toContain("<summary>Libraries and research</summary>");
});

it("reports corrupt Git metadata as a tool failure instead of treating it as an archive", async () => {
  const root = await fixture();
  put(root, ".git", "not Git metadata\n");
  const failed = command(root);
  expect(failed.status).toBe(2);
  expect(failed.stdout).toBe("");
  expect(failed.stderr).toContain("Cannot inspect Git documentation inventory");
  rmSync(join(root, ".git"));
  expect(command(root).status).toBe(0);
});

it("returns sorted findings and exit 2 for tool failures, preserving source bytes", async () => {
  const root = await fixture();
  append(root, "README.md", "\n[Z](z.md) [A](a.md)\n");
  const result = command(root);
  expect(result.status).toBe(1);
  expect(result.stdout.trim().split("\n")).toEqual([
    "README.md:5 a.md missing local target",
    "README.md:5 z.md missing local target",
  ]);
  const original = get(root, "docs/README.md");
  for (const script of ["docs-index", "check-docs"]) {
    expect(command(root, script, ["--unknown"]).status).toBe(2);
    put(root, "docs/topics.json", "invalid JSON");
    const failed = command(root, script);
    expect(failed.status).toBe(2);
    expect(failed.stdout).toBe("");
    expect(failed.stderr).toContain(`${script}:`);
    expect(get(root, "docs/README.md")).toBe(original);
  }
});
