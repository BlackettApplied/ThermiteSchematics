import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
function createVerificationRequest({
  renderKind,
  type,
  keys,
  links,
  objects,
  circuitRequest,
}) {
  const request =
    renderKind === "circuit"
      ? circuitRequest(type, keys, links, objects)
      : {
          format: "schematic-packet-request/0.1",
          page: { size: "tabloid" },
          views: [
            { format: "documentation-view-request/0.1", kind: "bom" },
            ...(keys.length
              ? [
                  {
                    format: "documentation-view-request/0.1",
                    kind: "terminals",
                    device: "D1",
                  },
                ]
              : []),
          ],
        };
  return request;
}
export async function writeVerificationPacket(context) {
  const {
    fixture,
    output,
    report,
    check,
    renderSchematicPacket,
    diagnostic,
    assertPacketCoverage,
    json,
    baseline,
    renderKind,
  } = context;
  const request = createVerificationRequest(context);
  await writeFile(join(fixture, "packet.request.json"), json(request));
  const packet = await check("render-packet", async () => {
    const value = await renderSchematicPacket(baseline.ir, request);
    diagnostic("render", value);
    assert.equal(value.ok, true, json(value.error));
    return value.value;
  });
  report.outputs.packet = join(output, "packet.json");
  report.outputs.html = join(output, "packet.html");
  report.outputs.svgs = [];
  await writeFile(report.outputs.packet, json(packet));
  await writeFile(report.outputs.html, packet.html);
  for (const sheet of packet.sheets) {
    const path = join(output, `sheet-${sheet.number}.svg`);
    await writeFile(path, sheet.svg);
    report.outputs.svgs.push(path);
  }
  await check("render-selection-and-manifest", () =>
    assertPacketCoverage(packet, baseline.ir, request, renderKind),
  );
}
