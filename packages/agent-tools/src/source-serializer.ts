import { Buffer } from "node:buffer";

import { computeFileIntegrity } from "@thermite/compiler";

import type { JsonValue } from "./common/contracts.js";

export interface AppliedSourceFile {
  readonly path: string;
  readonly beforeIntegrity: string;
  readonly afterIntegrity: string;
  readonly byteLength: number;
  readonly changed: boolean;
}

export interface SourceByteProposal {
  readonly file: AppliedSourceFile;
  readonly proposalBytes: Uint8Array;
}

export interface SourceByteProposalInput {
  readonly path: string;
  readonly rawBytes: Uint8Array;
  readonly value: JsonValue;
}

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export function serializeSourceValue(value: JsonValue): Uint8Array {
  // Native stringify limits differ between JavaScript engines. Reject pathological
  // depth before allocating indentation or staging files, keeping the same sanitized
  // serialization failure on Bun and Node instead of a later compiler failure.
  const pending: { value: JsonValue; depth: number }[] = [{ value, depth: 0 }];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current.depth > 4096)
      throw new RangeError("Source serialization depth exceeded.");
    if (current.value !== null && typeof current.value === "object") {
      for (const child of Object.values(current.value))
        pending.push({ value: child, depth: current.depth + 1 });
    }
  }
  return Buffer.from(`${JSON.stringify(value, undefined, 2)}\n`, "utf8");
}

export function createSourceByteProposal(
  input: SourceByteProposalInput,
): SourceByteProposal {
  const proposalBytes = serializeSourceValue(input.value);
  const file: AppliedSourceFile = Object.freeze({
    path: input.path,
    beforeIntegrity: computeFileIntegrity(input.rawBytes),
    afterIntegrity: computeFileIntegrity(proposalBytes),
    byteLength: proposalBytes.byteLength,
    changed: !bytesEqual(input.rawBytes, proposalBytes),
  });
  return Object.freeze({ file, proposalBytes });
}

export function createSourceByteProposals(
  inputs: readonly SourceByteProposalInput[],
): readonly SourceByteProposal[] {
  return Object.freeze(
    inputs
      .map((input) => createSourceByteProposal(input))
      .sort((left, right) => compareCodeUnits(left.file.path, right.file.path)),
  );
}
