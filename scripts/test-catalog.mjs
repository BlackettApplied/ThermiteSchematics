import { existsSync, readFileSync, readdirSync } from "node:fs";
const timings = JSON.parse(
  readFileSync(new URL("./test-catalog.json", import.meta.url), "utf8"),
);
const coverage = {
  schema:
    "strict JSON/UTF-8, schemas, diagnostics and generated type consumers",
  compiler:
    "loading, byte locks, expansion, resolution, graphs, nets and engineering rules",
  "core-library": "shipped generic type versions and package inventory",
  query: "read-only traversal, continuity, reports and stable ordering",
  render:
    "ELK placement/routing, symbols, conservation, print bounds, determinism and SVG/R004 snapshots",
  "agent-tools":
    "guarded requests, dry-run/apply, filesystem safety and write recovery",
  cli: "CLI streams/exits, init, executable guides, PDF/runtime packaging and catalog/research acceptance",
};
process.stdout.write(
  "Vitest suites by package; bun run build first. Never use bun test.\nTypical file wall times: macOS arm64, Bun 1.4.2, VITEST_MAX_WORKERS=2; shared-machine baseline, not a performance gate.\nUse THERMITE_TEST_TIMINGS=1 with test/check for fresh per-file intervals in coverage/test-timings.json (ignored).\n\n",
);
const suites = [
  ...Object.entries(coverage).map(([name, description]) => ({
    name,
    description,
    directory: `packages/${name}/test`,
  })),
  {
    name: "evals/engine",
    directory: "evals/engine",
    description:
      "corpus provenance, oracle, negative diagnostics/contracts and checker tests",
  },
  {
    name: "evals/agent",
    directory: "evals/agent",
    description:
      "local fake-agent runners, guide A/B gates, dogfoods, artifacts and shim safety",
  },
  {
    name: "evals/draw",
    directory: "evals/draw",
    description:
      "drawing corpus, physical checks, expected defects and drawing gate tests",
  },
];
function testFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = `${directory}/${entry.name}`;
      return entry.isDirectory()
        ? testFiles(path)
        : /\.test\.(?:ts|mjs)$/.test(path)
          ? [path]
          : [];
    })
    .sort();
}
for (const { name, description, directory } of suites) {
  process.stdout.write(
    `${name}: ${description}\n  VITEST_MAX_WORKERS=2 bun run test -- ${directory}\n`,
  );
  const files = testFiles(directory);
  if (!existsSync(directory))
    process.stdout.write(
      "  Not present on this checkout; listed when the lane merges.\n",
    );
  for (const path of files) {
    const seconds = timings[path];
    process.stdout.write(
      `  ${seconds === undefined ? "unmeasured" : `${seconds.toFixed(2)} s`}  ${path.slice(directory.length + 1)}${path.endsWith("release-package.test.ts") ? " (frozen; excluded from check)" : ""}\n`,
    );
  }
  process.stdout.write("\n");
}
process.stdout.write(
  "Named expensive suites (independently runnable):\n  Catalog: bun run test -- packages/cli/test/promoted-component-libraries.test.ts\n    Rechecks every promoted component's accepted bytes, net partition and rendered coverage.\n  Research: bun run test -- packages/cli/test/library-batch-tools.test.ts packages/cli/test/research-tools.test.ts\n    Local fake workers; queue lifecycle, limits, interruption, verification and reviewed promotion.\n  Engine evals: bun run test -- evals/engine\n    Corpus provenance, oracle, negative diagnostics/contracts and checker unit tests.\n",
);
