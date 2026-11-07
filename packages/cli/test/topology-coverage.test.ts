import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
const exec = promisify(execFile);

describe("packet topology coverage CLI", () => {
  it("serializes the scoped inventory and every selected assembly/network relation", async () => {
    const result = await exec(
      process.execPath,
      [
        resolve("thermite.mjs"),
        "packet",
        "--project",
        resolve("examples/topology-coverage"),
        "--input",
        resolve("examples/topology-coverage/packet.json"),
        "--json",
      ],
      { maxBuffer: 4 * 1024 * 1024 },
    );
    const packet = JSON.parse(result.stdout),
      t = packet.coverage.topology;
    expect(packet.coverage.scope).toBe("circuit-and-wiring");
    expect(t.format).toBe("schematic-topology-coverage/0.1");
    expect(t.counts.assemblies).toEqual({
      total: 4,
      represented: 4,
      outsideAuditedViews: 0,
    });
    expect(t.counts.communicationLinks).toEqual({
      total: 3,
      represented: 3,
      outsideAuditedViews: 0,
    });
    expect(t.counts.connectorPorts).toEqual({
      total: 11,
      represented: 10,
      outsideAuditedViews: 1,
    });
    expect(t.counts.communicationPorts).toEqual({
      total: 15,
      represented: 6,
      outsideAuditedViews: 9,
    });
    expect(
      JSON.parse(result.stderr).diagnostics.some(
        (d: { code: string }) => d.code === "W903",
      ),
    ).toBe(true);
  });
});
