import { readFile } from "node:fs/promises";

import { fileURLToPath } from "node:url";
import {
  DIAGNOSTIC_CATALOG,
  SYMBOL_PROFILES,
  loadCanonicalSchemas,
} from "@thermite/schema";
import type { Command } from "commander";

export interface GuideTopic {
  id: string;
  file: string;
  title: string;
  readBefore: string[];
}

export const guideDirectory = fileURLToPath(
  new URL("../assets/guide", import.meta.url),
);
export async function guideTopics(): Promise<GuideTopic[]> {
  return JSON.parse(
    await readFile(
      new URL("../assets/guide/topics.json", import.meta.url),
      "utf8",
    ),
  );
}
/** Installed manifests must match the prebuilt guide; source checkouts ignore parent manifests. */
export async function guideCommit(): Promise<string> {
  const source = JSON.parse(
    await readFile(
      new URL("../assets/guide/source.json", import.meta.url),
      "utf8",
    ),
  );
  if (!/^[a-f0-9]{40}$/.test(source.commit))
    throw new Error("Invalid guide build provenance.");
  const modulePath = fileURLToPath(import.meta.url).replaceAll("\\", "/");
  if (modulePath.endsWith("/node_modules/@thermite/cli/dist/alpha-guide.js")) {
    const manifest = JSON.parse(
      await readFile(
        new URL("../../../../runtime-manifest.json", import.meta.url),
        "utf8",
      ),
    );
    if (
      manifest.format !== "thermite-runtime-release/0.1" ||
      !/^[a-f0-9]{40}$/.test(manifest.commit)
    )
      throw new Error("Invalid runtime guide provenance.");
    if (manifest.commit !== source.commit)
      throw new Error(
        "Runtime guide commit mismatch; reinstall a verified runtime package.",
      );
  }
  return source.commit;
}
// pack builds these bytes with the commit enforced by guideCommit().
async function topicMarkdown(topic: GuideTopic) {
  return readFile(
    new URL(`../assets/guide/${topic.id}.md`, import.meta.url),
    "utf8",
  );
}
const symbolText = () =>
  [
    "Profile | Aliases | Families / roles",
    "--- | --- | ---",
    ...SYMBOL_PROFILES.map(
      (p) =>
        `${p.id} | ${[...p.aliases, ...p.coreAliases.map((a) => a.symbol)].join(", ") || "—"} | ${p.support.map((s) => `${s.family}:${s.role}`).join(", ")}`,
    ),
    "Use --json for function shapes, constraints, notes and full support details.",
  ].join("\n") + "\n";
const diagnosticText = (code?: string) =>
  Object.entries(DIAGNOSTIC_CATALOG)
    .filter(([key]) => !code || code === key)
    .map(
      ([key, entry]) =>
        `${key} (${entry.severity}; ${entry.producer}) — ${entry.meaning}\n`,
    )
    .join("");
async function schemaEntries() {
  const directory = new URL(
    "../schemas/",
    import.meta.resolve("@thermite/schema"),
  );
  return (await loadCanonicalSchemas(fileURLToPath(directory))).map(
    ({ fileName, id, schema }) => ({
      name: fileName.replace(/\.schema\.json$/, ""),
      $id: id,
      $schema: (schema as { $schema: string }).$schema,
      path: fileURLToPath(new URL(fileName, directory)),
    }),
  );
}
const schemaText = (schemas: Awaited<ReturnType<typeof schemaEntries>>) =>
  schemas.map((s) => `${s.name} — ${s.$id}\n  ${s.path}\n`).join("") +
  "Use guide schema <name> for the exact schema bytes, or --json for identifiers and paths.\nValidate project source offline with thermite validate <project>.\n";
const tokenEstimate = (text: string) =>
  Math.ceil(Buffer.byteLength(text, "utf8") / 4);

const printJson = (value: unknown) =>
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
export function registerGuideCommand(command: Command): void {
  const guide = command
    .command("guide [topic]")
    .description(
      "read offline reference topics; lists read-before triggers and approximate tokens",
    )
    .option("--json", "print the index or catalog as JSON")
    .option(
      "--path",
      "print the directory of resolved, shipped Markdown topics",
    )
    .action(
      async (
        id: string | undefined,
        flags: { json?: boolean; path?: boolean },
      ) => {
        if (flags.path) {
          if (id || flags.json)
            throw new Error("Use guide --path without a topic or --json.");
          await guideCommit();
          process.stdout.write(`${guideDirectory}\n`);
          return;
        }
        const topics = await guideTopics();
        if (id) {
          const topic = topics.find((t) => t.id === id);
          if (!topic)
            throw new Error(
              `Unknown guide topic ${JSON.stringify(id)}. Valid ids: ${topics.map((t) => t.id).join(", ")}. Also: symbols, diagnostics, schema.`,
            );
          if (flags.json)
            throw new Error(
              "Topic output is Markdown; --json is for the index and catalogs.",
            );
          await guideCommit();
          process.stdout.write(await topicMarkdown(topic));
          return;
        }
        await guideCommit();
        const index = await Promise.all(
          topics.map(async (topic) => ({
            id: topic.id,
            title: topic.title,
            readBefore: topic.readBefore,
            approximateTokens: tokenEstimate(await topicMarkdown(topic)),
          })),
        );
        index.push({
          id: "symbols",
          title:
            "Symbol profiles, aliases and family support (--json for shapes)",
          readBefore: ["before selecting a symbol profile"],
          approximateTokens: tokenEstimate(symbolText()),
        });
        index.push({
          id: "diagnostics",
          title: "All CLI and agent diagnostic codes (E/W/I/R/Q/A/T/INIT)",
          readBefore: ["before interpreting a diagnostic"],
          approximateTokens: tokenEstimate(diagnosticText()),
        });
        index.push({
          id: "schema",
          title: "Shipped JSON Schemas, identifiers and installed paths",
          readBefore: ["before validating source shapes offline"],
          approximateTokens: tokenEstimate(schemaText(await schemaEntries())),
        });
        if (flags.json)
          printJson(
            index.map((entry) => ({
              ...entry,
              tokenEstimateMethod: "default-text-utf8-bytes/4-ceil",
            })),
          );
        else {
          process.stdout.write(
            "Token estimates: served UTF-8 bytes / 4, rounded up; catalogs use text output.\n",
          );
          for (const t of index)
            process.stdout.write(
              `${t.id} — ${t.title} (~${t.approximateTokens} tokens)\n  ${t.readBefore.join("; ")}\n`,
            );
        }
      },
    );
  guide
    .command("symbols")
    .description(
      "list symbol profile aliases, function shapes and per-family support",
    )
    .option("--json", "print the catalog as JSON")
    .action((_flags, cmd: Command) => {
      if (cmd.optsWithGlobals().json) printJson(SYMBOL_PROFILES);
      else process.stdout.write(symbolText());
    });
  guide
    .command("diagnostics [code]")
    .description("list all CLI and agent diagnostic codes, or explain one")
    .option("--json", "print the catalog or entry as JSON")
    .action((code: string | undefined, _flags, cmd: Command) => {
      code = code?.toUpperCase();
      if (code !== undefined && !Object.hasOwn(DIAGNOSTIC_CATALOG, code)) {
        throw new Error(
          `Unknown diagnostic code ${JSON.stringify(code)}. Valid codes: ${Object.keys(DIAGNOSTIC_CATALOG).join(", ")}.`,
        );
      }
      const entries = Object.entries(DIAGNOSTIC_CATALOG).filter(
        ([key]) => code === undefined || code === key,
      );
      if (cmd.optsWithGlobals().json) printJson(Object.fromEntries(entries));
      else process.stdout.write(diagnosticText(code));
    });
  guide
    .command("schema [name]")
    .description(
      "list shipped JSON Schemas or serve one byte-for-byte; identifiers stay unchanged",
    )
    .option("--json", "list schema names, $id, $schema and local paths as JSON")
    .action(async (name: string | undefined, _flags, cmd: Command) => {
      const schemas = await schemaEntries();
      const selected = schemas.filter(
        (s) =>
          name === undefined ||
          s.name === name ||
          `${s.name}.schema.json` === name ||
          s.$id === name,
      );
      if (!selected.length)
        throw new Error(
          `Unknown schema ${JSON.stringify(name)}. Valid names: ${schemas.map((s) => s.name).join(", ")}.`,
        );
      if (cmd.optsWithGlobals().json) printJson(selected);
      else if (name) process.stdout.write(await readFile(selected[0]!.path));
      else process.stdout.write(schemaText(selected));
    });
}
