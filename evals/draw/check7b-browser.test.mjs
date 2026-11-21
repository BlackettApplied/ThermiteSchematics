import { beforeAll, afterAll, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import {
  createNavigationProject,
  renderNavigationFixture,
} from "./check6-navigation-fixture.mjs";
import { launch, openSheet, drawingContextOptions } from "./browser.mjs";
import { navigationStrictObservations } from "./navigation-strict.mjs";
import { observation } from "./evaluate.mjs";
let project, browser, context, page;
beforeAll(async () => {
  project = await createNavigationProject();
  browser = await launch();
  context = await browser.newContext(drawingContextOptions);
  page = await context.newPage();
});
afterAll(async () => {
  await context?.close();
  await browser?.close();
  if (project) await rm(project.directory, { recursive: true, force: true });
});
it.each(["left-to-right", "top-to-bottom"])(
  "FU1 real native packing fixture survives whole-element erasure (%s)",
  async (flow) => {
    const x = await renderNavigationFixture(project, flow);
    x.geometries = [];
    for (const s of x.packet.sheets)
      x.geometries.push(await openSheet(page, s.svg));
    const audit = () =>
      navigationStrictObservations(
        { id: "check7b-native" },
        x.packet,
        x.geometries,
        x.ir,
        x.request,
        observation,
      );
    expect(
      audit()
        .filter((r) => r.owner === "#396")
        .every((r) => r.status === "pass"),
    ).toBe(true);
    const uid = x.ir.devices.find((d) => d.designation === "OL1").uid;
    for (const [i, g] of x.geometries.entries()) {
      if (x.packet.sheets[i].view.family === "power") {
        g.shapes = g.shapes.filter((s) => s.deviceUid !== uid);
        g.terminals = g.terminals.filter((t) => t.deviceUid !== uid);
      }
      g.texts = g.texts.filter((t) => !t.text.includes("OL1"));
    }
    const judged = audit().filter((r) => r.owner === "#396");
    const missing = judged
      .flatMap((r) => r.evidence.findings)
      .filter((f) => f.kind === "native-rooted-element-appearance-missing");
    expect(missing.map((f) => f.sourceFunction).sort()).toEqual([
      "pole1",
      "pole2",
      "pole3",
    ]);
    expect(
      missing.every((f) => f.deviceUid === uid && f.locator.requestView === 1),
    ).toBe(true);
    expect(judged.some((r) => r.status === "fail")).toBe(true);
  },
);
