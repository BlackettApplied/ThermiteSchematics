// Retire only strict xpasses from a reviewed complete report. Never bless fails.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hash, readJson } from "./support.mjs";
import { expectations } from "./expectations.mjs";
import { cases } from "./corpus.mjs";
import { compressScopes, units, unitKey } from "./marker-scopes.mjs";
import { serializeRegistry } from "./marker-authoring.mjs";
export function retireXpasses(registry, report, specs) {
  assert.equal(report.mode, "strict", "Use a strict measured report");
  assert.equal(report.subset, "full", "Use a complete corpus report");
  assert(
    !report.results.some((r) =>
      ["fail", "infrastructure-error"].includes(r.status),
    ),
    "Resolve new failures/infrastructure before retiring markers",
  );
  const removed = new Set(
    report.results
      .filter((r) => r.status === "xpass")
      .map((r) =>
        JSON.stringify([r.expectation.marker, unitKey(r.expectation.scope)]),
      ),
  );
  assert(removed.size, "No xpasses to retire");
  const seen = new Set();
  const markers = registry.markers.flatMap((m) => {
    const keep = units(m).filter((u) => {
      const k = JSON.stringify([m.id, unitKey(u)]);
      if (removed.has(k)) {
        seen.add(k);
        return false;
      }
      return true;
    });
    return keep.length ? [{ ...m, scopes: compressScopes(keep, specs) }] : [];
  });
  assert.equal(
    seen.size,
    removed.size,
    "Xpass report does not match the current registry",
  );
  return { registry: { ...registry, markers }, removed: [...removed].sort() };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const report = await readJson(process.argv[2]);
  assert(
    process.argv.includes("--retire-xpasses"),
    "Use --retire-xpasses (never regenerate unexpected defects)",
  );
  const target = fileURLToPath(new URL("./expectations.mjs", import.meta.url));
  assert.equal(
    report.checkers["expectations.mjs"],
    hash(await readFile(target)),
    "Registry changed since this report",
  );
  const next = retireXpasses(expectations, report, cases());
  const apply = process.argv.includes("--apply");
  const flag = process.argv.indexOf("--output");
  assert(
    apply || flag >= 0,
    "Use --apply, or --output evals/out/<proposal>.mjs",
  );
  const output = apply ? target : resolve(process.argv[flag + 1]);
  assert(
    apply ||
      output.startsWith(fileURLToPath(new URL("../out/", import.meta.url))),
    "Proposals belong under evals/out",
  );
  await writeFile(
    output,
    serializeRegistry(next.registry),
    apply ? {} : { flag: "wx" },
  );
  process.stdout.write(
    `Retired ${next.removed.length} exact scopes; ${next.registry.markers.length} markers remain. ${apply ? "Applied" : "Proposal written"}\n`,
  );
}
