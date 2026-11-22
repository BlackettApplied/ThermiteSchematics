import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { JsonValue } from "../src/common/contracts.js";
import { createSourcePatchPlan } from "../src/source-patch.js";
import {
  createSourceByteProposal,
  createSourceByteProposals,
  serializeSourceValue,
} from "../src/source-serializer.js";
import {
  validateApplySourcePatchRequest,
  type ApplySourcePatchRequest,
} from "../src/source-patch-request.js";

function text(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("utf8");
}

function validatedRequest(request: unknown): ApplySourcePatchRequest {
  const result = validateApplySourcePatchRequest(request);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

describe("D9 canonical source serialization", () => {
  it("uses two spaces, LF, one final newline, and existing property order", () => {
    const bytes = serializeSourceValue({ z: 2, a: 1 });
    expect(text(bytes)).toBe("{\n" + '  "z": 2,\n' + '  "a": 1\n' + "}\n");
    expect(bytes.byteLength).toBe(23);
    expect(text(bytes).endsWith("\n")).toBe(true);
    expect(text(bytes)).not.toContain("\r");
  });

  it("rejects pathological depth before encoding while accepting wide source arrays", () => {
    let deep: JsonValue = null;
    for (let depth = 0; depth < 4100; depth += 1) deep = [deep];
    expect(() => serializeSourceValue(deep)).toThrow(RangeError);
    expect(() => serializeSourceValue(deep)).toThrow(
      "Source serialization depth exceeded.",
    );
    const wide = Array.from({ length: 5000 }, (_, id) => ({ id }));
    expect(JSON.parse(text(serializeSourceValue(wide)))).toEqual(wide);
  });

  it("calculates exact before/after hashes, lengths, and byte-only changed", () => {
    const compact = Buffer.from('{"a":1}\n', "utf8");
    const proposal = createSourceByteProposal({
      path: "a.json",
      rawBytes: compact,
      value: { a: 1 },
    });
    expect(proposal.file).toEqual({
      path: "a.json",
      beforeIntegrity: "sha256-40ZDICGwQXlRjZYU81YMzXE1Sk7hAd3LiT1pWanWMBw=",
      afterIntegrity: "sha256-Xja2VgUTWGztZeyg6LAl/ojtvKuCuiy2el/LLXsgI4M=",
      byteLength: 13,
      changed: true,
    });
    expect(text(proposal.proposalBytes)).toBe("{\n" + '  "a": 1\n' + "}\n");

    const canonical = createSourceByteProposal({
      path: "a.json",
      rawBytes: proposal.proposalBytes,
      value: { a: 1 },
    });
    expect(canonical.file.changed).toBe(false);
    expect(canonical.file.beforeIntegrity).toBe(canonical.file.afterIntegrity);
  });

  it("serializes every target and sorts proposal records by code units", () => {
    const proposals = createSourceByteProposals([
      {
        path: "z.json",
        rawBytes: Buffer.from("{}\n", "utf8"),
        value: { z: true },
      },
      {
        path: "A.json",
        rawBytes: Buffer.from("{}\n", "utf8"),
        value: {},
      },
      {
        path: "a.json",
        rawBytes: Buffer.from("{}\n", "utf8"),
        value: { a: true },
      },
    ]);
    expect(proposals.map(({ file }) => file.path)).toEqual([
      "A.json",
      "a.json",
      "z.json",
    ]);
    expect(proposals).toHaveLength(3);
    expect(proposals.every(Object.isFrozen)).toBe(true);
    expect(proposals.every(({ file }) => Object.isFrozen(file))).toBe(true);
  });
});

describe("D9 all-target proposal consequences", () => {
  it("reports test-only, replace-self, and mutate-restore targets by final bytes", () => {
    const aBytes = Buffer.from('{\n  "a": 1\n}\n', "utf8");
    const zBytes = Buffer.from('{\n  "z": 1\n}\n', "utf8");
    const request = validatedRequest({
      format: "agent-tool-request/0.1",
      project: ".",
      patchFormat: "json-patch/0.1",
      dryRun: true,
      files: [
        {
          path: "z.json",
          expectedIntegrity:
            "sha256-gt8eoT2K98eYm2v5ngjSAt+LlnOuVUiztvC74zneqB8=",
          operations: [
            { op: "replace", path: "/z", value: 2 },
            { op: "replace", path: "/z", value: 1 },
          ],
        },
        {
          path: "a.json",
          expectedIntegrity:
            "sha256-Xja2VgUTWGztZeyg6LAl/ojtvKuCuiy2el/LLXsgI4M=",
          operations: [
            { op: "test", path: "/a", value: 1 },
            { op: "replace", path: "/a", value: 1 },
          ],
        },
      ],
    });
    const result = createSourcePatchPlan(
      request,
      new Map([
        ["z.json", { rawBytes: zBytes, value: { z: 1 } }],
        ["a.json", { rawBytes: aBytes, value: { a: 1 } }],
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposals.map(({ file }) => file)).toEqual([
      {
        path: "a.json",
        beforeIntegrity: "sha256-Xja2VgUTWGztZeyg6LAl/ojtvKuCuiy2el/LLXsgI4M=",
        afterIntegrity: "sha256-Xja2VgUTWGztZeyg6LAl/ojtvKuCuiy2el/LLXsgI4M=",
        byteLength: 13,
        changed: false,
      },
      {
        path: "z.json",
        beforeIntegrity: "sha256-gt8eoT2K98eYm2v5ngjSAt+LlnOuVUiztvC74zneqB8=",
        afterIntegrity: "sha256-gt8eoT2K98eYm2v5ngjSAt+LlnOuVUiztvC74zneqB8=",
        byteLength: 13,
        changed: false,
      },
    ]);
  });

  it("makes a noncanonical semantic no-op changed", () => {
    const rawBytes = Buffer.from('{ "a": 1 }\r\n', "utf8");
    const proposal = createSourceByteProposal({
      path: "noncanonical.json",
      rawBytes,
      value: { a: 1 },
    });
    expect(proposal.file).toEqual({
      path: "noncanonical.json",
      beforeIntegrity: "sha256-Db35hbomBRE1ItrpupbS0QaRcm4oXvcj+yQJSwZXpbI=",
      afterIntegrity: "sha256-Xja2VgUTWGztZeyg6LAl/ojtvKuCuiy2el/LLXsgI4M=",
      byteLength: 13,
      changed: true,
    });
  });

  it("locks the worked 1518-to-1742 test-only field-terminations consequence", async () => {
    const rawBytes = await readFile(
      resolve("examples/motor-starter/connections/field-terminations.json"),
    );
    const value = JSON.parse(text(rawBytes)) as JsonValue;
    const proposal = createSourceByteProposal({
      path: "connections/field-terminations.json",
      rawBytes,
      value,
    });
    expect(rawBytes.byteLength).toBe(1_524);
    expect(proposal.file).toEqual({
      path: "connections/field-terminations.json",
      beforeIntegrity: "sha256-uH5wquZl1n/aAVaxmhG7cdvaUl7sOUBVYKjQOaYKvmE=",
      afterIntegrity: "sha256-IOlMc6BBaa6izb9tbZCqnWaTMXRhcdN8/5elbX2kQIM=",
      byteLength: 1_748,
      changed: true,
    });
    expect(JSON.parse(text(proposal.proposalBytes))).toEqual(value);
  });
});
