import assert from "node:assert/strict";
import { configureLocale } from "./locale.mjs";
configureLocale(process.env.LC_ALL);
const { compileProject, renderSchematicPacket, serializeIr } =
  await import("./engine.mjs");
const { sha256, readJson } = await import("./support.mjs");
const result = await compileProject(process.argv[2]);
const evidence = {
  ok: result.ok,
  diagnostics: result.diagnostics,
  diagnosticsSha256: sha256(JSON.stringify(result.diagnostics)),
};
if (result.ok) {
  evidence.compileSha256 = sha256(serializeIr(result.ir));
  const packet = await readJson(process.argv[3]);
  const rendered = await renderSchematicPacket(
    result.ir,
    packet,
    result.presentation,
  );
  assert(rendered.ok, JSON.stringify(rendered.error));
  evidence.packetSha256 = sha256(JSON.stringify(rendered));
  evidence.sheets = rendered.value.sheets.length;
}
process.stdout.write(
  JSON.stringify({
    evidence,
    environment: {
      localeMechanism: "explicit-javascript-defaults-before-engine-import",
      TZ: process.env.TZ,
      locale: process.env.LC_ALL,
      resolvedTZ: Intl.DateTimeFormat().resolvedOptions().timeZone,
      resolvedLocale: Intl.NumberFormat().resolvedOptions().locale,
    },
  }),
);
