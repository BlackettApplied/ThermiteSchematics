import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { compileProject } from "@thermite/compiler";
import {
  renderSchematicPacket,
  type SchematicPacketRequest,
} from "@thermite/render";
import { expect, it } from "vitest";

const execute = promisify(execFile);
const motorStarter = {
  project: "examples/motor-starter",
  input: "examples/alpha/motor-starter.packet.json",
};
const packetCases = [
  motorStarter,
  {
    project: "examples/network-pagination",
    input: "examples/network-pagination/packet.json",
  },
];

async function expectPacketHtml(project: string, args: string[]) {
  const scratch = await mkdtemp(join(tmpdir(), "thermite-packet-html-"));
  try {
    const cli = [
      resolve("thermite.mjs"),
      ...args,
      "--project",
      resolve(project),
    ];
    const htmlPath = join(scratch, "packet.html");
    const jsonPath = join(scratch, "packet.json");
    await execute(process.execPath, [...cli, "-o", htmlPath]);
    await execute(process.execPath, [...cli, "-o", jsonPath]);
    const standalone = await readFile(htmlPath, "utf8");
    const { html: embedded } = JSON.parse(await readFile(jsonPath, "utf8"));
    expect(standalone.match(/<style data-thermite-font=/gu)).toHaveLength(1);
    expect(embedded.match(/<style data-thermite-font=/gu)).toHaveLength(1);
    expect(embedded === standalone, "embedded and standalone HTML bytes").toBe(
      true,
    );
    return standalone;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

async function renderExamplePacket(project: string, input: string) {
  const compiled = await compileProject(project);
  if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  const request: SchematicPacketRequest = JSON.parse(
    await readFile(input, "utf8"),
  );
  const rendered = await renderSchematicPacket(
    compiled.ir,
    request,
    compiled.presentation,
  );
  if (!rendered.ok) throw Error(rendered.error.message);
  return rendered.value;
}

it.each(packetCases)(
  "shares the printable HTML document between CLI and SDK for $project",
  async ({ project, input }) => {
    const html = await expectPacketHtml(project, ["packet", "--input", input]);
    const packet = await renderExamplePacket(project, input);
    expect(packet.html === html, "SDK and standalone HTML bytes").toBe(true);
  },
);

it("exports the same document in HTML and JSON from view and report", async () => {
  const project = "examples/motor-starter";
  await expectPacketHtml(project, ["view", "M1", "--power"]);
  await expectPacketHtml(project, ["report", "bom"]);
});

it("preserves literal font-marker text across CLI exports and SDK serialization", async () => {
  const project = await mkdtemp(join(tmpdir(), "thermite-font-marker-"));
  try {
    await cp(motorStarter.project, project, { recursive: true });
    const systemPath = join(project, "system.json");
    const system = JSON.parse(await readFile(systemPath, "utf8"));
    const title = "Motor Starter data-thermite-font=1";
    system.project.name = title;
    await writeFile(systemPath, JSON.stringify(system));

    const standalone = await expectPacketHtml(project, [
      "packet",
      "--input",
      motorStarter.input,
    ]);
    expect(standalone).toContain(`<title>${title}</title>`);
    const packet = await renderExamplePacket(project, motorStarter.input);
    const { html } = JSON.parse(JSON.stringify(packet));
    expect(
      html === standalone,
      "serialized SDK and standalone HTML bytes",
    ).toBe(true);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
