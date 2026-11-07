import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
// G2's Markdown surface, including the verbatim archive. Keep the frozen asset
// out of this list: its checkout-relative prose is historical and byte-pinned.
const documents = [
  "AGENTS.md",
  "README.md",
  "CONTRIBUTING.md",
  "packages/cli/README.md",
  "docs/agent-requests.md",
  "docs/legacy/private-release-agent-guide.md",
  "docs/legacy/private-release.md",
];

function headingIds(markdown: string): Set<string> {
  const seen = new Map<string, number>();
  return new Set(
    [...markdown.matchAll(/^#{1,6} (.+)$/gmu)].map((match) => {
      const slug = match[1]!
        .toLowerCase()
        .replace(/[^\p{L}\p{N}_ -]/gu, "")
        .replace(/ /gu, "-");
      const count = seen.get(slug) ?? 0;
      seen.set(slug, count + 1);
      return count === 0 ? slug : `${slug}-${count}`;
    }),
  );
}

async function brokenLinks(
  document: string,
  markdown: string,
): Promise<string[]> {
  // Inline local Markdown links used by these guides. Ignore code fences so
  // example source text cannot be mistaken for a documentation link.
  const prose = markdown.replace(/^```[^\n]*\n[\s\S]*?^```/gmu, "");
  const failures: string[] = [];
  for (const match of prose.matchAll(/\[[^\]\n]+\]\(([^)\s]+)\)/gu)) {
    const href = match[1]!;
    if (/^[a-z][a-z\d+.-]*:/iu.test(href)) continue;
    const [path, fragment] = href.split("#");
    const target = path
      ? resolve(
          dirname(resolve(repositoryRoot, document)),
          decodeURIComponent(path),
        )
      : resolve(repositoryRoot, document);
    try {
      const status = await stat(target);
      if (
        fragment &&
        (!status.isFile() ||
          !headingIds(await readFile(target, "utf8")).has(
            decodeURIComponent(fragment),
          ))
      ) {
        failures.push(href);
      }
    } catch {
      failures.push(href);
    }
  }
  return failures;
}

describe("guide migration links", () => {
  it.each(documents)(
    "resolves local paths and section anchors in %s",
    async (document) => {
      const markdown = await readFile(
        resolve(repositoryRoot, document),
        "utf8",
      );
      expect(await brokenLinks(document, markdown)).toEqual([]);
    },
  );

  it.each([
    "missing-guide.md",
    "AGENTS.md#4-six-executable-agent-commands",
    "docs/agent-requests.md#missing-section",
  ])(
    "rejects missing destinations and stale root anchors: %s",
    async (href) => {
      expect(await brokenLinks("README.md", `[reference](${href})`)).toEqual([
        href,
      ]);
    },
  );

  it("resolves the moved examples and legacy section anchors", async () => {
    expect(
      await brokenLinks(
        "README.md",
        [
          "[requests](docs/agent-requests.md#six-executable-agent-commands)",
          "[legacy](docs/legacy/private-release-agent-guide.md#4-six-executable-agent-commands)",
        ].join("\n"),
      ),
    ).toEqual([]);
  });
});
