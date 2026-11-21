import { it, expect } from "vitest";
import {
  mkdtempSync,
  realpathSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  cleanChecker,
  regeneratePacket,
  comparePacketArtifacts,
  regenerateView,
  pdf,
} from "./artifacts.mjs";
import { locate, documents, objects, read, write } from "./task-support.mjs";
import { snapshot } from "./snapshot.mjs";
import { check } from "./tasks.mjs";
const thermite = fileURLToPath(new URL("../../thermite.mjs", import.meta.url));
function fixture(template) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "eval-artifact-unit-"))),
    project = join(root, "project"),
    evidence = join(root, "evidence");
  mkdirSync(evidence);
  const run = (...args) =>
    spawnSync("bun", [thermite, ...args], { cwd: root, encoding: "utf8" });
  const result = run(
    "init",
    project,
    ...(template === "cabinets" ? ["--template", "cabinets"] : []),
  );
  expect(result.status, result.stderr).toBe(0);
  return {
    root,
    project,
    evidence,
    thermite,
    calls: [],
    run,
    validationDiagnostics: [],
  };
}
it("checker staging omits linked directories", () => {
  if (process.platform === "win32") return;
  const ctx = fixture();
  try {
    const target = join(ctx.root, "outside");
    mkdirSync(target);
    write(join(target, "marker.txt"), "outside");
    rmSync(join(ctx.project, "drawings"), { recursive: true, force: true });
    symlinkSync(target, join(ctx.project, "drawings"));
    const clean = cleanChecker(ctx);
    expect(existsSync(join(clean.project, "drawings", "marker.txt"))).toBe(
      false,
    );
  } finally {
    rmSync(ctx.root, { recursive: true, force: true });
  }
});
it("checker replay refuses a request outside the project", async () => {
  if (process.platform === "win32") return;
  const ctx = fixture();
  try {
    const outside = join(ctx.root, "outside.json");
    write(outside, {});
    ctx.thermite = join(ctx.root, "fixture.mjs");
    const marker = join(ctx.evidence, "replayed");
    writeFileSync(
      ctx.thermite,
      `
      import { writeFileSync } from "node:fs";
      if (process.argv.includes(${JSON.stringify(outside)}))
        writeFileSync(${JSON.stringify(marker)}, "replayed");
      process.exitCode = 1;
    `,
    );
    ctx.calls = [
      {
        argv: ["packet", "--input", outside, "-o", "drawings/packet.json"],
        exit: 0,
      },
    ];
    expect((await regeneratePacket(ctx)).pass).toBe(false);
    expect(existsSync(marker)).toBe(false);
  } finally {
    rmSync(ctx.root, { recursive: true, force: true });
  }
});

it("regeneration rejects forged packet metadata and a header-only unrelated PDF", async () => {
  if (process.platform === "win32") return;
  const ctx = fixture("cabinets");
  try {
    const request = {
      format: "schematic-packet-request/0.1",
      index: true,
      views: [
        { format: "documentation-view-request/0.1", kind: "terminals" },
        { format: "documentation-view-request/0.1", kind: "io" },
      ],
    };
    write(join(ctx.project, "requests/packet.json"), request);
    ctx.calls = ["json", "html", "pdf"].map((ext) => ({
      phase: "agent",
      exit: 0,
      argv: ["packet", "--input", "-", "-o", `drawings/packet.${ext}`],
      request: JSON.stringify(request),
    }));
    expect((await regeneratePacket(ctx)).pass).toBe(false);
    mkdirSync(join(ctx.project, "drawings"), { recursive: true });
    for (const ext of ["json", "pdf"])
      writeFileSync(
        join(ctx.project, `drawings/packet.${ext}`),
        readFileSync(join(ctx.evidence, `regenerated-packet.${ext}`)),
      );
    const original = readFileSync(join(ctx.project, "drawings/packet.json"));
    writeFileSync(
      join(ctx.project, "drawings/packet.html"),
      JSON.parse(original).html,
    );
    expect((await comparePacketArtifacts(ctx)).pass).toBe(true);
    const delivered = join(ctx.project, "drawings/packet.json");
    writeFileSync(delivered, JSON.stringify(JSON.parse(original)));
    expect((await comparePacketArtifacts(ctx)).matches.json).toBe(true);
    expect(
      (await comparePacketArtifacts(ctx, { exactJson: true })).matches.json,
    ).toBe(false);
    const identical = join(ctx.root, "identical.json");
    writeFileSync(identical, readFileSync(delivered));
    rmSync(delivered);
    symlinkSync(identical, delivered);
    expect((await comparePacketArtifacts(ctx)).pass).toBe(false);
    rmSync(delivered);
    writeFileSync(delivered, readFileSync(identical));
    write(join(ctx.project, "drawings/packet.json"), {
      sheets: [
        { view: { kind: "terminals" } },
        { view: { kind: "io" } },
        { view: { intent: "conductors" } },
        { view: { kind: "index" } },
      ],
    });
    // Reuse the already regenerated evidence for independent artifact negatives;
    // this avoids four full PDF layouts in one load-sensitive test.
    expect((await comparePacketArtifacts(ctx)).pass).toBe(false);
    writeFileSync(join(ctx.project, "drawings/packet.json"), original);
    const unrelated = request;
    writeFileSync(
      join(ctx.project, "drawings/cable.pdf"),
      readFileSync(join(ctx.project, "drawings/packet.pdf")),
    );
    ctx.calls.push({
      phase: "agent",
      exit: 0,
      argv: [
        "packet",
        "--input",
        "requests/packet.json",
        "-o",
        "drawings/cable.pdf",
      ],
      request: JSON.stringify(unrelated),
    });
    expect(
      (
        await regenerateView(ctx, "drawings/cable.pdf", [
          "view",
          "CBL1",
          "--conductors",
          "-o",
          "drawings/cable.pdf",
        ])
      ).pass,
    ).toBe(false);
    writeFileSync(
      join(ctx.project, "drawings/packet.pdf"),
      "%PDF-1.4 not a drawing",
    );
    expect(await pdf(join(ctx.project, "drawings/packet.pdf"))).toBe(false);
    expect((await comparePacketArtifacts(ctx)).pass).toBe(false);
  } finally {
    rmSync(ctx.root, { recursive: true, force: true });
  }
  // One regeneration plus the fixed artifact negatives took 11.4 s on Windows check.
}, 24000);
it("manifest globs exclude unlisted source-like JSON used to spoof HMI or provenance", () => {
  const ctx = fixture();
  try {
    write(join(ctx.project, "scratch/unlisted.json"), {
      objects: [
        {
          uid: "11111111-1111-4111-a111-111111111111",
          kind: "device",
          designation: "HMI1",
          type: "bad:missing",
        },
        {
          uid: "22222222-2222-4222-a222-222222222222",
          kind: "device",
          designation: "S1",
          description: "page 2, line 7",
          type: "core:limit-switch-2wire",
        },
      ],
    });
    expect(
      objects(ctx.project).some(
        (o) => o.designation === "HMI1" || o.designation === "S1",
      ),
    ).toBe(false);
    expect(
      documents(ctx.project).every((d) => !d.path.startsWith("scratch/")),
    ).toBe(true);
  } finally {
    rmSync(ctx.root, { recursive: true, force: true });
  }
});
it.each([false, true])(
  "only-label checker requires exactly the label change (extra edit: %s)",
  async (extraEdit) => {
    if (process.platform === "win32") return;
    const ctx = fixture();
    try {
      ctx.task = { id: "T11" };
      ctx.initial = snapshot(ctx.project);
      const before = ctx.run(
        "snapshot",
        "--project",
        ctx.project,
        "-o",
        join(ctx.project, "drawings/before.json"),
      );
      expect(before.status, before.stderr).toBe(0);
      const { file, index } = locate(ctx.project, "W-CTL-001"),
        path = join(ctx.project, file),
        doc = read(path),
        wire = doc.objects[index];
      wire.properties.label = "CONTROL-24V";
      if (extraEdit) wire.description = "extra semantic edit";
      write(path, doc);
      ctx.final = snapshot(ctx.project);
      const result = await check("T11", ctx);
      expect(result.checks.onlyLabel).toBe(!extraEdit);
      expect(result.checks.review).toBe(true);
    } finally {
      rmSync(ctx.root, { recursive: true, force: true });
    }
  },
  12000,
);

it("semantic repair accepts reordered keys", async () => {
  const ctx = fixture();
  try {
    const { file, index } = locate(ctx.project, "W-CTL-001"),
      path = join(ctx.project, file),
      doc = read(path),
      endpoint = doc.objects[index].endpoints.find((e) => e.device === "PLC1");
    endpoint.terminal = "L";
    write(path, doc);
    ctx.initial = snapshot(ctx.project);
    endpoint.terminal = "L+";
    doc.objects = doc.objects.map((o) =>
      Object.fromEntries(Object.entries(o).reverse()),
    );
    write(path, doc);
    ctx.final = snapshot(ctx.project);
    expect((await check("T09a", ctx)).pass).toBe(true);
  } finally {
    rmSync(ctx.root, { recursive: true, force: true });
  }
}, 12000);

for (const provenance of ["p2 line 7", "page 2, line 7", "p2 line7"])
  it(`provenance accepts ${provenance}`, async () => {
    const ctx = fixture();
    try {
      const path = join(ctx.project, "excerpt.json"),
        manifest = read(join(ctx.project, "system.json"));
      manifest.sources.push("excerpt.json");
      write(join(ctx.project, "system.json"), manifest);
      write(path, {
        objects: [
          {
            uid: "11111111-1111-4111-a111-111111111111",
            kind: "device",
            designation: "S1",
            type: "core:limit-switch-2wire",
            description: provenance + "; same contact S2 conflict at line 8",
          },
        ],
      });
      write(
        join(ctx.project, "review-notes.md"),
        "S1/S2 label conflict remains unresolved.",
      );
      expect((await check("T12", ctx)).pass).toBe(true);
    } finally {
      rmSync(ctx.root, { recursive: true, force: true });
    }
  });
