import { computeFileIntegrity } from "@thermite/compiler";

import type { JsonValue } from "./common/contracts.js";
import {
  createA003Error,
  createA004Error,
  type A002Error,
  type A003Error,
  type A004Error,
} from "./common/errors.js";
import { applyJsonPatch } from "./json-patch.js";
import {
  createSourceByteProposals,
  type SourceByteProposal,
  type SourceByteProposalInput,
} from "./source-serializer.js";
import type {
  ApplySourcePatchRequest,
  SourceFilePatch,
} from "./source-patch-request.js";

export interface SourcePatchTargetSnapshot {
  readonly rawBytes: Uint8Array;
  readonly value: JsonValue;
}

export type SourcePatchPlanResult =
  | {
      readonly ok: true;
      readonly proposals: readonly SourceByteProposal[];
    }
  | {
      readonly ok: false;
      readonly error: A002Error | A003Error | A004Error;
    };

function targetFor(
  targets: ReadonlyMap<string, SourcePatchTargetSnapshot>,
  file: SourceFilePatch,
): SourcePatchTargetSnapshot | undefined {
  return targets.get(file.path);
}

export function createSourcePatchPlan(
  request: ApplySourcePatchRequest,
  targets: ReadonlyMap<string, SourcePatchTargetSnapshot>,
): SourcePatchPlanResult {
  for (const file of request.files) {
    if (targetFor(targets, file) === undefined) {
      return {
        ok: false,
        error: createA003Error(file.path, "not-project-source"),
      };
    }
  }

  for (const file of request.files) {
    const target = targetFor(targets, file)!;
    const actualIntegrity = computeFileIntegrity(target.rawBytes);
    if (file.expectedIntegrity !== actualIntegrity) {
      return {
        ok: false,
        error: createA004Error(
          file.path,
          file.expectedIntegrity,
          actualIntegrity,
        ),
      };
    }
  }

  const proposalInputs: SourceByteProposalInput[] = [];
  for (const file of request.files) {
    const target = targetFor(targets, file)!;
    const patched = applyJsonPatch(file.path, target.value, file.operations);
    if (!patched.ok) return patched;
    proposalInputs.push({
      path: file.path,
      rawBytes: target.rawBytes,
      value: patched.value,
    });
  }

  return {
    ok: true,
    proposals: createSourceByteProposals(proposalInputs),
  };
}
