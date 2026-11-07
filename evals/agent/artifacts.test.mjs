import { it, expect } from "vitest";
import {
  mkdtempSync,
  realpathSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  regeneratePacket,
  comparePacketArtifacts,
  regenerateView,
  pdf,
  pdfInfo,
} from "./artifacts.mjs";
import { documents, objects, read, write } from "./task-support.mjs";
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
it("regeneration rejects forged packet metadata and a header-only unrelated PDF", async () => {
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
    for (const ext of ["json", "html", "pdf"])
      writeFileSync(
        join(ctx.project, `drawings/packet.${ext}`),
        readFileSync(join(ctx.evidence, `regenerated-packet.${ext}`)),
      );
    expect((await comparePacketArtifacts(ctx)).pass).toBe(true);
    const original = readFileSync(join(ctx.project, "drawings/packet.json"));
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
}, 12000);
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
it("only-label and semantic repair checks reject extra changes and accept reordered keys", async () => {
  const ctx = fixture();
  try {
    ctx.task = { id: "T11" };
    ctx.initial = snapshot(ctx.project);
    let r = ctx.run(
      "snapshot",
      "--project",
      ctx.project,
      "-o",
      join(ctx.project, "drawings/before.json"),
    );
    expect(r.status).toBe(0);
    const manifest = read(join(ctx.project, "system.json")),
      file = documents(ctx.project).find((d) =>
        d.objects.some((o) => o.designation === "W-CTL-001"),
      ).path,
      path = join(ctx.project, file),
      doc = read(path),
      wire = doc.objects.find((o) => o.designation === "W-CTL-001");
    wire.properties.label = "CONTROL-24V";
    wire.description = "extra semantic edit";
    write(path, doc);
    ctx.final = snapshot(ctx.project);
    const review = ctx.run(
      "review",
      "--project",
      ctx.project,
      "--before",
      join(ctx.project, "drawings/before.json"),
      "--json",
    );
    writeFileSync(join(ctx.project, "drawings/review.json"), review.stdout);
    expect((await check("T11", ctx)).checks.onlyLabel).toBe(false);
    delete wire.description;
    write(path, doc);
    ctx.final = snapshot(ctx.project);
    expect((await check("T11", ctx)).checks.onlyLabel).toBe(true);
    wire.endpoints.find((e) => e.device === "PLC1").terminal = "L";
    write(path, doc);
    ctx.initial = snapshot(ctx.project);
    wire.endpoints.find((e) => e.device === "PLC1").terminal = "L+";
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
