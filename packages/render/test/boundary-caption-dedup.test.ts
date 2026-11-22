import { expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { compileProject } from "@thermite/compiler";
import { parseHTML } from "linkedom";
import { renderSchematicPacket } from "../src/sheets.js";
import { boundaryCaptionContents } from "../src/packet/boundary-captions.js";
import { continuationLabel } from "../src/packet/continuation-label.js";
import { svgSemanticId } from "../src/svg/escape.js";
import type { Link } from "../src/packet/types.js";
import { motorLabelFixture } from "./helpers/wire-label-fixture.js";
import { required } from "./fixtures.js";

it.each(["left-to-right", "top-to-bottom"] as const)(
  "prints +24VDC once at the native supply boundary in %s",
  async (flow) => {
    const { doc } = await motorLabelFixture(flow);
    const rail = [...doc.querySelectorAll(".label-rail")].find(
      (t) => t.textContent === "+24VDC",
    );
    expect(rail).toBeDefined();
    expect(
      [...doc.querySelectorAll("text.label-net")].filter(
        (t) => t.textContent === "+24VDC",
      ),
    ).toHaveLength(0);
    expect(
      [...doc.querySelectorAll("text.label-conductor")].some(
        (t) => t.textContent === "+24V-PS1-TB1",
      ),
    ).toBe(true);
  },
);

it("retains the native C013 pair and removes its adjacent same-wire caption", async () => {
  const c = await compileProject("examples/machine-demo");
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  const request = JSON.parse(
    await readFile("examples/machine-demo/packet.request.json", "utf8"),
  );
  request.views = request.views.map((view: object) =>
    "flow" in view ? { ...view, flow: "top-to-bottom" } : view,
  );
  const p = await renderSchematicPacket(c.ir, request, c.presentation);
  if (!p.ok) throw Error(JSON.stringify(p.error));
  const sheet = required(
    p.value.sheets.find((s) =>
      s.continuations.some((x) => x.conductor === "OL1-NC-K1-A1"),
    ),
  );
  const doc = parseHTML(sheet.svg).document;
  const paired = [
    ...doc.querySelectorAll('a[data-conductor-id="OL1-NC-K1-A1"]'),
  ];
  expect(
    paired.map((entry) => entry.querySelector("text")?.textContent),
  ).toEqual(["C013 / 03.A2", "C013 / 03.D1"]);
  expect(
    paired.map((entry) => entry.querySelector("text:last-child")?.textContent),
  ).toEqual(["OL1-NC-K1-A1", "OL1-NC-K1-A1"]);
  expect(
    [...doc.querySelectorAll("text.label-conductor")].filter(
      (t) => t.textContent === "OL1-NC-K1-A1",
    ),
  ).toHaveLength(0);
});

function fixture() {
  const edge = JSON.stringify(["wire", "native"]);
  const key = svgSemanticId("edge", [edge]);
  const clip = svgSemanticId("clip", [
    JSON.stringify(["label", "edge", edge, "conductor"]),
  ]);
  const content = `<svg width="100" height="100" viewBox="0 20 100 100"><path data-edge-key="${key}" data-net-id="net" d="M 30 5 V 95"/><rect class="label-background label-conductor" x="31" y="23" width="5" height="2"/><text class="label-text label-conductor" clip-path="url(#${clip})" x="31" y="25" font-size="2.5">W1</text></svg>`;
  const link: Link = {
    id: "C001",
    to: 2,
    toZone: "A1",
    side: "top",
    x: 30,
    y: 0,
    netId: "net",
    conductor: "W1",
    provenance: { kind: "wire", uid: "native" },
  };
  link.label = continuationLabel(link, 60, 30);
  return { content, link };
}

it("suppresses only a matching, resolved, adjacent surviving continuation name", () => {
  const { content, link } = fixture();
  expect(
    boundaryCaptionContents([{ content, links: [link] }])[0],
  ).not.toContain(">W1</text>");
  for (const other of [
    { ...link, provenance: { kind: "wire" as const, uid: "other" } },
    { ...link, x: 50 },
    { ...link, label: undefined },
    { ...link, toZone: undefined },
    { ...link, conductor: "different" },
  ])
    expect(boundaryCaptionContents([{ content, links: [other] }])[0]).toBe(
      content,
    );
});

it("keeps tiled caption positions and only clears fully clipped replicas from the same view", () => {
  const { content, link } = fixture();
  const pane = (key: string, svg: string) =>
    `<g data-navigation-view="${key}">${svg}</g>`;
  const visible = pane("native-view", content);
  const clipped = content.replace(
    'viewBox="0 20 100 100"',
    'viewBox="0 40 100 100"',
  );
  const sameView = pane("native-view", clipped);
  const otherView = pane("another-view", clipped);
  const result = boundaryCaptionContents([
    { content: visible, links: [link] },
    { content: sameView, links: [] },
    { content: otherView, links: [] },
    { content: visible, links: [] },
  ]);
  expect(result).toEqual([
    visible
      .replace("<rect ", '<rect visibility="hidden" ')
      .replace(">W1</text>", "></text>"),
    sameView
      .replace("<rect ", '<rect visibility="hidden" ')
      .replace(">W1</text>", "></text>"),
    otherView,
    visible,
  ]);
});
