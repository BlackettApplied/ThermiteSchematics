import { expect, it } from "vitest";
import { compileProject } from "@thermite/compiler";
import { renderSchematicPacket } from "../src/sheets.js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildDocumentation } from "@thermite/query";
import { parseSvg } from "./off-view-fixtures.js";
import {
  documentCaptionTokens,
  wrapDocumentTokens,
} from "../src/packet/document-caption-text.js";

it("keeps XT-HMI.20 indivisible in concise row-specific captions", async () => {
  const project = await compileProject(resolve("examples/operator-console"));
  if (!project.ok) throw Error(JSON.stringify(project.diagnostics));
  const request = JSON.parse(
    await readFile(
      resolve("examples/operator-console/packet.request.json"),
      "utf8",
    ),
  );
  const packet = await renderSchematicPacket(
    project.ir,
    request,
    project.presentation,
  );
  if (!packet.ok) throw Error(JSON.stringify(packet.error));
  const caption = packet.value.navigation!.dependencies!.find(
    (d) => d.owner.sheet === 1 && d.need === "terminal-inventory",
  )!.caption!.text;
  expect(caption).toContain("XT-HMI.20");
  expect(caption).not.toContain("XT-HMI / ");
  expect(caption.length).toBeLessThan(450);
});

it("prints the target row's reader-facing port text, never a dotted selector", async () => {
  const project = await compileProject(resolve("examples/operator-console"));
  if (!project.ok) throw Error(JSON.stringify(project.diagnostics));
  const request = JSON.parse(
    await readFile(
      resolve("examples/operator-console/packet.request.json"),
      "utf8",
    ),
  );
  const packet = await renderSchematicPacket(
    project.ir,
    request,
    project.presentation,
  );
  if (!packet.ok) throw Error(JSON.stringify(packet.error));
  const device = project.ir.devices.find((d) => d.designation === "HMI1")!;
  const nativeKey = JSON.stringify([device.uid, "ETH2"]);
  const native = buildDocumentation(project.ir, {
    format: "documentation-view-request/0.1",
    kind: "network",
  }).rows.find((r) => r.key === nativeKey)!;
  const display = "HMI1: ETH2";
  const description =
    "Engineering port identifier; physical socket mapping pending";
  expect(native.cells[2]).toContain(`${display} — ${description}`);
  const navigation = packet.value.navigation!;
  const document = navigation.documents!.find(
    (d) =>
      d.kind === "network" && d.rows.some((r) => r.nativeKey === nativeKey),
  )!;
  const row = document.rows.find((r) => r.nativeKey === nativeKey)!;
  const ink = parseSvg(packet.value.sheets[row.sheet - 1]!.svg).getElementById(
    row.primitiveId,
  )!;
  const rowText = [...ink.querySelectorAll('[data-report-column="3"] text')]
    .map((t) => t.textContent)
    .join(" ");
  expect(rowText).toContain(display);
  const dependency = navigation.dependencies!.find((d) =>
    d.resolution.some((r) => r.rows.includes(row.id)),
  )!;
  expect(dependency.caption!.text).toContain(display);
  expect(dependency.caption!.text).not.toContain(description);
  expect(row.displayName).toBe(display);
  const lines = wrapDocumentTokens(
    documentCaptionTokens(dependency, navigation.documents!, false),
    120,
  );
  expect(lines.some((line) => line.includes(display))).toBe(true);
  for (const sheet of packet.value.sheets) {
    const text = [
      ...parseSvg(sheet.svg).querySelectorAll(
        "[data-document-dependency] text",
      ),
    ]
      .map((t) => t.textContent)
      .join(" ");
    expect(text).not.toContain("HMI1.ETH2");
  }
});
