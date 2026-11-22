import { describe, expect, it } from "vitest";
import { analyzeCompleteness, compileProject } from "../src/index.js";
import {
  device,
  end,
  node,
  project,
  uid,
  wire,
  type Json,
} from "./validation-fixture.js";

const reason = "Synthetic connection design is pending.";
const cases = [
  ["deferred", "unconnected", ["W905"]],
  ["deferred", "connected", ["W905"]],
  ["intentionally-unused", "unconnected", ["W903", "W905"]],
  [undefined, "unconnected", ["W903"]],
  ["required", "unconnected", ["W903"]],
] as const;
for (const kind of ["terminal", "port", "connector-port"] as const) {
  describe(`required ${kind} completeness (#78)`, () => {
    const states =
      kind === "terminal"
        ? [...cases, ["deferred", "dangling", ["W905"]] as const]
        : cases;
    it.each(states)("%s + %s emits %j", async (status, connection, codes) => {
      const group =
        kind === "terminal"
          ? "terminals"
          : kind === "port"
            ? "ports"
            : "connectorPorts";
      const point =
        kind === "terminal"
          ? {}
          : kind === "port"
            ? { medium: "ethernet", connector: "RJ45" }
            : { connector: "Synthetic connector" };
      const type = {
        ...node(kind === "terminal" ? { p: { required: true }, q: {} } : {}),
        ...(kind === "terminal"
          ? {}
          : { [group]: { p: { ...point, required: true }, q: point } }),
        connectionCoverage: {
          status: "complete",
          notes: "Synthetic interface.",
        },
      };
      const objects: Json[] = [
        {
          ...device(1, "D"),
          ...(status
            ? { connectionReview: { [group]: { p: { status, reason } } } }
            : {}),
        },
      ];
      const types: Json[] = [type];
      if (connection === "connected") {
        if (kind !== "terminal") {
          types.push({
            ...node({}),
            id: "assessment:peer",
            [group]: { q: point },
            connectionCoverage: {
              status: "complete",
              notes: "Synthetic peer.",
            },
          });
          objects.push(device(3, "P", "assessment:peer"));
        }
        objects.push(
          kind === "terminal"
            ? wire(2, end("D", "p"), end("D", "q"))
            : {
                uid: uid(2),
                kind: "relation",
                relation: "associated_with",
                from: { device: "D" },
                to: { device: "P" },
                ...(kind === "port"
                  ? {
                      connection: {
                        medium: "ethernet",
                        protocol: "Synthetic",
                        fromPort: "p",
                        toPort: "q",
                      },
                    }
                  : {
                      assembly: {
                        kind: "cap",
                        fromPort: "p",
                        toPort: "q",
                        status: "documented",
                        pinMapping: {
                          status: "not-applicable",
                          reason: "Synthetic cap.",
                        },
                      },
                    }),
              },
        );
      }
      if (connection === "dangling") {
        types.push({
          kind: "cable_type",
          id: "assessment:cable",
          conductors: [{ id: "1", color: "black" }],
        });
        objects.push({
          uid: uid(2),
          kind: "cable",
          designation: "CBL",
          type: "assessment:cable",
          conductors: [
            { id: "1", endpoints: [end("D", "p"), null], usage: "spare" },
          ],
        });
      }
      const result = await compileProject(await project(objects, types));
      expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
      if (!result.ok) return;
      const report = analyzeCompleteness(result.ir);
      const entry = report.devices[0]!.connections.find((c) => c.key === "p")!;
      expect(entry).toMatchObject({ kind, required: true, connection });
      expect(report.counts.requiredMissing).toBe(
        connection === "connected" ? 0 : 1,
      );
      const findings = report.findings.filter((f) => f.key === "p");
      expect(findings.map((f) => f.code)).toEqual(codes);
      expect(result.diagnostics.map((d) => d.code)).toEqual([...codes].sort());
      if (status === "deferred") {
        const expected =
          connection === "connected"
            ? `D.p has deferred work: ${reason}`
            : `Required ${kind} D.p is ${connection}${connection === "dangling" ? " (has only a cable core with an unfinished far end)" : " (has no connection)"}. Deferred work: ${reason}`;
        expect(findings[0]!.message).toBe(expected);
        expect(result.diagnostics[0]!.related?.[0]!.note).toBe(expected);
      } else {
        expect(findings[0]!.message).toBe(
          `Required ${kind} D.p has no connection.${status ? ` Review: ${status}: ${reason}` : ""}`,
        );
      }
    });
  });
}

it("aggregates mixed deferred and non-deferred required gaps once per device and code", async () => {
  const result = await compileProject(
    await project(
      [
        {
          ...device(1, "D"),
          connectionReview: {
            terminals: {
              L: { status: "deferred", reason: "Feed design is pending." },
              M: {
                status: "deferred",
                reason: "Upstream path remains to be reviewed.",
              },
              R: {
                status: "required",
                reason: "Application requires this point.",
              },
              S: {
                status: "deferred",
                reason: "Optional signal selection is pending.",
              },
              U: {
                status: "intentionally-unused",
                reason: "Synthetic contradictory review.",
              },
            },
          },
        },
        wire(2, end("D", "M"), end("D", "q")),
      ],
      [
        {
          ...node({
            L: { required: true },
            M: { required: true },
            N: { required: true },
            R: {},
            S: {},
            U: { required: true },
            q: {},
          }),
          connectionCoverage: {
            status: "complete",
            notes: "Synthetic mixed review inventory.",
          },
        },
      ],
    ),
  );
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  if (!result.ok) return;
  const report = analyzeCompleteness(result.ir);
  expect(report.counts.requiredMissing).toBe(4);
  expect(report.counts.warnings).toBe(7);
  expect(
    report.findings.filter((f) => f.code === "W903").map((f) => f.key),
  ).toEqual(["N", "R", "U"]);
  expect(
    report.findings.filter((f) => f.code === "W905").map((f) => f.key),
  ).toEqual(["L", "M", "S", "U"]);
  const expected = [
    {
      code: "W903",
      keys: ["N", "R", "U"],
      notes: [
        "Required terminal D.N has no connection.",
        "Required terminal D.R has no connection. Review: required: Application requires this point.",
        "Required terminal D.U has no connection. Review: intentionally-unused: Synthetic contradictory review.",
      ],
    },
    {
      code: "W905",
      keys: ["L", "M", "S", "U"],
      notes: [
        "Required terminal D.L is unconnected (has no connection). Deferred work: Feed design is pending.",
        "D.M has deferred work: Upstream path remains to be reviewed.",
        "D.S has deferred work: Optional signal selection is pending.",
        "D.U is marked intentionally unused but is required. Review: Synthetic contradictory review.",
      ],
    },
  ];
  expect(result.diagnostics).toEqual(
    expected.map(({ code, keys, notes }) => ({
      ...result.ir.devices[0]!.source,
      uid: uid(1),
      code,
      severity: "warning",
      message: `D: ${notes.join(" ")}`,
      related: keys.map((key, i) => {
        const { file, line, column } = result.ir.terminals.find(
          (t) => t.id.terminalKey === key,
        )!.source;
        return { file, line, column, note: notes[i] };
      }),
    })),
  );
});
