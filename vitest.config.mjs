import { defineConfig, configDefaults } from "vitest/config";
import { BaseSequencer } from "vitest/node";
import { relative, sep } from "node:path";

// Clean CI runners lack Vitest's timing cache. Seed the long end of the queue
// with Windows check/worktree intervals from run 44691646975 (seconds).
// For split suites, estimate shares from assertion or local flow timings.
// CHECK6 includes fixture setup measured by the Windows console reporter.
const durations = {
  "evals/agent/artifacts.test.mjs": 26,
  "evals/agent/shim-safety.test.mjs": 32,
  "evals/agent/task-t07.test.mjs": 32,
  "evals/contributor/tasks/observer.test.mjs": 30,
  "evals/contributor/tasks/r02-probe.test.mjs": 46,
  "evals/draw/check6-navigation.test.mjs": 53,
  "evals/draw/paired-raster.test.mjs": 35,
  "evals/draw/peer-owner-browser.test.mjs": 126,
  "evals/draw/peer-owner-conveyor.test.mjs": 67,
  "evals/draw/peer-owner-machine.test.mjs": 133,
  "evals/draw/repin-record.test.mjs": 112,
  "evals/draw/repin-retention.test.mjs": 76,
  "packages/cli/test/agent-motor-starter-golden.test.ts": 39,
  "packages/cli/test/alpha-pdf.test.ts": 34,
  "packages/cli/test/alpha.test.ts": 46,
  "packages/cli/test/cli.test.ts": 28,
  "packages/cli/test/docs-example-review.test.ts": 208,
  "packages/cli/test/docs-examples-workspace.test.ts": 211,
  "packages/cli/test/docs-examples.test.ts": 261,
  "packages/cli/test/docs-index.test.ts": 42,
  "packages/cli/test/guide.test.ts": 78,
  "packages/cli/test/health-bootstrap.test.ts": 56,
  "packages/cli/test/health-decoys.test.ts": 29,
  "packages/cli/test/health-ratchet.test.ts": 48,
  "packages/cli/test/health-splits.test.ts": 51,
  "packages/cli/test/info-severity.test.ts": 28,
  "packages/cli/test/init.test.ts": 35,
  "packages/cli/test/library-batch-tools.test.ts": 72,
  "packages/cli/test/machine-demo.test.ts": 52,
  "packages/cli/test/motor-starter-golden.test.ts": 28,
  "packages/cli/test/packet-html.test.ts": 38,
  "packages/cli/test/printable-font-examples.test.ts": 171,
  "packages/cli/test/project-guide.test.ts": 308,
  "packages/cli/test/promoted-component-libraries.test.ts": 72,
  "packages/cli/test/render-cli.test.ts": 39,
  "packages/cli/test/render-motor-starter-golden.test.ts": 159,
  "packages/cli/test/report-text-scale.test.ts": 74,
  "packages/cli/test/request-discovery.test.ts": 53,
  "packages/cli/test/series-loop.test.ts": 26,
  "packages/cli/test/test-support-audit.test.ts": 29,
  "packages/compiler/test/package-smoke.test.ts": 43,
  "packages/compiler/test/potential-assessment.test.ts": 43,
  "packages/compiler/test/symbol-profile.test.ts": 65,
  "packages/core-library/test/core-machine-coverage.test.ts": 108,
  "packages/render/test/caption-placement.test.ts": 110,
  "packages/render/test/circuit-pagination.test.ts": 35,
  "packages/render/test/composed-corpus-references.test.ts": 172,
  "packages/render/test/context-reference-layout.test.ts": 142,
  "packages/render/test/continuation-diagnostics.test.ts": 25,
  "packages/render/test/continuation-labels.test.ts": 57,
  "packages/render/test/continued-location-heading.test.ts": 44,
  "packages/render/test/core-profile-clones.test.ts": 109,
  "packages/render/test/device-legend-browser.test.ts": 242,
  "packages/render/test/device-legend-pagination.test.ts": 120,
  "packages/render/test/device-legend.test.ts": 60,
  "packages/render/test/dol-control-junctions.test.ts": 76,
  "packages/render/test/dol-control-marks.test.ts": 41,
  "packages/render/test/dol-control-probes.test.ts": 62,
  "packages/render/test/off-view-fit.test.ts": 51,
  "packages/render/test/off-view-settled.test.ts": 44,
  "packages/render/test/overload-power-identity.test.ts": 48,
  "packages/render/test/packet-navigation-review.test.ts": 33,
  "packages/render/test/packet-navigation.test.ts": 25,
  "packages/render/test/power-mixed-flow.test.ts": 59,
  "packages/render/test/power-native-cache.test.ts": 34,
  "packages/render/test/power-placement-packet.test.ts": 52,
  "packages/render/test/protection-power-identity.test.ts": 50,
  "packages/render/test/r-code-designation-audit.test.ts": 37,
  "packages/render/test/render-error-details.test.ts": 63,
  "packages/render/test/render-robustness.test.ts": 97,
  "packages/render/test/rooted-gangs-corpus.test.ts": 30,
  "packages/render/test/rooted-owner-sweep.test.ts": 33,
  "packages/render/test/rooted-search-determinism.test.ts": 51,
  "packages/render/test/semantic-ordering-examples.test.ts": 238,
  "packages/render/test/semantic-ordering-machine-left-to-right.test.ts": 278,
  "packages/render/test/semantic-ordering-machine-top-to-bottom.test.ts": 234,
  "packages/render/test/semantic-ordering.test.ts": 252,
  "packages/render/test/wire-column-search.test.ts": 32,
  "scripts/agent-contract-history.test.mjs": 192,
};

class CiSequencer extends BaseSequencer {
  async sort(files) {
    const ordered = await super.sort(files);
    const seconds = ({ moduleId }) =>
      durations[
        relative(this.ctx.config.root, moduleId).split(sep).join("/")
      ] ?? 0;
    return ordered.sort((a, b) => seconds(b) - seconds(a));
  }
}

export default defineConfig({
  test: {
    ...(process.env.CI ? { sequence: { sequencer: CiSequencer } } : {}),
    include: [...configDefaults.include, "evals/**/*.test.mjs"],
    exclude: [...configDefaults.exclude, "evals/out/**", "projects/**"],
  },
});
