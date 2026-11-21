import {
  appendFile,
  cp,
  link,
  mkdir,
  readFile,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  fixture,
  manifestName,
  motorPacket,
  mustSucceed,
  readJson,
  reportJob,
  reportView,
  writeJson,
  type Fixture,
} from "./helpers/export-fixture.js";

async function expectReason(
  f: Fixture,
  code: string,
  path?: string,
  flags: string[] = [],
) {
  const result = await f.check(...flags);
  expect(result.code, result.stderr).toBe(1);
  expect(result.findings.fresh).toBe(false);
  expect(result.findings.reasons).toContainEqual(
    expect.objectContaining({ code, ...(path ? { path } : {}) }),
  );
}

it("hashes glob membership and ignores mtime and checkout path", async () => {
  const f = await fixture();
  await f.plan(reportJob("bom"));
  await mustSucceed(await f.bundle());
  const copied = join(f.parent, "relocated");
  await cp(f.project, copied, { recursive: true });
  const result = await f.cliFor(
    copied,
    "export",
    "check",
    "--input",
    join(copied, "delivery.json"),
    "--out-dir",
    join(copied, "drawings"),
  );
  expect(result.code).toBe(0);
  const source = join(f.project, "devices/equipment.json");
  await utimes(source, 30, 30);
  expect((await f.check()).code).toBe(0);
  const extra = join(f.project, "devices/empty.json");
  await writeJson(extra, { objects: [] });
  await expectReason(f, "source_changed", manifestName);
  await mustSucceed(await f.bundle());
  await rm(extra);
  await expectReason(f, "source_changed", manifestName);
});

it("hashes local library and lock bytes and rejects malformed authored JSON and UTF-8", async () => {
  const f = await fixture("report-filtering");
  await f.plan(reportJob("bom"));
  await mustSucceed(await f.bundle());
  for (const name of [
    "library/library.json",
    "library/types.json",
    "electrical-system.lock.json",
  ]) {
    const file = join(f.project, name);
    const original = await readFile(file);
    await appendFile(file, " ");
    await expectReason(f, "source_changed", manifestName);
    await writeFile(file, original);
  }
  const source = join(f.project, "source.json");
  const original = await readFile(source);
  const invalidUtf8 = Buffer.from(original);
  invalidUtf8[original.indexOf("Main")] = 0xff;
  for (const bytes of [
    Buffer.from('{"objects":[],"objects":[]}'),
    Buffer.from('{"objects":['),
    invalidUtf8,
  ]) {
    await writeFile(source, bytes);
    await expectReason(f, "unverifiable_input");
  }
  await writeFile(source, original);
  expect((await f.check()).code).toBe(0);
});

it("detects effective override and raw packet, filter, baseline and delivery request edits", async () => {
  const f = await fixture();
  await mustSucceed(
    await f.cli("snapshot", "-o", join(f.project, "before.json")),
  );
  await motorPacket(f.project, [reportView("bom")]);
  await writeJson(join(f.project, "filter.json"), {
    devices: ["PLC1"],
    locations: ["FIELD"],
  });
  const packet = {
    kind: "packet",
    input: "packet.json",
    page: { size: "a4", orientation: "landscape" },
    outputs: { html: "packet.html" },
  };
  const review = {
    kind: "review",
    before: "before.json",
    outputs: { json: "review.json" },
  };
  await f.plan(packet, reportJob("bom", "filter.json"), review);
  await mustSucceed(await f.bundle());
  const manifest = await readJson(join(f.out, manifestName));
  expect(
    manifest.artifacts.find((item: { path: string }) => item.path === "bom.csv")
      .selection.deviceUids,
  ).toEqual([]);
  expect(await readFile(join(f.out, "bom.csv"), "utf8")).toMatch(/^[^\n]+\n$/u);
  for (const [input, artifact] of [
    ["packet.json", "packet.html"],
    ["filter.json", "bom.csv"],
    ["before.json", "review.json"],
  ]) {
    const file = join(f.project, input);
    const bytes = await readFile(file);
    await appendFile(file, " ");
    await expectReason(f, "request_changed", artifact);
    await writeFile(file, bytes);
  }
  await f.plan(
    { ...packet, index: true },
    reportJob("bom", "filter.json"),
    review,
  );
  await expectReason(f, "request_changed", "packet.html");
  await f.plan(packet, reportJob("bom", "filter.json"), review);
  await appendFile(f.input, " ");
  await expectReason(f, "request_changed", manifestName);
  await rm(join(f.project, "filter.json"));
  await expectReason(f, "unverifiable_input");
});

it("distinguishes tampered, missing, malformed, copied and different-producer artifact records", async () => {
  const f = await fixture();
  await f.plan(reportJob("bom"), reportJob("terminals"));
  await mustSucceed(await f.bundle());
  const manifest = join(f.out, manifestName);
  const original = await readFile(manifest);
  const bom = join(f.out, "bom.csv");
  await appendFile(bom, "tampered");
  await rm(join(f.out, "terminals.csv"));
  await expectReason(f, "byte_mismatch", "bom.csv");
  await expectReason(f, "missing_file", "terminals.csv");
  await rm(manifest);
  await expectReason(f, "missing_manifest", manifestName);
  await writeFile(manifest, "{");
  await expectReason(f, "unverifiable_input", manifestName);
  const altered = JSON.parse(original.toString());
  altered.producer.build = "0".repeat(64);
  await writeJson(manifest, altered);
  await expectReason(f, "producer_mismatch", manifestName);
  altered.artifacts[1] = altered.artifacts[0];
  await writeJson(manifest, altered);
  await expectReason(f, "unverifiable_input", manifestName);
  await mustSucceed(await f.bundle());
  await cp(join(f.out, "terminals.csv"), bom);
  await expectReason(f, "byte_mismatch", "bom.csv");
});

it("checks custom receipts explicitly and binds their export options", async () => {
  const f = await fixture("report-filtering");
  await f.plan(reportJob("wires"));
  await mkdir(f.out);
  const file = join(f.out, "wires.csv");
  await mustSucceed(await f.cli("report", "wires", "-o", file));
  await expectReason(f, "missing_receipt", "wires.csv.receipt.json", [
    "--receipts",
  ]);
  await mustSucceed(await f.cli("report", "wires", "-o", file, "--receipt"));
  expect((await f.check("--receipts")).code).toBe(0);
  await expectReason(f, "missing_manifest", manifestName);
  await writeJson(join(f.project, "scope.json"), { devices: ["PLC1"] });
  await mustSucceed(
    await f.cli(
      "report",
      "wires",
      "--filter",
      join(f.project, "scope.json"),
      "-o",
      file,
      "--receipt",
    ),
  );
  await expectReason(f, "request_changed", "wires.csv", ["--receipts"]);
  await f.plan(reportJob("wires", "scope.json"));
  expect((await f.check("--receipts")).code).toBe(0);
  await appendFile(file, "wrong");
  await expectReason(f, "byte_mismatch", "wires.csv", ["--receipts"]);
  const stdout = await f.cli("diagnostics", "--receipt");
  expect(stdout).toMatchObject({ code: 2, stdout: "" });
  const stdin = await f.cli(
    "packet",
    "--input",
    "-",
    "-o",
    join(f.out, "x.pdf"),
    "--receipt",
  );
  expect(stdin).toMatchObject({ code: 2, stdout: "" });
});

it("rejects ambiguous paths, output collisions, source globs and protected inputs", async () => {
  const f = await fixture();
  const diagnostics = (path: string) => ({
    kind: "diagnostics",
    outputs: { json: path },
  });
  const exercise = async (code: number, ...jobs: unknown[]) => {
    await f.plan(...jobs);
    const result = await f.cli(
      "export",
      "bundle",
      "--input",
      f.input,
      "--out-dir",
      f.project,
    );
    expect(result.code, result.stderr).toBe(code);
    expect(result.stdout).toBe("");
  };
  for (const path of [
    "../escaped.json",
    "/absolute.json",
    "C:/escape.json",
    "folder\\escape.json",
    "folder/../alias.json",
    "folder//alias.json",
    "devices/uncreated.json",
    "system.json",
    "presentation.json",
    "electrical-system.lock.json",
    "delivery.json",
    manifestName,
    "nested/anything.receipt.json",
    ".git/drawing.json",
  ])
    await exercise(1, diagnostics(path));
  await exercise(1, diagnostics("a.json"), diagnostics("A.json"));
  await exercise(1, diagnostics("a.json"), diagnostics("a.json/nested.json"));
  await exercise(1, diagnostics("dir/a.json"), diagnostics("DIR/b.json"));
  await motorPacket(f.project, [reportView("bom")]);
  await exercise(1, {
    kind: "packet",
    input: "../packet.json",
    outputs: { json: "drawing.json" },
  });
  await exercise(1, {
    kind: "packet",
    input: "packet.json",
    outputs: { json: "packet.json" },
  });
  await exercise(1, { ...diagnostics("drawing.json"), typo: true });
  await expect(readFile(join(f.project, manifestName))).rejects.toMatchObject({
    code: "ENOENT",
  });
  const usage = await f.cli("export", "check", "--input", f.input);
  expect(usage.code).toBe(2);
});

it("rejects linked output, request and library paths", async () => {
  const f = await fixture("report-filtering");
  await f.plan(reportJob("bom"));
  await mkdir(f.out);
  const original = join(f.project, "original.csv");
  const target = join(f.out, "bom.csv");
  await writeFile(original, "preserve");
  await link(original, target);
  expect((await f.bundle()).code).toBe(1);
  await rm(target);
  await symlink(original, target, "file");
  expect((await f.bundle()).code).toBe(1);
  await rm(target);
  await symlink(join(f.project, "library"), join(f.out, "linked"), "junction");
  await f.plan({
    kind: "report",
    report: "bom",
    outputs: { csv: "linked/bom.csv" },
  });
  expect((await f.bundle()).code).toBe(1);
  const library = await f.cli(
    "export",
    "bundle",
    "--input",
    f.input,
    "--out-dir",
    join(f.project, "library"),
  );
  expect(library.code).toBe(1);
  await symlink(f.input, join(f.project, "alias.json"), "file");
  await f.plan({
    kind: "report",
    report: "bom",
    filter: "alias.json",
    outputs: { csv: "bom.csv" },
  });
  await expectReason(f, "unverifiable_input");
  expect(await readFile(original, "utf8")).toBe("preserve");
});

it("treats a linked lock as unverifiable even when its bytes match", async () => {
  const f = await fixture("report-filtering");
  await f.plan(reportJob("bom"));
  await mustSucceed(await f.bundle());
  const lock = join(f.project, "electrical-system.lock.json");
  const copy = join(f.parent, "lock-copy.json");
  await cp(lock, copy);
  await rm(lock);
  await link(copy, lock);
  await expectReason(f, "unverifiable_input", "electrical-system.lock.json");
});
