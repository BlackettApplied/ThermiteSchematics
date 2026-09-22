import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import * as prettier from "prettier";

import { REPOSITORY_ROOT } from "./release-common.mjs";

export const GOVERNED_COMMITTED_JSON_PATHS = Object.freeze([
  "examples/motor-starter/presentation.json",
  "examples/motor-starter/system.json",
  "packages/cli/templates/starter-default/connections/control-power.json",
  "packages/cli/templates/starter-default/devices/equipment.json",
  "packages/cli/templates/starter-default/electrical-system.lock.json",
  "packages/cli/templates/starter-default/potentials/potentials.json",
  "packages/cli/templates/starter-default/presentation.json",
  "packages/cli/templates/starter-default/system.json",
  "packages/cli/test/goldens/m8-r005/presentation-surrogate.stderr.json",
  "packages/cli/test/goldens/m8-r005/project-empty.stderr.json",
  "packages/cli/test/goldens/m8-r005/view-single-line.stderr.json",
  "scripts/m8-golden-migration.json",
  "scripts/release-first-party-files.json",
  "scripts/release-third-party-source-files.json",
  "scripts/release-third-party-stage-files.json",
]);

export async function assertPrettierStableCommittedJson(
  repositoryRoot = REPOSITORY_ROOT,
) {
  if (
    GOVERNED_COMMITTED_JSON_PATHS.length !== 15 ||
    new Set(GOVERNED_COMMITTED_JSON_PATHS).size !== 15
  ) {
    throw new Error(
      "The M8 governed committed-JSON path set must contain exactly 15 unique paths.",
    );
  }
  for (const path of GOVERNED_COMMITTED_JSON_PATHS) {
    const absolute = join(repositoryRoot, ...path.split("/"));
    const stats = await lstat(absolute);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error(
        `Governed committed-JSON path is missing or non-ordinary: ${path}.`,
      );
    }
    const bytes = await readFile(absolute);
    const text = bytes.toString("utf8");
    if (
      !Buffer.from(text).equals(bytes) ||
      (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) ||
      text.includes("\r") ||
      !text.endsWith("\n") ||
      text.endsWith("\n\n") ||
      /[ \t]\n/u.test(text)
    ) {
      throw new Error(
        `Governed committed-JSON bytes are not canonical UTF-8/LF: ${path}.`,
      );
    }
    const formatted = await prettier.format(text, {
      ...(await prettier.resolveConfig(absolute)),
      filepath: absolute,
    });
    if (formatted !== text)
      throw new Error(`Repository Prettier changes governed JSON: ${path}.`);
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await assertPrettierStableCommittedJson();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
