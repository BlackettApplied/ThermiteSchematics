import assert from "node:assert/strict";
import { hash } from "./support.mjs";
import { displaySheet, evaluateSheetGeometry } from "./browser.mjs";
import { navigationExposure } from "./navigation-exposure-rows.mjs";
import { isIdentifierError } from "./identifier-errors.mjs";
export async function measureExposureCase(
  readCaseFile,
  id,
  report,
  page,
  sources,
) {
  const read = async (name) => {
    const bytes = await readCaseFile(id, name);
    sources.push({ case: id, file: name, sha256: hash(bytes) });
    return JSON.parse(bytes.toString());
  };
  if (!report.sourceHashes.sheets.some((s) => s.case === id))
    return refusedExposure(id, read);
  const packet = await read("packet.json"),
    ir = await read("ir.json"),
    request = await read("request.json"),
    geometries = [],
    errors = [];
  for (const s of packet.sheets) {
    const name = `sheet-${String(s.number).padStart(3, "0")}.svg`,
      bytes = await readCaseFile(id, name);
    const expected = report.sourceHashes.sheets.find(
      (x) => x.case === id && x.sheet === s.number,
    )?.svg.sha256;
    assert.equal(
      hash(bytes),
      expected,
      "Native SVG differs from the bound strict report",
    );
    sources.push({ case: id, file: name, sha256: hash(bytes) });
    try {
      await displaySheet(page, bytes.toString());
      geometries.push(await evaluateSheetGeometry(page));
    } catch (error) {
      if (!isIdentifierError(error)) throw error;
      errors.push({
        sheet: s.number,
        kind: "exposure-identifier-measurement-unavailable",
        reason: error.message,
      });
      geometries.push(null);
    }
  }
  return navigationExposure(packet, geometries, ir, request).map((r) => {
    const local = errors.filter((e) => e.sheet === r.sheet);
    return {
      ...r,
      id: id + "/" + r.id,
      case: id,
      ...(local.length
        ? {
            assessment: "infrastructure-error",
            failures: [...r.failures, ...local],
          }
        : {}),
    };
  });
}

async function refusedExposure(id, read) {
  const log = await read("cli.log");
  assert(
    log.error?.code === "R006" ||
      log.diagnostics?.some((d) => d.code === "R006"),
    "No issued sheets without a bound R006 refusal",
  );
  return [396, 398].map((owner) => ({
    id: `${id}/CHECK5/${owner}/refusal`,
    case: id,
    sheet: 0,
    dq: owner === 396 ? "DQ-07" : "DQ-08",
    owner: `#${owner}`,
    strict: false,
    repinNow: false,
    medium: "svg",
    assessment: "not-measured",
    reason: "R006 refusal: no issued sheet; no exposure verdict",
    findings: [],
    failures: [],
    obligations: [],
  }));
}
