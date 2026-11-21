import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  fixture,
  makeStandaloneDir,
  manifestName,
  motorPacket,
  mustSucceed,
  powerView,
  readJson,
  reportJob,
  reportView,
  writeJson,
  type Fixture,
} from "./helpers/export-fixture.js";

const reportKinds = ["io", "bom", "cables", "terminals", "wires"];
const packetOutputs = {
  json: "packet.json",
  html: "packet.html",
  pdf: "packet.pdf",
};
const viewJobs = [
  {
    kind: "view",
    designation: "M1",
    intent: "power",
    outputs: { pdf: "motor.pdf", html: "motor.html" },
  },
  {
    kind: "view",
    designation: "K1",
    intent: "actuation",
    flow: "top-to-bottom",
    outputs: { pdf: "actuation.pdf" },
  },
  {
    kind: "view",
    designation: "PS1",
    intent: "loads",
    outputs: { pdf: "loads.pdf" },
  },
];
const ancillaryJobs = [
  { kind: "diagnostics", outputs: { json: "diagnostics.json" } },
  { kind: "cable", designation: "CBL1", outputs: { json: "cable.json" } },
  { kind: "review", before: "before.json", outputs: { json: "review.json" } },
];

async function setupParity(f: Fixture) {
  await writeJson(join(f.project, "presentation.json"), {
    format: "project-presentation/0.2",
    revision: "A",
    backgroundColor: "#ffffff",
  });
  await mustSucceed(
    await f.cli("snapshot", "-o", join(f.project, "before.json")),
  );
  await motorPacket(f.project, [
    powerView("top-to-bottom"),
    ...reportKinds.map(reportView),
  ]);
  await f.plan(
    {
      kind: "packet",
      input: "packet.json",
      index: true,
      outputs: packetOutputs,
    },
    ...viewJobs,
    ...reportKinds.map((kind) => reportJob(kind)),
    ...ancillaryJobs,
  );
}

function standaloneCommands(f: Fixture): [string, string[]][] {
  return [
    ...Object.values(packetOutputs).map((file): [string, string[]] => [
      file,
      ["packet", "--input", join(f.project, "packet.json"), "--index"],
    ]),
    ["motor.pdf", ["view", "M1", "--power"]],
    ["motor.html", ["view", "M1", "--power"]],
    ["actuation.pdf", ["view", "K1", "--actuation", "--flow", "top-to-bottom"]],
    ["loads.pdf", ["view", "PS1", "--loads"]],
    ...reportKinds.map((kind): [string, string[]] => [
      kind + ".csv",
      ["report", kind],
    ]),
    ["diagnostics.json", ["diagnostics", "--json"]],
    ["cable.json", ["cable", "CBL1", "--json"]],
    [
      "review.json",
      ["review", "--json", "--before", join(f.project, "before.json")],
    ],
  ];
}

describe("export bundle and standalone byte parity", () => {
  it("matches every conveyor artifact and verifies the same plan with standalone receipts", async () => {
    const f = await fixture();
    await setupParity(f);
    await mustSucceed(await f.bundle());
    expect((await f.check()).findings).toMatchObject({
      fresh: true,
      reasons: [],
    });
    const standalone = await makeStandaloneDir(f.project);
    for (const [name, args] of standaloneCommands(f)) {
      const file = join(standalone, name);
      await mustSucceed(await f.cli(...args, "-o", file, "--receipt"));
      expect(
        (await readFile(join(f.out, name))).equals(await readFile(file)),
        name,
      ).toBe(true);
      expect(await readJson(file + ".receipt.json")).toMatchObject({
        format: "export-receipt/1",
        artifact: { path: name },
      });
    }
    const result = await f.cli(
      "export",
      "check",
      "--input",
      f.input,
      "--out-dir",
      standalone,
      "--receipts",
    );
    await mustSucceed(result);
    const manifest = await readJson(join(f.out, manifestName));
    expect(manifest.jobDiagnostics).toContainEqual({
      outputs: Object.values(packetOutputs),
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "W906" }),
      ]),
    });
    expect(
      manifest.diagnostics.some((d: { code: string }) => d.code === "W906"),
    ).toBe(false);
    const packet = await readJson(join(f.out, packetOutputs.json));
    expect(packet.navigation).toBeDefined();
    expect(packet.coverage).toBeDefined();
  });

  it("catches the PLC1 and PS1 location edit while an independently rendered power HTML stays byte-identical", async () => {
    const f = await fixture();
    await motorPacket(f.project, [
      powerView(),
      reportView("bom"),
      reportView("terminals"),
    ]);
    const packetJob = {
      kind: "packet",
      input: "packet.json",
      outputs: { html: "packet.html" },
    };
    await f.plan(
      packetJob,
      viewJobs[0],
      reportJob("bom"),
      reportJob("terminals"),
    );
    await mustSucceed(await f.bundle());
    const files = ["packet.html", "bom.csv", "terminals.csv", "motor.html"];
    const original = await Promise.all(
      files.map((file) => readFile(join(f.out, file))),
    );
    const equipment = join(f.project, "devices/equipment.json");
    const source = await readJson(equipment);
    for (const device of source.objects) {
      if (["PLC1", "PS1"].includes(device.designation)) {
        expect(device.location).toBe("MAIN-PANEL");
        device.location = "Main panel";
      }
    }
    await writeJson(equipment, source);
    const stale = await f.check();
    expect(stale.code).toBe(1);
    expect(stale.findings.reasons).toContainEqual({
      path: manifestName,
      code: "source_changed",
    });

    const independent = await makeStandaloneDir(f.project);
    const commands = [
      ["packet", "--input", join(f.project, "packet.json")],
      ["report", "bom"],
      ["report", "terminals"],
      ["view", "M1", "--power"],
    ];
    for (const [index, file] of files.entries()) {
      await mustSucceed(
        await f.cli(...(commands[index] ?? []), "-o", join(independent, file)),
      );
      const fresh = await readFile(join(independent, file));
      expect(fresh.equals(original[index] ?? Buffer.alloc(0)), file).toBe(
        file === "motor.html",
      );
    }
    await mustSucceed(await f.bundle());
    expect((await f.check()).code).toBe(0);
    for (const file of files)
      expect(
        (await readFile(join(f.out, file))).equals(
          await readFile(join(independent, file)),
        ),
        file,
      ).toBe(true);
  });

  it("preserves compact 0.3 title-data and issued registry bindings", async () => {
    const f = await fixture();
    const presentation = join(f.project, "presentation.json");
    await writeJson(presentation, {
      format: "project-presentation/0.3",
      revision: "A",
    });
    const packet = join(f.project, "packet.json");
    await writeJson(packet, {
      format: "schematic-packet-request/0.2",
      views: [reportView("bom")],
      index: true,
      titleData: {
        defaults: { revision: "CURRENT", values: { drawnBy: "Reviewer" } },
      },
    });
    await f.plan({
      kind: "packet",
      input: "packet.json",
      outputs: { json: "packet.json" },
    });
    await mustSucceed(await f.bundle());
    const standalone = join(f.project, "ordinary.json");
    await mustSucceed(
      await f.cli("packet", "--input", packet, "-o", standalone),
    );
    const artifact = join(f.out, "packet.json");
    expect((await readFile(artifact)).equals(await readFile(standalone))).toBe(
      true,
    );
    const previous = await readJson(artifact);
    expect(previous.presentationFormat).toBe("project-presentation/0.3");
    expect(previous.navigation).toBeDefined();
    await writeJson(presentation, {
      format: "project-presentation/0.3",
      revision: "B",
    });
    expect((await f.check()).findings.reasons).toContainEqual({
      path: manifestName,
      code: "source_changed",
    });
    await mustSucceed(await f.bundle());
    expect((await f.check()).code).toBe(0);
    expect((await readJson(artifact)).navigation).not.toEqual(
      previous.navigation,
    );
  });
});
