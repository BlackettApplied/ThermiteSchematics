import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { crc32, deflateSync } from "node:zlib";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  RELEASE_BUILD_ENVIRONMENT,
  assertDirectReleaseEnvironment,
  assertReleaseToolVersions,
  buildFreshRelease,
  createImmutableCompilerHost,
  releaseInputsFromCommit,
  verifyReleaseSourceInputs,
} from "../../../scripts/release-build.mjs";
import {
  MAX_RELEASE_GIT_OBJECT_SIZE,
  materializeFileMap,
  parseGitIndexEntries,
  readGitIndexEntries,
  readGitObject,
  resolveHeadCommit,
  verifyMaterializedFileMap,
} from "../../../scripts/release-common.mjs";
import {
  auditTwinReleaseOutputs,
  buildDisposableReleaseCandidate,
  captureCommittedReleaseAuthorities,
  createDeterministicTar,
} from "../../../scripts/release-package.mjs";
import {
  auditReleaseOutputs,
  safeExtractTarball,
} from "../../../scripts/release-tar-audit.mjs";
import {
  auditStageDeclarationClosure,
  collectThirdPartySource,
} from "../../../scripts/release-third-party-inventory.mjs";
import { verifyPrivateReleaseTarget } from "../../../scripts/verify-private-release-target.mjs";

const repositoryRoot = join(import.meta.dirname, "..", "..", "..");
const sourceCommit = await resolveHeadCommit(repositoryRoot);
const picomatchError =
  "PKG006 Third-party identity 'picomatch@2.3.2' does not match lock key 'node_modules/micromatch/node_modules/picomatch'.";

function expectBuffersIdentical(
  actual: Buffer | undefined,
  expected: Buffer | undefined,
  label: string,
): void {
  if (!Buffer.isBuffer(actual)) {
    throw new TypeError(label + ": actual value is not a Buffer.");
  }
  if (!Buffer.isBuffer(expected)) {
    throw new TypeError(label + ": expected value is not a Buffer.");
  }
  if (actual.byteLength !== expected.byteLength) {
    throw new Error(
      label +
        ": byte lengths differ (" +
        actual.byteLength +
        " !== " +
        expected.byteLength +
        ").",
    );
  }
  if (actual.equals(expected)) return;

  let offset = 0;
  while (actual[offset] === expected[offset]) offset += 1;
  throw new Error(label + ": bytes differ at offset " + offset + ".");
}

function expectByteMapsIdentical(
  actual: ReadonlyMap<string, Buffer> | undefined,
  expected: ReadonlyMap<string, Buffer> | undefined,
  label: string,
): void {
  if (actual === undefined) {
    throw new TypeError(label + ": actual byte map is undefined.");
  }
  if (expected === undefined) {
    throw new TypeError(label + ": expected byte map is undefined.");
  }
  const actualPaths = [...actual.keys()].sort();
  const expectedPaths = [...expected.keys()].sort();
  expect(actualPaths, label + ": path sets differ").toEqual(expectedPaths);
  for (const path of expectedPaths) {
    expectBuffersIdentical(
      actual.get(path),
      expected.get(path),
      label + ": " + path,
    );
  }
}

function expectByteMapArraysIdentical(
  actual: readonly ReadonlyMap<string, Buffer>[],
  expected: readonly ReadonlyMap<string, Buffer>[] | undefined,
  label: string,
): void {
  if (expected === undefined) {
    throw new TypeError(label + ": expected byte-map array is undefined.");
  }
  expect(actual, label + ": map counts differ").toHaveLength(expected.length);
  for (let index = 0; index < expected.length; index += 1) {
    expectByteMapsIdentical(
      actual[index],
      expected[index],
      label + "[" + index + "]",
    );
  }
}

function expectDeterministicTarResultsIdentical(
  actual: Awaited<ReturnType<typeof createDeterministicTar>>,
  expected: Awaited<ReturnType<typeof createDeterministicTar>> | undefined,
  label: string,
): void {
  if (expected === undefined) {
    throw new TypeError(label + ": expected tar result is undefined.");
  }
  expect(Object.keys(actual).sort(), label + ": result keys differ").toEqual(
    Object.keys(expected).sort(),
  );
  expectBuffersIdentical(actual.gzip, expected.gzip, label + ": gzip");
  expect(actual.headers, label + ": headers differ").toEqual(expected.headers);
  expect(actual.stageFiles, label + ": stage files differ").toEqual(
    expected.stageFiles,
  );
}

function expectReleaseOutputMapsIdentical(
  actual: ReadonlyMap<string, Buffer | string> | undefined,
  expected: ReadonlyMap<string, Buffer | string> | undefined,
  label: string,
): void {
  if (actual === undefined) {
    throw new TypeError(label + ": actual release-output map is undefined.");
  }
  if (expected === undefined) {
    throw new TypeError(label + ": expected release-output map is undefined.");
  }
  const actualPaths = [...actual.keys()].sort();
  const expectedPaths = [...expected.keys()].sort();
  expect(actualPaths, label + ": path sets differ").toEqual(expectedPaths);
  for (const path of expectedPaths) {
    const actualValue = actual.get(path);
    const expectedValue = expected.get(path);
    if (Buffer.isBuffer(actualValue) && Buffer.isBuffer(expectedValue)) {
      expectBuffersIdentical(actualValue, expectedValue, label + ": " + path);
    } else if (
      typeof actualValue === "string" &&
      typeof expectedValue === "string"
    ) {
      expect(actualValue, label + ": " + path + " differs").toBe(expectedValue);
    } else {
      throw new TypeError(label + ": value types differ at " + path + ".");
    }
  }
}

function expectAuditResultsIdentical(
  actual: Awaited<ReturnType<typeof auditReleaseOutputs>>,
  expected: Awaited<ReturnType<typeof auditReleaseOutputs>>,
  label: string,
): void {
  expect(Object.keys(actual).sort(), label + ": result keys differ").toEqual(
    Object.keys(expected).sort(),
  );
  expect(actual.artifactSha, label + ": artifact SHA differs").toBe(
    expected.artifactSha,
  );
  expect(
    Object.keys(actual.parsed).sort(),
    label + ": parsed keys differ",
  ).toEqual(Object.keys(expected.parsed).sort());
  expect(actual.parsed.entries, label + ": tar entries differ").toEqual(
    expected.parsed.entries,
  );
  expectByteMapsIdentical(
    actual.parsed.files,
    expected.parsed.files,
    label + ": parsed files",
  );
  expect(actual.headers, label + ": headers differ").toEqual(expected.headers);
  expect(actual.stageFiles, label + ": stage files differ").toEqual(
    expected.stageFiles,
  );
  expect(actual.closure, label + ": closure differs").toEqual(expected.closure);
  expect(actual.licenses, label + ": licenses differ").toEqual(
    expected.licenses,
  );
  expect(actual.provenance, label + ": provenance differs").toEqual(
    expected.provenance,
  );
}

function installedPath(modulesRoot: string, lockKey: string, path: string) {
  return join(
    modulesRoot,
    ...lockKey.slice("node_modules/".length).split("/"),
    ...path.split("/"),
  );
}

async function copyRecordedThirdPartyTree(
  modulesRoot: string,
  inventory: {
    packages: {
      lockKey: string;
      files: { path: string }[];
    }[];
  },
) {
  await mkdir(modulesRoot);
  for (const package_ of inventory.packages) {
    for (const file of package_.files) {
      const destination = installedPath(
        modulesRoot,
        package_.lockKey,
        file.path,
      );
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(
        join(
          repositoryRoot,
          "node_modules",
          ...package_.lockKey.slice("node_modules/".length).split("/"),
          ...file.path.split("/"),
        ),
        destination,
      );
    }
  }
}

function shellWithoutCommentsAndHeredocs(source: string): string {
  const activeLines: string[] = [];
  const pendingHeredocs: { delimiter: string; stripTabs: boolean }[] = [];
  for (const line of source.split("\n")) {
    const pending = pendingHeredocs[0];
    if (pending !== undefined) {
      const candidate = pending.stripTabs ? line.replace(/^\t+/u, "") : line;
      if (candidate === pending.delimiter) {
        expect(line).not.toContain("\t");
        pendingHeredocs.shift();
      }
      activeLines.push("");
      continue;
    }

    let code = "";
    let quote: "single" | "double" | undefined;
    let escaped = false;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      if (escaped) {
        code += character;
        escaped = false;
        continue;
      }
      if (quote === "single") {
        code += character;
        if (character === "'") quote = undefined;
        continue;
      }
      if (quote === "double") {
        code += character;
        if (character?.charCodeAt(0) === 0x5c) escaped = true;
        else if (character === '"') quote = undefined;
        continue;
      }
      if (character === "'") {
        quote = "single";
        code += character;
        continue;
      }
      if (character === '"') {
        quote = "double";
        code += character;
        continue;
      }
      if (
        character === "#" &&
        (index === 0 || /[\s;&|()]/u.test(line[index - 1] ?? ""))
      ) {
        break;
      }
      if (
        character === "<" &&
        line[index + 1] === "<" &&
        line[index + 2] !== "<"
      ) {
        let cursor = index + 2;
        let stripTabs = false;
        if (line[cursor] === "-") {
          stripTabs = true;
          cursor += 1;
        }
        while (line[cursor] === " " || line[cursor] === "\t") cursor += 1;
        const delimiterQuote =
          line[cursor] === "'" || line[cursor] === '"'
            ? line[cursor]
            : undefined;
        if (delimiterQuote !== undefined) cursor += 1;
        const delimiterStart = cursor;
        if (delimiterQuote === undefined) {
          while (
            cursor < line.length &&
            !/[\s;&|()<>]/u.test(line[cursor] ?? "")
          ) {
            cursor += 1;
          }
        } else {
          while (cursor < line.length && line[cursor] !== delimiterQuote) {
            cursor += 1;
          }
        }
        const delimiter = line.slice(delimiterStart, cursor);
        expect(delimiter).not.toBe("");
        expect(delimiter).not.toMatch(/[\t\r]/u);
        if (delimiterQuote !== undefined) {
          expect(line[cursor]).toBe(delimiterQuote);
        }
        pendingHeredocs.push({ delimiter, stripTabs });
      }
      code += character;
    }
    activeLines.push(code);
  }
  expect(pendingHeredocs).toEqual([]);
  return activeLines.join("\n");
}

function assertInProcessLauncherSyntax(source: string): void {
  const code = shellWithoutCommentsAndHeredocs(source);
  const substitutions: string[] = [];
  let doubleBrackets = 0;
  let quote: "single" | "double" | undefined;
  let escaped = false;
  let tokens = "";
  for (let index = 0; index < code.length; index += 1) {
    const character = code[index];
    if (escaped) {
      escaped = false;
      tokens += " ";
      continue;
    }
    if (quote === "single") {
      if (character === "'") quote = undefined;
      tokens += " ";
      continue;
    }
    if (quote === "double") {
      if (character?.charCodeAt(0) === 0x5c) escaped = true;
      else if (character === '"') quote = undefined;
      tokens += " ";
      continue;
    }
    if (character === "'") {
      quote = "single";
      tokens += " ";
    } else if (character === '"') {
      quote = "double";
      tokens += " ";
    } else if (
      (character === "$" || character === "<") &&
      code[index + 1] === "("
    ) {
      substitutions.push(character + "(");
      tokens += "  ";
      index += 1;
    } else if (character === ")" && substitutions.length !== 0) {
      substitutions.pop();
      tokens += " ";
    } else if (character === "[" && code[index + 1] === "[") {
      doubleBrackets += 1;
      tokens += "  ";
      index += 1;
    } else if (character === "]" && code[index + 1] === "]") {
      expect(doubleBrackets).toBeGreaterThan(0);
      doubleBrackets -= 1;
      tokens += "  ";
      index += 1;
    } else {
      tokens += character;
    }
  }
  expect(escaped).toBe(false);
  expect(quote).toBeUndefined();
  expect(substitutions).toEqual([]);
  expect(doubleBrackets).toBe(0);

  const blocks: { kind: "if" | "loop" | "case"; body: boolean }[] = [];
  for (const match of tokens.matchAll(
    /\b(?:if|then|elif|fi|for|while|do|done|case|esac)\b/gu,
  )) {
    const token = match[0];
    const current = blocks.at(-1);
    if (token === "if") blocks.push({ kind: "if", body: false });
    else if (token === "then") {
      expect(current?.kind).toBe("if");
      current.body = true;
    } else if (token === "elif") {
      expect(current).toMatchObject({ kind: "if", body: true });
      current.body = false;
    } else if (token === "fi") {
      expect(blocks.pop()).toMatchObject({ kind: "if", body: true });
    } else if (token === "for" || token === "while") {
      blocks.push({ kind: "loop", body: false });
    } else if (token === "do") {
      expect(current?.kind).toBe("loop");
      current.body = true;
    } else if (token === "done") {
      expect(blocks.pop()).toMatchObject({ kind: "loop", body: true });
    } else if (token === "case") {
      blocks.push({ kind: "case", body: true });
    } else {
      expect(blocks.pop()?.kind).toBe("case");
    }
  }
  expect(blocks).toEqual([]);
}

function mutateSeamSnapshot(
  value: unknown,
  counts: { maps: number; buffers: number; objects: number },
  seen = new Set<object>(),
): void {
  if (Buffer.isBuffer(value)) {
    value.fill(0x78);
    counts.buffers += 1;
    return;
  }
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (value instanceof Map) {
    counts.maps += 1;
    for (const entry of value.values()) mutateSeamSnapshot(entry, counts, seen);
    value.set(
      "package/UNINVENTORIED-SEAM-MUTATION.txt",
      Buffer.from("seam mutation\n"),
    );
    return;
  }
  counts.objects += 1;
  if (Array.isArray(value)) {
    for (const entry of value) mutateSeamSnapshot(entry, counts, seen);
    Object.assign(value, { seamMutation: true });
    return;
  }
  for (const entry of Object.values(value)) {
    mutateSeamSnapshot(entry, counts, seen);
  }
  Object.assign(value, { seamMutation: true });
}

function gitSha1(bytes: Uint8Array) {
  return createHash("sha1").update(bytes).digest();
}

function gitObjectId(type: string, bytes: Uint8Array) {
  return gitSha1(
    Buffer.concat([
      Buffer.from(`${type} ${bytes.byteLength}\0`),
      Buffer.from(bytes),
    ]),
  ).toString("hex");
}

async function createSyntheticRepository(prefix: string) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(root, ".git", "objects", "info"), { recursive: true });
  return root;
}

async function writeLooseObject(
  repository: string,
  type: string,
  body: Buffer,
  storedObjectId = gitObjectId(type, body),
) {
  const canonical = Buffer.concat([
    Buffer.from(`${type} ${body.byteLength}\0`),
    body,
  ]);
  await writeLooseStorage(repository, storedObjectId, deflateSync(canonical));
  return storedObjectId;
}

async function writeLooseStorage(
  repository: string,
  storedObjectId: string,
  compressed: Buffer,
) {
  const path = join(
    repository,
    ".git",
    "objects",
    storedObjectId.slice(0, 2),
    storedObjectId.slice(2),
  );
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, compressed);
}

function encodePackHeader(type: number, inputSize: number) {
  let size = inputSize;
  const bytes = [(type << 4) | (size & 0x0f)];
  size = Math.floor(size / 16);
  while (size !== 0) {
    bytes[bytes.length - 1] |= 0x80;
    bytes.push(size & 0x7f);
    size = Math.floor(size / 128);
  }
  return Buffer.from(bytes);
}

function encodeDeltaSize(input: number) {
  let value = input;
  const bytes = [];
  do {
    let byte = value & 0x7f;
    value = Math.floor(value / 128);
    if (value !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (value !== 0);
  return Buffer.from(bytes);
}

function appendDelta(base: Buffer, suffix: Buffer) {
  if (base.byteLength > 0xff || suffix.byteLength > 0x7f) {
    throw new Error("Synthetic delta fixture exceeds its one-byte encoding.");
  }
  return Buffer.concat([
    encodeDeltaSize(base.byteLength),
    encodeDeltaSize(base.byteLength + suffix.byteLength),
    Buffer.from([0x90, base.byteLength, suffix.byteLength]),
    suffix,
  ]);
}

function encodeOffsetDistance(input: number) {
  let value = input;
  const bytes = [value & 0x7f];
  while ((value = Math.floor(value / 128)) !== 0) {
    value -= 1;
    bytes.push(0x80 | (value & 0x7f));
  }
  return Buffer.from(bytes.reverse());
}

type PackedFixtureEntry = {
  objectId: string;
  offset: number;
  packed: Buffer;
};

function createPackIndex(entries: PackedFixtureEntry[], packChecksum: Buffer) {
  const sorted = [...entries].sort((left, right) =>
    Buffer.compare(
      Buffer.from(left.objectId, "hex"),
      Buffer.from(right.objectId, "hex"),
    ),
  );
  const headerLength = 8 + 256 * 4;
  const namesLength = sorted.length * 20;
  const crcLength = sorted.length * 4;
  const offsetsLength = sorted.length * 4;
  const bytes = Buffer.alloc(
    headerLength + namesLength + crcLength + offsetsLength + 40,
  );
  Buffer.from([0xff, 0x74, 0x4f, 0x63]).copy(bytes, 0);
  bytes.writeUInt32BE(2, 4);
  for (let fanout = 0; fanout < 256; fanout += 1) {
    bytes.writeUInt32BE(
      sorted.filter(
        (entry) => Number.parseInt(entry.objectId.slice(0, 2), 16) <= fanout,
      ).length,
      8 + fanout * 4,
    );
  }
  const namesStart = headerLength;
  const crcStart = namesStart + namesLength;
  const offsetsStart = crcStart + crcLength;
  sorted.forEach((entry, index) => {
    Buffer.from(entry.objectId, "hex").copy(bytes, namesStart + index * 20);
    bytes.writeUInt32BE(crc32(entry.packed) >>> 0, crcStart + index * 4);
    bytes.writeUInt32BE(entry.offset, offsetsStart + index * 4);
  });
  const trailerStart = offsetsStart + offsetsLength;
  packChecksum.copy(bytes, trailerStart);
  gitSha1(bytes.subarray(0, trailerStart + 20)).copy(bytes, trailerStart + 20);
  return bytes;
}

function createIndexFixture({
  version = 2,
  path = "packages/schema/src/index.ts",
  pathBytes = Buffer.from(path),
  signature = Buffer.from("DIRC"),
  extensions = [],
  primaryFlags = 0,
  extendedFlags,
  declaredLength,
  corruptPadding = false,
}: {
  version?: number;
  path?: string;
  pathBytes?: Buffer;
  signature?: Buffer;
  extensions?: { signature: string | Buffer; bytes?: Buffer }[];
  primaryFlags?: number;
  extendedFlags?: number;
  declaredLength?: number;
  corruptPadding?: boolean;
} = {}) {
  const hasExtended = version === 3 && (primaryFlags & 0x4000) !== 0;
  const fixedLength = 62 + (hasExtended ? 2 : 0);
  const rawLength = fixedLength + pathBytes.byteLength + 1;
  const paddedLength = Math.ceil(rawLength / 8) * 8;
  const entry = Buffer.alloc(paddedLength);
  entry.writeUInt32BE(0o100644, 24);
  Buffer.alloc(20, 0x33).copy(entry, 40);
  entry.writeUInt16BE(
    primaryFlags | (declaredLength ?? Math.min(pathBytes.byteLength, 0x0fff)),
    60,
  );
  if (hasExtended) entry.writeUInt16BE(extendedFlags ?? 0, 62);
  pathBytes.copy(entry, fixedLength);
  if (corruptPadding) entry[fixedLength + pathBytes.byteLength + 1] = 1;
  const header = Buffer.alloc(12);
  signature.copy(header, 0);
  header.writeUInt32BE(version, 4);
  header.writeUInt32BE(1, 8);
  const extensionBytes = extensions.map((extension) => {
    const data = extension.bytes ?? Buffer.alloc(0);
    const header = Buffer.alloc(8);
    Buffer.from(extension.signature).copy(header, 0);
    header.writeUInt32BE(data.byteLength, 4);
    return Buffer.concat([header, data]);
  });
  const content = Buffer.concat([header, entry, ...extensionBytes]);
  return Buffer.concat([content, gitSha1(content)]);
}

async function writeRawLooseObject(repository: string, inflated: Buffer) {
  const objectId = gitSha1(inflated).toString("hex");
  await writeLooseStorage(repository, objectId, deflateSync(inflated));
  return objectId;
}

async function writePackedFixture(
  repository: string,
  packedObjects: { objectId: string; packed: Buffer }[],
  signature = Buffer.from("PACK"),
) {
  const packHeader = Buffer.alloc(12);
  signature.copy(packHeader, 0);
  packHeader.writeUInt32BE(2, 4);
  packHeader.writeUInt32BE(packedObjects.length, 8);
  let offset = packHeader.byteLength;
  const entries = packedObjects.map((object) => {
    const entry = { ...object, offset };
    offset += object.packed.byteLength;
    return entry;
  });
  const packContent = Buffer.concat([
    packHeader,
    ...entries.map(({ packed }) => packed),
  ]);
  const packChecksum = gitSha1(packContent);
  const packRoot = join(repository, ".git", "objects", "pack");
  await mkdir(packRoot, { recursive: true });
  const stem = `pack-${packChecksum.toString("hex")}`;
  await writeFile(
    join(packRoot, `${stem}.pack`),
    Buffer.concat([packContent, packChecksum]),
  );
  await writeFile(
    join(packRoot, `${stem}.idx`),
    createPackIndex(entries, packChecksum),
  );
}

async function writeSyntheticPack(
  repository: string,
  {
    corruptRefDelta = false,
    signature = Buffer.from("PACK"),
  }: { corruptRefDelta?: boolean; signature?: Buffer } = {},
) {
  const base = Buffer.from("base-value");
  const ofsSuffix = Buffer.from("-ofs");
  const ofs = Buffer.concat([base, ofsSuffix]);
  const refSuffix = Buffer.from("-ref");
  const ref = Buffer.concat([ofs, refSuffix]);
  const baseId = gitObjectId("blob", base);
  const ofsId = gitObjectId("blob", ofs);
  const refId = gitObjectId("blob", ref);
  const tree = Buffer.concat([
    Buffer.from("100644 payload.txt\0"),
    Buffer.from(refId, "hex"),
  ]);
  const treeId = gitObjectId("tree", tree);
  const commit = Buffer.from(
    `tree ${treeId}\nauthor Fixture <fixture@example.invalid> 0 +0000\ncommitter Fixture <fixture@example.invalid> 0 +0000\n\nsynthetic pack\n`,
  );
  const commitId = gitObjectId("commit", commit);

  const packHeader = Buffer.alloc(12);
  signature.copy(packHeader, 0);
  packHeader.writeUInt32BE(2, 4);
  packHeader.writeUInt32BE(5, 8);
  const entries: PackedFixtureEntry[] = [];
  let offset = packHeader.byteLength;
  function add(object: Omit<PackedFixtureEntry, "offset">) {
    entries.push({ ...object, offset });
    offset += object.packed.byteLength;
  }
  add({
    objectId: baseId,
    packed: Buffer.concat([
      encodePackHeader(3, base.byteLength),
      deflateSync(base),
    ]),
  });
  const baseOffset = entries[0].offset;
  const ofsOffset = offset;
  const ofsDelta = appendDelta(base, ofsSuffix);
  add({
    objectId: ofsId,
    packed: Buffer.concat([
      encodePackHeader(6, ofsDelta.byteLength),
      encodeOffsetDistance(ofsOffset - baseOffset),
      deflateSync(ofsDelta),
    ]),
  });
  const refDelta = appendDelta(ofs, refSuffix);
  add({
    objectId: refId,
    packed: Buffer.concat([
      encodePackHeader(7, refDelta.byteLength),
      Buffer.from(ofsId, "hex"),
      corruptRefDelta ? Buffer.from([0]) : deflateSync(refDelta),
    ]),
  });
  add({
    objectId: treeId,
    packed: Buffer.concat([
      encodePackHeader(2, tree.byteLength),
      deflateSync(tree),
    ]),
  });
  add({
    objectId: commitId,
    packed: Buffer.concat([
      encodePackHeader(1, commit.byteLength),
      deflateSync(commit),
    ]),
  });

  const packContent = Buffer.concat([
    packHeader,
    ...entries.map(({ packed }) => packed),
  ]);
  const packChecksum = gitSha1(packContent);
  const pack = Buffer.concat([packContent, packChecksum]);
  const index = createPackIndex(entries, packChecksum);
  const packRoot = join(repository, ".git", "objects", "pack");
  await mkdir(packRoot, { recursive: true });
  const stem = `pack-${packChecksum.toString("hex")}`;
  await writeFile(join(packRoot, `${stem}.pack`), pack);
  await writeFile(join(packRoot, `${stem}.idx`), index);
  return {
    ids: {
      base: baseId,
      ofs: ofsId,
      ref: refId,
      tree: treeId,
      commit: commitId,
    },
    bodies: { base, ofs, ref, tree, commit },
  };
}

describe("in-process Git object store", () => {
  it("resolves detached and packed branch HEAD refs and rejects branch peel lines", async () => {
    const repository = await createSyntheticRepository(
      "thermite-schematics-head-ref-test-",
    );
    const detached = "1111111111111111111111111111111111111111";
    const branch = "2222222222222222222222222222222222222222";
    const peeledTag = "3333333333333333333333333333333333333333";
    try {
      await writeFile(join(repository, ".git", "HEAD"), `${detached}\n`);
      await expect(resolveHeadCommit(repository)).resolves.toBe(detached);

      await writeFile(
        join(repository, ".git", "HEAD"),
        "ref: refs/heads/main\n",
      );
      await writeFile(
        join(repository, ".git", "packed-refs"),
        `# pack-refs with: peeled\n${detached} refs/tags/v1\n^${peeledTag}\n${branch} refs/heads/main\n`,
      );
      await expect(resolveHeadCommit(repository)).resolves.toBe(branch);

      await writeFile(
        join(repository, ".git", "packed-refs"),
        `${branch} refs/heads/main\n^${peeledTag}\n`,
      );
      await expect(resolveHeadCommit(repository)).rejects.toThrow(
        "REL024 Git repository metadata is invalid: packed-refs has an invalid peel line.",
      );
    } finally {
      await rm(repository, { recursive: true, force: false });
    }
  });

  it("reads synthetic loose objects and rejects loose-object hash mismatches", async () => {
    const repository = await createSyntheticRepository(
      "thermite-schematics-loose-object-test-",
    );
    try {
      const body = Buffer.from("synthetic loose blob\n");
      const id = await writeLooseObject(repository, "blob", body);
      const object = await readGitObject(repository, id);
      expect(Object.keys(object).sort()).toEqual(["bytes", "type"]);
      expect(object.type).toBe("blob");
      expectBuffersIdentical(object.bytes, body, "loose Git object");

      const wrongId = "1111111111111111111111111111111111111111";
      await writeLooseObject(repository, "blob", body, wrongId);
      await expect(readGitObject(repository, wrongId)).rejects.toThrow(
        `REL029 Git object hash mismatch: ${wrongId}.`,
      );
    } finally {
      await rm(repository, { recursive: true, force: false });
    }
  });

  it("uses distinct codes for unknown, type, malformed, and inflate failures", async () => {
    const repository = await createSyntheticRepository(
      "thermite-schematics-object-errors-test-",
    );
    const unknownId = "4444444444444444444444444444444444444444";
    const malformedId = "5555555555555555555555555555555555555555";
    const inflateId = "6666666666666666666666666666666666666666";
    try {
      await expect(readGitObject(repository, unknownId)).rejects.toThrow(
        `REL025 Git object is unknown: ${unknownId}.`,
      );
      await expect(
        releaseInputsFromCommit({
          repositoryRoot: repository,
          sourceCommit: unknownId,
          objectReader: async () => ({
            type: "blob",
            bytes: Buffer.from("not a commit"),
          }),
        }),
      ).rejects.toThrow(
        `REL026 Git object type mismatch: expected commit; found blob for ${unknownId}.`,
      );

      await writeLooseStorage(
        repository,
        malformedId,
        deflateSync(Buffer.from("blob 5\0x")),
      );
      await expect(readGitObject(repository, malformedId)).rejects.toThrow(
        "REL027 Git object data is truncated or malformed:",
      );
      await writeLooseStorage(repository, inflateId, Buffer.from([0]));
      await expect(readGitObject(repository, inflateId)).rejects.toThrow(
        "REL028 Git object inflate failed:",
      );
    } finally {
      await rm(repository, { recursive: true, force: false });
    }
  });

  it("reconstructs OFS_DELTA and REF_DELTA objects from a synthetic v2 pack and rejects corruption", async () => {
    const repository = await createSyntheticRepository(
      "thermite-schematics-pack-object-test-",
    );
    const corruptRepository = await createSyntheticRepository(
      "thermite-schematics-corrupt-pack-object-test-",
    );
    try {
      const fixture = await writeSyntheticPack(repository);
      for (const name of ["base", "ofs", "ref", "tree", "commit"] as const) {
        const expectedType =
          name === "tree" ? "tree" : name === "commit" ? "commit" : "blob";
        const object = await readGitObject(repository, fixture.ids[name]);
        expect(Object.keys(object).sort()).toEqual(["bytes", "type"]);
        expect(object.type).toBe(expectedType);
        expectBuffersIdentical(
          object.bytes,
          fixture.bodies[name],
          "packed Git object " + name,
        );
      }

      const corrupt = await writeSyntheticPack(corruptRepository, {
        corruptRefDelta: true,
      });
      await expect(
        readGitObject(corruptRepository, corrupt.ids.ref),
      ).rejects.toThrow("REL028 Git object inflate failed:");
    } finally {
      await rm(repository, { recursive: true, force: false });
      await rm(corruptRepository, { recursive: true, force: false });
    }
  });

  it("rejects malformed v2 and v3 Git indexes and unsafe paths", () => {
    expect(() =>
      parseGitIndexEntries(
        createIndexFixture({ version: 2, primaryFlags: 0x4000 }),
      ),
    ).toThrow("a version-2 entry sets the extended flag");
    expect(() =>
      parseGitIndexEntries(
        createIndexFixture({
          version: 3,
          primaryFlags: 0x4000,
          extendedFlags: 0x0001,
        }),
      ),
    ).toThrow("a version-3 entry sets a reserved flag");
    expect(() =>
      parseGitIndexEntries(createIndexFixture({ declaredLength: 0x0fff })),
    ).toThrow("a 0xFFF pathname length represents fewer than 4095 bytes");
    expect(() =>
      parseGitIndexEntries(createIndexFixture({ corruptPadding: true })),
    ).toThrow("an entry has nonzero padding");

    const badTrailer = createIndexFixture();
    badTrailer[badTrailer.byteLength - 1] ^= 0xff;
    expect(() => parseGitIndexEntries(badTrailer)).toThrow(
      "the trailing SHA-1 checksum does not match",
    );
    for (const unsafePath of [
      "../outside.ts",
      ".GiT/config",
      "C:/outside.ts",
      "packages/C:/outside.ts",
      "packages/schema/src/../../../../outside.ts",
    ]) {
      expect(() =>
        parseGitIndexEntries(createIndexFixture({ path: unsafePath })),
      ).toThrow("REL034 Git index is invalid: unsafe entry path");
    }
  });
  it("rejects required and malformed index extensions while skipping optional extensions", () => {
    const baseline = parseGitIndexEntries(createIndexFixture());
    for (const signature of ["link", "sdir", "zzzz"]) {
      expect(() =>
        parseGitIndexEntries(
          createIndexFixture({ extensions: [{ signature }] }),
        ),
      ).toThrow("REL034 Git index is invalid:");
    }
    expect(
      parseGitIndexEntries(
        createIndexFixture({
          extensions: [
            { signature: "TREE", bytes: Buffer.from("tree-data") },
            { signature: "REUC", bytes: Buffer.from("resolve-undo") },
            { signature: "UNTR", bytes: Buffer.from("untracked-cache") },
            { signature: "Test", bytes: Buffer.from("optional-extension") },
          ],
        }),
      ),
    ).toEqual(baseline);
    for (const signature of [
      Buffer.from("TR3E"),
      Buffer.from([0xd4, 0x52, 0x45, 0x45]),
    ]) {
      expect(() =>
        parseGitIndexEntries(
          createIndexFixture({ extensions: [{ signature }] }),
        ),
      ).toThrow("REL034 Git index is invalid:");
    }
  });

  it("compares index and pack signatures byte-exactly and rejects non-ASCII index paths", async () => {
    expect(() =>
      parseGitIndexEntries(
        createIndexFixture({
          signature: Buffer.from([0xc4, 0xc9, 0xd2, 0xc3]),
        }),
      ),
    ).toThrow("REL034 Git index is invalid: the signature is not DIRC.");
    expect(() =>
      parseGitIndexEntries(
        createIndexFixture({
          pathBytes: Buffer.from([
            ...Buffer.from("packages/schema/src/"),
            0xc3,
            0xa9,
            ...Buffer.from(".ts"),
          ]),
        }),
      ),
    ).toThrow(
      "REL034 Git index is invalid: an entry pathname is not 7-bit clean.",
    );

    const repository = await createSyntheticRepository(
      "thermite-schematics-pack-signature-test-",
    );
    try {
      const fixture = await writeSyntheticPack(repository, {
        signature: Buffer.from([0xd0, 0xc1, 0xc3, 0xcb]),
      });
      await expect(
        readGitObject(repository, fixture.ids.commit),
      ).rejects.toThrow("REL027 Git object data is truncated or malformed:");
    } finally {
      await rm(repository, { recursive: true, force: false });
    }
  });

  it("rejects high-bit and non-canonical loose, tree, and commit structural fields", async () => {
    const repository = await createSyntheticRepository(
      "thermite-schematics-structural-object-test-",
    );
    try {
      for (const inflated of [
        Buffer.concat([
          Buffer.from([0xe2, 0xec, 0xef, 0xe2]),
          Buffer.from(" 1\0x"),
        ]),
        Buffer.from("blob 01\0x"),
        Buffer.from("blob +1\0x"),
        Buffer.from("blob 1 \0x"),
        Buffer.from("unknown 1\0x"),
      ]) {
        const objectId = await writeRawLooseObject(repository, inflated);
        await expect(readGitObject(repository, objectId)).rejects.toThrow(
          "REL027 Git object data is truncated or malformed:",
        );
      }
    } finally {
      await rm(repository, { recursive: true, force: false });
    }

    const commitId = "1111111111111111111111111111111111111111";
    const treeId = "2222222222222222222222222222222222222222";
    const entryId = Buffer.alloc(20, 0x33);
    const expectCommitFailure = async (commit: Buffer) =>
      expect(
        releaseInputsFromCommit({
          repositoryRoot,
          sourceCommit: commitId,
          objectReader: async (_root, objectId) =>
            objectId === commitId
              ? { type: "commit", bytes: commit }
              : { type: "tree", bytes: Buffer.alloc(0) },
        }),
      ).rejects.toThrow("REL027 Git object data is truncated or malformed:");
    await expectCommitFailure(
      Buffer.concat([
        Buffer.from("tree "),
        Buffer.from([0xb2]),
        Buffer.from(`${treeId.slice(1)}\n\n`),
      ]),
    );
    await expectCommitFailure(
      Buffer.from(`parent ${treeId}\ntree ${treeId}\n\n`),
    );
    await expectCommitFailure(
      Buffer.concat([
        Buffer.from(`tree ${treeId}\nauthor `),
        Buffer.from([0xff]),
        Buffer.from("\n\n"),
      ]),
    );

    const expectTreeFailure = async (tree: Buffer) =>
      expect(
        releaseInputsFromCommit({
          repositoryRoot,
          sourceCommit: commitId,
          objectReader: async (_root, objectId) =>
            objectId === commitId
              ? { type: "commit", bytes: Buffer.from(`tree ${treeId}\n\n`) }
              : { type: "tree", bytes: tree },
        }),
      ).rejects.toThrow("REL027 Git object data is truncated or malformed:");
    await expectTreeFailure(
      Buffer.concat([Buffer.from("040000 scripts\0"), entryId]),
    );
    await expectTreeFailure(
      Buffer.concat([
        Buffer.from([0xb4]),
        Buffer.from("0000 scripts\0"),
        entryId,
      ]),
    );
    await expectTreeFailure(
      Buffer.concat([
        Buffer.from("40000 "),
        Buffer.from([0xc3, 0xa9]),
        Buffer.from("\0"),
        entryId,
      ]),
    );
  });

  it("resolves chained symbolic refs with loose precedence and rejects cycles, depth, and missing targets", async () => {
    const repository = await createSyntheticRepository(
      "thermite-schematics-symbolic-ref-test-",
    );
    const loose = "1111111111111111111111111111111111111111";
    const packed = "2222222222222222222222222222222222222222";
    const writeRef = async (name: string, value: string) => {
      const path = join(repository, ".git", ...name.split("/"));
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, `${value}\n`);
    };
    try {
      await writeFile(
        join(repository, ".git", "HEAD"),
        "ref: refs/heads/main\n",
      );
      await writeRef("refs/heads/main", "ref: refs/heads/middle");
      await writeRef("refs/heads/middle", "ref: refs/heads/final");
      await writeRef("refs/heads/final", loose);
      await writeFile(
        join(repository, ".git", "packed-refs"),
        `${packed} refs/heads/main\n`,
      );
      await expect(resolveHeadCommit(repository)).resolves.toBe(loose);

      await writeRef("refs/heads/main", "ref: refs/heads/middle");
      await writeRef("refs/heads/middle", "ref: refs/heads/main");
      await expect(resolveHeadCommit(repository)).rejects.toThrow(
        "REL024 Git repository metadata is invalid: symbolic ref cycle.",
      );

      for (let index = 0; index < 6; index += 1) {
        await writeRef(
          index === 0 ? "refs/heads/main" : `refs/heads/depth-${index}`,
          `ref: refs/heads/depth-${index + 1}`,
        );
      }
      await writeRef("refs/heads/depth-6", loose);
      await expect(resolveHeadCommit(repository)).rejects.toThrow(
        "REL024 Git repository metadata is invalid: symbolic ref depth exceeds 5.",
      );

      await writeRef("refs/heads/main", "ref: refs/heads/absent");
      await expect(resolveHeadCommit(repository)).rejects.toThrow(
        "REL024 Git repository metadata is invalid: symbolic ref target is missing.",
      );
    } finally {
      await rm(repository, { recursive: true, force: false });
    }
  });

  it("rejects every forbidden Git ref-name class in HEAD and packed refs", async () => {
    const repository = await createSyntheticRepository(
      "thermite-schematics-invalid-ref-name-test-",
    );
    const objectId = "3333333333333333333333333333333333333333";
    const invalidNames = [
      "refs/heads/foo..bar",
      "refs/heads/.hidden",
      "refs/heads/name.lock",
      "refs/heads/with space",
      "refs/heads/control\u0001",
      "refs/heads/unicodé",
      "refs/heads/tilde~",
      "refs/heads/caret^",
      "refs/heads/colon:",
      "refs/heads/question?",
      "refs/heads/star*",
      "refs/heads/bracket[",
      "refs/heads/back\\slash",
      "refs/heads/double//slash",
      "refs/heads/trailing/",
      "refs/heads/trailing.",
      "refs/heads/reflog@{one",
      "@",
    ];
    try {
      for (const name of invalidNames) {
        await writeFile(join(repository, ".git", "HEAD"), `ref: ${name}\n`);
        await expect(resolveHeadCommit(repository)).rejects.toThrow("REL024");
      }

      await writeFile(
        join(repository, ".git", "HEAD"),
        "ref: refs/heads/main\n",
      );
      for (const name of invalidNames) {
        await writeFile(
          join(repository, ".git", "packed-refs"),
          `${objectId} ${name}\n`,
        );
        await expect(resolveHeadCommit(repository)).rejects.toThrow("REL024");
      }
      await writeFile(
        join(repository, ".git", "packed-refs"),
        `${objectId} refs/heads/main\n${objectId} refs/heads/main\n`,
      );
      await expect(resolveHeadCommit(repository)).rejects.toThrow(
        "REL024 Git repository metadata is invalid: packed-refs contains a duplicate ref.",
      );
      await writeFile(
        join(repository, ".git", "packed-refs"),
        `${objectId}  refs/heads/main\n`,
      );
      await expect(resolveHeadCommit(repository)).rejects.toThrow(
        "REL024 Git repository metadata is invalid: packed-refs has a malformed row.",
      );
      await writeFile(
        join(repository, ".git", "packed-refs"),
        Buffer.concat([
          Buffer.from(`${objectId} refs/heads/ma`),
          Buffer.from([0xc3, 0xa9]),
          Buffer.from("in\n"),
        ]),
      );
      await expect(resolveHeadCommit(repository)).rejects.toThrow(
        "REL024 Git repository metadata is invalid: packed-refs is malformed.",
      );
    } finally {
      await rm(repository, { recursive: true, force: false });
    }
  });

  it("bounds loose, packed, delta, and inflate object expansion", async () => {
    const looseRepository = await createSyntheticRepository(
      "thermite-schematics-object-bound-loose-test-",
    );
    const packRepository = await createSyntheticRepository(
      "thermite-schematics-object-bound-pack-test-",
    );
    const deltaRepository = await createSyntheticRepository(
      "thermite-schematics-object-bound-delta-test-",
    );
    const inflateRepository = await createSyntheticRepository(
      "thermite-schematics-object-bound-inflate-test-",
    );
    try {
      const oversizedLoose = await writeRawLooseObject(
        looseRepository,
        Buffer.from(`blob ${MAX_RELEASE_GIT_OBJECT_SIZE + 1}\0`),
      );
      await expect(
        readGitObject(looseRepository, oversizedLoose),
      ).rejects.toThrow("REL027 Git object data is truncated or malformed:");

      const oversizedPackId = "4444444444444444444444444444444444444444";
      await writePackedFixture(packRepository, [
        {
          objectId: oversizedPackId,
          packed: Buffer.concat([
            encodePackHeader(3, MAX_RELEASE_GIT_OBJECT_SIZE + 1),
            deflateSync(Buffer.alloc(0)),
          ]),
        },
      ]);
      await expect(
        readGitObject(packRepository, oversizedPackId),
      ).rejects.toThrow("REL027 Git object data is truncated or malformed:");

      const base = Buffer.from("x");
      const baseId = gitObjectId("blob", base);
      const basePacked = Buffer.concat([
        encodePackHeader(3, base.byteLength),
        deflateSync(base),
      ]);
      const deltaId = "5555555555555555555555555555555555555555";
      const delta = Buffer.concat([
        encodeDeltaSize(base.byteLength),
        encodeDeltaSize(MAX_RELEASE_GIT_OBJECT_SIZE + 1),
      ]);
      await writePackedFixture(deltaRepository, [
        { objectId: baseId, packed: basePacked },
        {
          objectId: deltaId,
          packed: Buffer.concat([
            encodePackHeader(6, delta.byteLength),
            encodeOffsetDistance(basePacked.byteLength),
            deflateSync(delta),
          ]),
        },
      ]);
      await expect(readGitObject(deltaRepository, deltaId)).rejects.toThrow(
        "REL027 Git object data is truncated or malformed:",
      );

      const expanded = Buffer.concat([
        Buffer.from(`blob ${MAX_RELEASE_GIT_OBJECT_SIZE}\0`),
        Buffer.alloc(MAX_RELEASE_GIT_OBJECT_SIZE + 128),
      ]);
      const inflateId = await writeRawLooseObject(inflateRepository, expanded);
      await expect(readGitObject(inflateRepository, inflateId)).rejects.toThrow(
        "REL027 Git object data is truncated or malformed:",
      );
    } finally {
      await rm(looseRepository, { recursive: true, force: false });
      await rm(packRepository, { recursive: true, force: false });
      await rm(deltaRepository, { recursive: true, force: false });
      await rm(inflateRepository, { recursive: true, force: false });
    }
  }, 120_000);
});

function stageDeclarationFixture({
  firstPartyPath = "dist/index.d.ts",
  firstPartyManifest,
  firstPartySource,
  dependencyName,
  dependencyManifest,
  dependencyFiles,
  inventoryPaths,
}: {
  firstPartyPath?: string;
  firstPartyManifest?: Record<string, unknown>;
  firstPartySource: string;
  dependencyName: string;
  dependencyManifest: Record<string, unknown>;
  dependencyFiles: Readonly<Record<string, string>>;
  inventoryPaths: readonly string[];
}) {
  const dependencyRoot = "package/node_modules/" + dependencyName;
  const stageBytes = new Map<string, Buffer>([
    [
      "package/package.json",
      Buffer.from(
        JSON.stringify(
          firstPartyManifest ?? {
            name: "@fixture/root",
            type: "module",
            exports: {
              ".": {
                types: "./" + firstPartyPath,
                import: "./dist/index.js",
              },
            },
          },
        ),
      ),
    ],
    ["package/" + firstPartyPath, Buffer.from(firstPartySource)],
    [
      dependencyRoot + "/package.json",
      Buffer.from(
        JSON.stringify({ name: dependencyName, ...dependencyManifest }),
      ),
    ],
    ...Object.entries(dependencyFiles).map(
      ([path, source]) =>
        [dependencyRoot + "/" + path, Buffer.from(source)] as const,
    ),
  ]);
  return {
    stageBytes,
    firstPartyInventory: {
      packages: [
        {
          name: "@fixture/root",
          stagePath: "package",
          files: [
            {
              stagePath: "package/" + firstPartyPath,
              role: "declaration",
            },
          ],
        },
      ],
    },
    thirdPartyInventory: {
      packages: [
        {
          name: dependencyName,
          packagePath: dependencyRoot,
          files: inventoryPaths.map((path) => ({
            path: dependencyRoot + "/" + path,
            role: "declaration",
          })),
        },
      ],
    },
  };
}

describe("self-contained release package", () => {
  it("rejects direct release environment and pinned-tool drift", () => {
    expect(() =>
      assertDirectReleaseEnvironment(RELEASE_BUILD_ENVIRONMENT),
    ).not.toThrow();
    expect(() =>
      assertDirectReleaseEnvironment({
        ...RELEASE_BUILD_ENVIRONMENT,
        PWD: "/unexpected",
      }),
    ).toThrow(
      "REL001 Direct release process environment is not the frozen env-i/0.1 map.",
    );
    expect(() =>
      assertReleaseToolVersions({
        nodeVersion: "v24.11.0",
        typescriptVersion: "5.9.3",
      }),
    ).toThrow("REL002 Expected Node v24.11.1; found v24.11.0.");
    expect(() =>
      assertReleaseToolVersions({
        nodeVersion: "v24.11.1",
        typescriptVersion: "5.9.2",
      }),
    ).toThrow("REL003 Expected TypeScript 5.9.3; found 5.9.2.");
  });

  it("uses exactly one direct release-package launcher entry with the protected source commit", async () => {
    const launcher = await readFile(
      join(repositoryRoot, "scripts", "release-pack.sh"),
      "utf8",
    );
    const directEntries = launcher
      .split("\n")
      .filter((line) => /\bnode scripts\/release-[a-z-]+\.mjs\b/u.test(line));
    expect(directEntries).toEqual([
      '"${clean_env[@]}" node scripts/release-package.mjs --output release-out --source-commit "$source_commit"',
    ]);
    expect(launcher).not.toContain("node scripts/release-build.mjs");
    const builder = await readFile(
      join(repositoryRoot, "scripts", "release-build.mjs"),
      "utf8",
    );
    expect(builder).not.toContain("process.argv");
    expect(builder).not.toContain("Usage: node scripts/release-build.mjs");
  });

  it("requires the tracked launcher mode, canonical bytes, and in-process shell syntax", async () => {
    const launcherPath = join(repositoryRoot, "scripts", "release-pack.sh");
    const launcherEntry = (await readGitIndexEntries(repositoryRoot)).find(
      ({ path }) => path === "scripts/release-pack.sh",
    );
    expect(launcherEntry?.mode).toBe("100755");

    const launcherBytes = await readFile(launcherPath);
    expect([...launcherBytes].every((byte) => byte <= 0x7f)).toBe(true);
    expect(launcherBytes.includes(0)).toBe(false);
    expect(launcherBytes.includes(0x0d)).toBe(false);
    expect(launcherBytes.at(-1)).toBe(0x0a);
    const launcher = launcherBytes.toString("ascii");
    const lines = launcher.split("\n");
    expect(lines[0]).toBe("#!/usr/bin/env bash");
    expect(lines[1]).toBe("set -euo pipefail");
    expect(lines.at(-1)).toBe("");
    assertInProcessLauncherSyntax(launcher);

    expect(lines.filter((line) => line.includes('"${clean_env[@]}"'))).toEqual([
      '[[ $("${clean_env[@]}" node --version) == "v24.11.1" ]] || fail "REL017 Node version mismatch."',
      '[[ $("${clean_env[@]}" npm --version) == "11.6.2" ]] || fail "REL018 npm version mismatch."',
      '"${clean_env[@]}" npm ci --ignore-scripts --no-audit --no-fund --package-lock=true --userconfig release-out/.npm-userrc --globalconfig release-out/.npm-globalrc --cache release-out/.npm-cache',
      '"${clean_env[@]}" npm run build',
      '"${clean_env[@]}" node scripts/release-package.mjs --output release-out --source-commit "$source_commit"',
    ]);

    const releaseInputs = await releaseInputsFromCommit({
      repositoryRoot,
      sourceCommit,
    });
    expect(releaseInputs.map(({ path }) => path)).not.toContain(
      "scripts/release-pack.sh",
    );
  });

  it("captures package-lock and every committed release inventory exactly once", async () => {
    const counts = new Map<string, number>();
    const authorities = await captureCommittedReleaseAuthorities({
      repositoryRoot,
      fileReader: async (path: string) => {
        counts.set(path, (counts.get(path) ?? 0) + 1);
        return readFile(path);
      },
    });
    const expectedPaths = [
      join(repositoryRoot, "package-lock.json"),
      join(repositoryRoot, "scripts", "release-first-party-files.json"),
      join(repositoryRoot, "scripts", "release-third-party-source-files.json"),
      join(repositoryRoot, "scripts", "release-third-party-stage-files.json"),
    ];
    expect([...counts]).toEqual(expectedPaths.map((path) => [path, 1]));
    expect(authorities.parsed.firstParty.format).toBe(
      "thermite-schematics-release-first-party-files/0.1",
    );
    expect(authorities.parsed.thirdPartySource.format).toBe(
      "thermite-schematics-release-third-party-source-files/0.1",
    );
    expect(authorities.parsed.thirdPartyStage.format).toBe(
      "thermite-schematics-release-third-party-stage-files/0.1",
    );
  });

  it("serves the verified root manifest and rejects ancestor probes outside the three compiler authorities", async () => {
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "thermite-schematics-root-manifest-host-test-"),
    );
    try {
      const fixtureRepository = join(temporaryRoot, "repository");
      const privateRoot = join(temporaryRoot, "build", "source");
      const source = join(privateRoot, "package", "index.ts");
      const rootManifest = Buffer.from('{"type":"module"}\n');
      const filesystemReads: string[] = [];
      const host = createImmutableCompilerHost({
        options: { outDir: join(temporaryRoot, "out") },
        privateSourceRoot: privateRoot,
        immutableFiles: new Map([[source, Buffer.from("export {};\n")]]),
        repositoryRoot: fixtureRepository,
        rootPackageJsonBytes: rootManifest,
        thirdPartyFileReader: (path: string) => {
          filesystemReads.push(`file:${path}`);
          throw Object.assign(new Error("unexpected read"), { code: "ENOENT" });
        },
        thirdPartyStatReader: (path: string) => {
          filesystemReads.push(`stat:${path}`);
          throw Object.assign(new Error("unexpected stat"), { code: "ENOENT" });
        },
        thirdPartyDirectoryReader: (path: string) => {
          filesystemReads.push(`directory:${path}`);
          return [];
        },
        thirdPartyRealpathReader: (path: string) => {
          filesystemReads.push(`realpath:${path}`);
          return path;
        },
      });
      const manifestPath = join(fixtureRepository, "package.json");
      expect(host.fileExists(manifestPath)).toBe(true);
      expect(host.readFile(manifestPath)).toBe(rootManifest.toString("utf8"));
      for (const probe of [
        temporaryRoot,
        fixtureRepository,
        dirname(temporaryRoot),
      ]) {
        expect(host.fileExists(probe)).toBe(false);
        expect(host.readFile(probe)).toBeUndefined();
        expect(host.directoryExists?.(probe)).toBe(false);
        expect(host.getDirectories?.(probe)).toEqual([]);
        expect(host.readDirectory?.(probe)).toEqual([]);
        expect(host.realpath?.(probe)).toBeUndefined();
      }
      expect(filesystemReads).toEqual([]);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: false });
    }
  });

  it("serves prior-package declarations only from the same-build captured output map", async () => {
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "thermite-schematics-prior-declaration-host-test-"),
    );
    try {
      const privateRoot = join(temporaryRoot, "build", "source");
      const declarationRoot = join(temporaryRoot, "build", "packages");
      const declaration = join(declarationRoot, "schema", "dist", "index.d.ts");
      const bytes = Buffer.from("export declare const captured: true;\n");
      const host = createImmutableCompilerHost({
        options: { outDir: join(temporaryRoot, "out") },
        privateSourceRoot: privateRoot,
        immutableFiles: new Map(),
        priorDeclarationFiles: new Map([[declaration, bytes]]),
        priorDeclarationRoot: declarationRoot,
        repositoryRoot: join(temporaryRoot, "repository"),
      });
      await expect(lstat(declaration)).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(host.fileExists(declaration)).toBe(true);
      expect(host.readFile(declaration)).toBe(bytes.toString("utf8"));
      expect(host.directoryExists?.(dirname(declaration))).toBe(true);
      expect(host.directoryExists?.(temporaryRoot)).toBe(false);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: false });
    }
  });

  it("rejects require-mode declaration edges whose conditional types export is import-only", () => {
    const fixture = stageDeclarationFixture({
      firstPartyPath: "dist/index.d.cts",
      firstPartyManifest: {
        name: "@fixture/root",
        type: "commonjs",
        exports: {
          ".": {
            types: "./dist/index.d.cts",
            require: "./dist/index.cjs",
          },
        },
      },
      firstPartySource:
        'import value = require("conditional-only"); export = value;\n',
      dependencyName: "conditional-only",
      dependencyManifest: {
        type: "module",
        exports: {
          ".": {
            types: { import: "./types/import.d.ts" },
            import: "./runtime.js",
          },
        },
      },
      dependencyFiles: {
        "types/import.d.ts": "export declare const imported: true;\n",
      },
      inventoryPaths: ["types/import.d.ts"],
    });
    expect(() =>
      auditStageDeclarationClosure(
        fixture.stageBytes,
        fixture.firstPartyInventory,
        fixture.thirdPartyInventory,
      ),
    ).toThrow("PKG007 Unresolved declaration edge 'conditional-only'.");
  });

  it("accepts only real node-prefixed builtins in declaration closure", () => {
    const fixtureFor = (specifier: string) =>
      stageDeclarationFixture({
        firstPartySource: `import "${specifier}"; export {};\n`,
        dependencyName: "unused-declaration-fixture",
        dependencyManifest: { type: "module" },
        dependencyFiles: {},
        inventoryPaths: [],
      });
    const realBuiltin = fixtureFor("node:fs");
    expect(() =>
      auditStageDeclarationClosure(
        realBuiltin.stageBytes,
        realBuiltin.firstPartyInventory,
        realBuiltin.thirdPartyInventory,
      ),
    ).not.toThrow();

    for (const specifier of ["node:not-a-real-builtin", "fs"]) {
      const unresolved = fixtureFor(specifier);
      expect(() =>
        auditStageDeclarationClosure(
          unresolved.stageBytes,
          unresolved.firstPartyInventory,
          unresolved.thirdPartyInventory,
        ),
      ).toThrow(`PKG007 Unresolved declaration edge '${specifier}'.`);
    }
  });

  it("honors typesVersions remaps instead of accepting the handwritten direct candidate", () => {
    const fixture = stageDeclarationFixture({
      firstPartySource:
        'export type { Versioned } from "types-versioned/feature";\n',
      dependencyName: "types-versioned",
      dependencyManifest: {
        types: "./index.d.ts",
        typesVersions: {
          "*": {
            feature: ["types/feature.d.ts"],
          },
        },
      },
      dependencyFiles: {
        "feature.d.ts": "export interface Versioned { direct: true }\n",
        "types/feature.d.ts": "export interface Versioned { remapped: true }\n",
      },
      inventoryPaths: ["feature.d.ts"],
    });
    expect(() =>
      auditStageDeclarationClosure(
        fixture.stageBytes,
        fixture.firstPartyInventory,
        fixture.thirdPartyInventory,
      ),
    ).toThrow("PKG007");
  });

  it("rejects a declaration subpath hidden by conditional exports", () => {
    const fixture = stageDeclarationFixture({
      firstPartySource:
        'export type { Hidden } from "closed-declarations/internal";\n',
      dependencyName: "closed-declarations",
      dependencyManifest: {
        type: "module",
        exports: {
          ".": {
            types: "./index.d.ts",
            import: "./index.js",
          },
        },
      },
      dependencyFiles: {
        "index.d.ts": "export interface Public { public: true }\n",
        "internal.d.ts": "export interface Hidden { hidden: true }\n",
      },
      inventoryPaths: ["internal.d.ts"],
    });
    expect(() =>
      auditStageDeclarationClosure(
        fixture.stageBytes,
        fixture.firstPartyInventory,
        fixture.thirdPartyInventory,
      ),
    ).toThrow(
      "PKG007 Unresolved declaration edge 'closed-declarations/internal'.",
    );
  });

  it("rejects mutated bytes, a wrong mode, and an extra path in dist and stage materializations", async () => {
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "thermite-schematics-materialization-map-test-"),
    );
    try {
      const expected = new Map([["nested/file.js", Buffer.from("recorded\n")]]);
      const distRoot = join(temporaryRoot, "dist");
      await materializeFileMap({
        root: distRoot,
        files: expected,
        label: "Private dist",
      });
      await writeFile(join(distRoot, "nested", "file.js"), "mutated\n");
      await expect(
        verifyMaterializedFileMap({
          root: distRoot,
          files: expected,
          label: "Private dist",
        }),
      ).rejects.toThrow(
        "Private dist bytes differ from its immutable map: nested/file.js.",
      );

      const stageRoot = join(temporaryRoot, "stage");
      await materializeFileMap({
        root: stageRoot,
        files: expected,
        label: "Release stage",
      });
      await writeFile(join(stageRoot, "extra.txt"), "extra\n", { flag: "wx" });
      await expect(
        verifyMaterializedFileMap({
          root: stageRoot,
          files: expected,
          label: "Release stage",
        }),
      ).rejects.toThrow(
        "Release stage path/type set differs from its immutable map.",
      );

      const modeRoot = join(temporaryRoot, "mode");
      const modeBytes = new Map([["file.js", Buffer.from("mode\n")]]);
      await materializeFileMap({ root: modeRoot, files: modeBytes });
      await expect(
        verifyMaterializedFileMap({
          root: modeRoot,
          files: modeBytes,
          label: "Private dist",
          platform: "linux",
          enumerate: async () => [
            {
              path: "file.js",
              type: "file",
              stats: {
                isSymbolicLink: () => false,
                mode: 0o100755,
                nlink: 1n,
              },
            },
          ],
          fileReader: async () => Buffer.from("mode\n"),
        }),
      ).rejects.toThrow("Private dist has the wrong normalized mode: file.js.");
    } finally {
      await rm(temporaryRoot, { recursive: true, force: false });
    }
  });

  it("runs the real full map-backed audit for both twin tarballs and rejects corrupted B", async () => {
    const disposable = await buildDisposableReleaseCandidate({
      repositoryRoot,
      sourceCommit,
    });
    const stages = disposable.stageMaps.map((bytes, index) => ({
      bytes,
      declarationClosure: disposable.declarationClosures[index],
    }));
    const builds = disposable.outputMaps.map((outputBytes) => ({
      outputBytes,
    }));
    const audits = await auditTwinReleaseOutputs({
      auditor: auditReleaseOutputs,
      outputMaps: disposable.releaseOutputMaps,
      stages,
      builds,
      authorityBytes: disposable.authorityBytes,
    });
    expect(audits).toHaveLength(2);
    expect(audits[0].artifactSha).toBe(audits[1].artifactSha);

    const corruptedOutput = new Map(disposable.releaseOutputMaps[1]);
    const tarName = "thermite-cli-0.2.0.tgz";
    const corruptedTar = Buffer.from(corruptedOutput.get(tarName));
    corruptedTar[Math.floor(corruptedTar.length / 2)] ^= 0xff;
    corruptedOutput.set(tarName, corruptedTar);
    await expect(
      auditReleaseOutputs({
        outputBytes: corruptedOutput,
        stageBytes: disposable.stageMaps[1],
        committedAuthorityBytes: disposable.authorityBytes,
        capturedOutputMaps: disposable.outputMaps,
        declarationClosure: disposable.declarationClosures[1],
      }),
    ).rejects.toThrow(/TAR001|TAR002|incorrect data check/u);
  }, 120_000);

  it("rejects stageRoot and an in-process audit that omits stageBytes", async () => {
    await expect(
      auditReleaseOutputs({ stageRoot: "forbidden" } as never),
    ).rejects.toThrow("TAR002 Path-backed stage audit is forbidden.");
    await expect(
      auditReleaseOutputs({ outputBytes: new Map() } as never),
    ).rejects.toThrow("TAR002 In-process stage audit requires stageBytes.");
  });

  it("isolates seam mutation from accepted tar, audit, and inventory bytes", async () => {
    type ByteMap = Map<string, Buffer>;
    type SeamStage = {
      bytes: ByteMap;
      firstParty: Parameters<typeof auditStageDeclarationClosure>[1];
      thirdParty: Parameters<typeof auditStageDeclarationClosure>[2];
      licenses: unknown;
      declarationClosure: ReturnType<typeof auditStageDeclarationClosure>;
    };
    type SeamBuild = { outputBytes: ByteMap };
    const cloneByteMap = (value: ByteMap) =>
      new Map(
        [...value].map(([path, bytes]) => [path, Buffer.from(bytes)] as const),
      );
    const counts = { maps: 0, buffers: 0, objects: 0 };
    const poisonReturn = {
      acceptedBytes: new Map([
        [
          "package/UNINVENTORIED-SEAM-RETURN.txt",
          Buffer.from("returned mutation\n"),
        ],
      ]),
    };
    let lifecycleCalls = 0;
    let baseline:
      | {
          stageMaps: ByteMap[];
          outputMaps: ByteMap[];
          tars: Awaited<ReturnType<typeof createDeterministicTar>>[];
          firstParty: unknown;
          thirdParty: unknown;
          licenses: unknown;
          declarationClosures: unknown;
        }
      | undefined;
    const disposable = await buildDisposableReleaseCandidate({
      repositoryRoot,
      sourceCommit,
      lifecycleObserver: (event: unknown) => {
        lifecycleCalls += 1;
        mutateSeamSnapshot(event, counts);
        return poisonReturn;
      },
      materializationProbe: async (snapshot: {
        stages: SeamStage[];
        builds: SeamBuild[];
      }) => {
        const stageMaps = snapshot.stages.map(({ bytes }) =>
          cloneByteMap(bytes),
        );
        baseline = {
          stageMaps,
          outputMaps: snapshot.builds.map(({ outputBytes }) =>
            cloneByteMap(outputBytes),
          ),
          tars: await Promise.all(stageMaps.map(createDeterministicTar)),
          firstParty: structuredClone(snapshot.stages[0]?.firstParty),
          thirdParty: structuredClone(snapshot.stages[0]?.thirdParty),
          licenses: structuredClone(snapshot.stages[0]?.licenses),
          declarationClosures: structuredClone(
            snapshot.stages.map(({ declarationClosure }) => declarationClosure),
          ),
        };
        mutateSeamSnapshot(snapshot, counts);
        return poisonReturn;
      },
    });

    expect(lifecycleCalls).toBe(9);
    expect(counts.maps).toBeGreaterThan(0);
    expect(counts.buffers).toBeGreaterThan(0);
    expect(counts.objects).toBeGreaterThan(0);
    expect(baseline).toBeDefined();
    expectByteMapArraysIdentical(
      disposable.stageMaps,
      baseline?.stageMaps,
      "isolated stage maps",
    );
    expectByteMapArraysIdentical(
      disposable.outputMaps,
      baseline?.outputMaps,
      "isolated output maps",
    );
    expectDeterministicTarResultsIdentical(
      disposable.tar,
      baseline?.tars[0],
      "isolated tar",
    );
    expect(disposable.firstParty).toEqual(baseline?.firstParty);
    expect(disposable.thirdPartyStage).toEqual(baseline?.thirdParty);
    expect(disposable.licenses).toEqual(baseline?.licenses);
    expect(disposable.declarationClosures).toEqual(
      baseline?.declarationClosures,
    );

    const stages = disposable.stageMaps.map((bytes, index) => ({
      bytes,
      declarationClosure: disposable.declarationClosures[index],
    }));
    const builds = disposable.outputMaps.map((outputBytes) => ({
      outputBytes,
    }));
    const auditInputs = {
      outputMaps: disposable.releaseOutputMaps,
      stages,
      builds,
      authorityBytes: disposable.authorityBytes,
    };
    const cleanAudits = await auditTwinReleaseOutputs({
      auditor: auditReleaseOutputs,
      ...auditInputs,
    });
    const mutatingAudits = await auditTwinReleaseOutputs({
      auditor: async (options: Parameters<typeof auditReleaseOutputs>[0]) => {
        const result = await auditReleaseOutputs(options);
        mutateSeamSnapshot(options, counts);
        return result;
      },
      ...auditInputs,
    });
    expect(mutatingAudits).toHaveLength(cleanAudits.length);
    for (let index = 0; index < cleanAudits.length; index += 1) {
      expectAuditResultsIdentical(
        mutatingAudits[index],
        cleanAudits[index],
        "mutating audit " + index,
      );
    }
    expectByteMapArraysIdentical(
      disposable.stageMaps,
      baseline?.stageMaps,
      "post-audit isolated stage maps",
    );
    expectByteMapArraysIdentical(
      disposable.outputMaps,
      baseline?.outputMaps,
      "post-audit isolated output maps",
    );
    expectReleaseOutputMapsIdentical(
      disposable.releaseOutputMaps[0],
      disposable.releaseOutputMaps[1],
      "twin release output maps",
    );
  }, 120_000);

  it("rejects an uninventoried ordinary file injected directly into a stage map", async () => {
    const disposable = await buildDisposableReleaseCandidate({
      repositoryRoot,
      sourceCommit,
    });
    const stageBytes = new Map(disposable.stageMaps[0]);
    stageBytes.set(
      "package/UNINVENTORIED-DIRECT-INJECTION.txt",
      Buffer.from("direct injection\n"),
    );
    await expect(
      auditReleaseOutputs({
        outputBytes: disposable.releaseOutputMaps[0],
        stageBytes,
        committedAuthorityBytes: disposable.authorityBytes,
        capturedOutputMaps: disposable.outputMaps,
        declarationClosure: disposable.declarationClosures[0],
      }),
    ).rejects.toThrow(
      "TAR002 Stage file set differs from the retained inventories.",
    );
  }, 120_000);

  it("rejects an untracked workspace declaration before creating build output", async () => {
    const untrackedSource = join(
      repositoryRoot,
      "packages",
      "schema",
      "src",
      "release-package-untracked.d.ts",
    );
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "thermite-schematics-release-untracked-test-"),
    );
    const buildRoot = join(temporaryRoot, "build");
    let created = false;
    try {
      await expect(lstat(untrackedSource)).rejects.toMatchObject({
        code: "ENOENT",
      });
      await writeFile(
        untrackedSource,
        "export {};\ndeclare global { const releasePackageProbe: unique symbol; }\n",
        { flag: "wx" },
      );
      created = true;
      await expect(
        buildFreshRelease({ repositoryRoot, buildRoot, sourceCommit }),
      ).rejects.toThrow(
        "REL021 Release source is untracked or ignored: packages/schema/src/release-package-untracked.d.ts.",
      );
      await expect(lstat(buildRoot)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      if (created) await rm(untrackedSource, { force: false });
      if (created) {
        await expect(lstat(untrackedSource)).rejects.toMatchObject({
          code: "ENOENT",
        });
      }
      await rm(temporaryRoot, { recursive: true, force: false });
    }
  });

  it("rejects a modified tracked release source", async () => {
    const source = join(
      repositoryRoot,
      "packages",
      "schema",
      "src",
      "ajv-validation.ts",
    );
    const original = await readFile(source);
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "thermite-schematics-release-modified-test-"),
    );
    const buildRoot = join(temporaryRoot, "build");
    let modified = false;
    try {
      await writeFile(
        source,
        Buffer.concat([
          original,
          Buffer.from("// release-package modified-source probe\n"),
        ]),
      );
      modified = true;
      await expect(
        buildFreshRelease({ repositoryRoot, buildRoot, sourceCommit }),
      ).rejects.toThrow(
        "REL020 Release input is modified relative to the Git index: packages/schema/src/ajv-validation.ts.",
      );
    } finally {
      if (modified) await writeFile(source, original);
      expectBuffersIdentical(
        await readFile(source),
        original,
        "restored modified source",
      );
      await rm(temporaryRoot, { recursive: true, force: false });
    }
  });

  it("rejects a missing tracked release source", async () => {
    const source = join(
      repositoryRoot,
      "packages",
      "schema",
      "src",
      "ajv-validation.ts",
    );
    const original = await readFile(source);
    const holding = join(
      repositoryRoot,
      "packages",
      "schema",
      ".release-package-test-ajv-validation.ts",
    );
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "thermite-schematics-release-missing-test-"),
    );
    const buildRoot = join(temporaryRoot, "build");
    let moved = false;
    try {
      await expect(lstat(holding)).rejects.toMatchObject({ code: "ENOENT" });
      await rename(source, holding);
      moved = true;
      await expect(
        buildFreshRelease({ repositoryRoot, buildRoot, sourceCommit }),
      ).rejects.toThrow(
        "REL019 Tracked release input is missing from the worktree: packages/schema/src/ajv-validation.ts.",
      );
    } finally {
      if (moved) await rename(holding, source);
      expectBuffersIdentical(
        await readFile(source),
        original,
        "restored missing source",
      );
      if (moved) {
        await expect(lstat(holding)).rejects.toMatchObject({ code: "ENOENT" });
      }
      await rm(temporaryRoot, { recursive: true, force: false });
    }
  });

  it("rejects an injected staged source addition including an ignored declaration", async () => {
    const indexEntries = await readGitIndexEntries(repositoryRoot);
    await expect(
      verifyReleaseSourceInputs({
        repositoryRoot,
        sourceCommit,
        indexEntries: [
          ...indexEntries,
          {
            path: "packages/schema/src/release-package-force-added.d.ts",
            mode: "100644",
            objectId: "1111111111111111111111111111111111111111",
          },
        ],
      }),
    ).rejects.toThrow(
      "REL031 Staged release input was added outside the declared source commit: packages/schema/src/release-package-force-added.d.ts.",
    );
  });

  it("rejects an injected staged source modification", async () => {
    const indexEntries = await readGitIndexEntries(repositoryRoot);
    const target = "packages/schema/src/ajv-validation.ts";
    await expect(
      verifyReleaseSourceInputs({
        repositoryRoot,
        sourceCommit,
        indexEntries: indexEntries.map((entry) =>
          entry.path === target
            ? {
                ...entry,
                objectId: "2222222222222222222222222222222222222222",
              }
            : entry,
        ),
      }),
    ).rejects.toThrow(
      `REL032 Staged release input differs from the declared source commit: ${target}.`,
    );
  });

  it("rejects an injected staged source deletion", async () => {
    const indexEntries = await readGitIndexEntries(repositoryRoot);
    const target = "packages/schema/src/ajv-validation.ts";
    await expect(
      verifyReleaseSourceInputs({
        repositoryRoot,
        sourceCommit,
        indexEntries: indexEntries.filter((entry) => entry.path !== target),
      }),
    ).rejects.toThrow(
      `REL033 Declared release input was deleted from the index: ${target}.`,
    );
  });

  it("rejects a declared source commit that is not HEAD", async () => {
    const declared = "0000000000000000000000000000000000000000";
    await expect(
      verifyReleaseSourceInputs({
        repositoryRoot,
        sourceCommit: declared,
      }),
    ).rejects.toThrow(
      `REL030 Declared source commit ${declared} does not equal HEAD ${sourceCommit}.`,
    );
  });

  it("resolves the real HEAD commit, matches its release inputs to the index, and builds", async () => {
    expect(sourceCommit).toMatch(/^[0-9a-f]{40}$/u);
    const [releaseInputs, indexEntries] = await Promise.all([
      releaseInputsFromCommit({ repositoryRoot, sourceCommit }),
      readGitIndexEntries(repositoryRoot),
    ]);
    const indexByPath = new Map(
      indexEntries.map((entry) => [entry.path, entry]),
    );
    expect(releaseInputs.map((entry) => indexByPath.get(entry.path))).toEqual(
      releaseInputs,
    );

    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "thermite-schematics-real-commit-build-test-"),
    );
    try {
      await expect(
        buildFreshRelease({
          repositoryRoot,
          sourceCommit,
          buildRoot: join(temporaryRoot, "build"),
        }),
      ).resolves.toMatchObject({ outputs: expect.any(Map) });
    } finally {
      await rm(temporaryRoot, { recursive: true, force: false });
    }
  }, 120_000);

  it("writes captured verified bytes without re-reading repository inputs", async () => {
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "thermite-schematics-release-captured-input-test-"),
    );
    const buildRoot = join(temporaryRoot, "build");
    const target = join(
      repositoryRoot,
      "packages",
      "schema",
      "src",
      "ajv-validation.ts",
    );
    const trigger = join(
      repositoryRoot,
      "packages",
      "cli",
      "src",
      "version.ts",
    );
    const original = await readFile(target);
    let visibleTarget = Buffer.from(original);
    let targetReads = 0;
    let changedAfterTargetVerification = false;
    const fileReader = async (file: string) => {
      if (file === target) {
        targetReads += 1;
        return Buffer.from(visibleTarget);
      }
      const bytes = await readFile(file);
      if (file === trigger) {
        visibleTarget = Buffer.from(
          "export const releasePackageTamper = true;\n",
        );
        changedAfterTargetVerification = true;
      }
      return bytes;
    };
    try {
      await buildFreshRelease({
        repositoryRoot,
        buildRoot,
        sourceCommit,
        fileReader,
      });
      expect(changedAfterTargetVerification).toBe(true);
      expect(targetReads).toBe(1);
      expectBuffersIdentical(
        await readFile(
          join(
            buildRoot,
            "source",
            "packages",
            "schema",
            "src",
            "ajv-validation.ts",
          ),
        ),
        original,
        "captured verified source",
      );
    } finally {
      await rm(temporaryRoot, { recursive: true, force: false });
    }
  }, 120_000);

  it("compiles from immutable first-party bytes and memoizes third-party compiler inputs", async () => {
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "thermite-schematics-immutable-compiler-test-"),
    );
    try {
      const privateRoot = join(temporaryRoot, "private");
      const source = join(privateRoot, "src", "index.ts");
      const output = join(temporaryRoot, "dist");
      await mkdir(dirname(source), { recursive: true });
      await writeFile(source, 'export const value = "tampered";\n');
      const verified = Buffer.from('export const value = "verified";\n');
      const capturedDeclaration = join(
        temporaryRoot,
        "prior-build",
        "dist",
        "index.d.ts",
      );
      await mkdir(dirname(capturedDeclaration), { recursive: true });
      await writeFile(
        capturedDeclaration,
        "export declare const tampered: true;\n",
      );
      const recordedDeclaration = Buffer.from(
        "export declare const recorded: true;\n",
      );
      const emitted = new Map<string, Buffer>();
      const options = {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        declaration: true,
        types: [],
        rootDir: join(privateRoot, "src"),
        outDir: output,
        noEmitOnError: true,
      };
      const host = createImmutableCompilerHost({
        options,
        privateSourceRoot: privateRoot,
        immutableFiles: new Map([[source, verified]]),
        priorDeclarationFiles: new Map([
          [capturedDeclaration, recordedDeclaration],
        ]),
        priorDeclarationRoot: join(temporaryRoot, "prior-build"),
        repositoryRoot,
        emittedFiles: emitted,
        stagePrefix: "package",
      });
      expect(host.readFile(capturedDeclaration)).toContain("recorded");
      expect(host.readFile(capturedDeclaration)).not.toContain("tampered");
      const program = ts.createProgram({
        rootNames: [source],
        options,
        host,
      });
      const diagnostics = ts.getPreEmitDiagnostics(program);
      expect(
        diagnostics.map((diagnostic) => ({
          code: diagnostic.code,
          message: ts.flattenDiagnosticMessageText(
            diagnostic.messageText,
            "\n",
          ),
        })),
      ).toEqual([]);
      const result = program.emit();
      expect(result.emitSkipped).toBe(false);
      expect(emitted.get("package/dist/index.js")?.toString("utf8")).toContain(
        '"verified"',
      );
      expect(
        emitted.get("package/dist/index.js")?.toString("utf8"),
      ).not.toContain('"tampered"');

      const thirdPartyPath = join(
        temporaryRoot,
        "repository",
        "node_modules",
        "fixture",
        "index.d.ts",
      );
      await mkdir(dirname(thirdPartyPath), { recursive: true });
      await writeFile(
        thirdPartyPath,
        "filesystem bytes are not authoritative\n",
      );
      let visible = Buffer.from("export declare const original: true;\n");
      let reads = 0;
      const thirdPartyState = {
        bytes: new Map(),
        directoryExists: new Map(),
        directories: new Map(),
        reads: new Map(),
        realpaths: new Map(),
      };
      const createHost = (name: string) =>
        createImmutableCompilerHost({
          options: { ...options, outDir: join(temporaryRoot, name) },
          privateSourceRoot: join(temporaryRoot, name, "source"),
          immutableFiles: new Map(),
          repositoryRoot: join(temporaryRoot, "repository"),
          thirdPartyState,
          thirdPartyFileReader: () => {
            reads += 1;
            return Buffer.from(visible);
          },
        });
      const first = createHost("first");
      expect(first.readFile(thirdPartyPath)).toContain("original");
      visible = Buffer.from("export declare const tampered: true;\n");
      const second = createHost("second");
      expect(second.readFile(thirdPartyPath)).toContain("original");
      expect(reads).toBe(1);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: false });
    }
  });

  it("freezes the C4 capture, ordering, mutation, and standalone-audit invariants", async () => {
    type ByteMap = Map<string, Buffer>;
    type LifecycleEvent = {
      type: string;
      buildIndex?: number;
      stageIndex?: number;
      bytes: ByteMap;
    };
    type StageProbe = {
      stageRoot: string;
      bytes: ByteMap;
      firstParty: Parameters<typeof auditStageDeclarationClosure>[1];
      thirdParty: Parameters<typeof auditStageDeclarationClosure>[2];
      declarationClosure: ReturnType<typeof auditStageDeclarationClosure>;
    };
    type BuildProbe = { buildRoot: string; outputBytes: ByteMap };
    const cloneByteMap = (value: ByteMap) =>
      new Map(
        [...value].map(([path, bytes]) => [path, Buffer.from(bytes)] as const),
      );
    const countRead = (counts: Map<string, number>, path: string) => {
      counts.set(path, (counts.get(path) ?? 0) + 1);
    };
    const authorityReads = new Map<string, number>();
    const releaseInputReads = new Map<string, number>();
    const assetReads = new Map<string, number>();
    const thirdPartyReads = new Map<string, number>();
    const compilerThirdPartyReads = new Map<string, number>();
    const lifecycleEvents: LifecycleEvent[] = [];
    let verifiedInputSnapshot: ByteMap | undefined;
    const outputSnapshots: ByteMap[] = [];
    const stageSnapshots: ByteMap[] = [];
    let mutationVerifierRejections = 0;

    const disposable = await buildDisposableReleaseCandidate({
      repositoryRoot,
      sourceCommit,
      authorityFileReader: async (path: string) => {
        countRead(authorityReads, path);
        return readFile(path);
      },
      releaseInputFileReader: async (path: string) => {
        countRead(releaseInputReads, path);
        return readFile(path);
      },
      firstPartyFileReader: async (path: string) => {
        countRead(assetReads, path);
        return readFile(path);
      },
      thirdPartyFileReader: async (path: string) => {
        countRead(thirdPartyReads, path);
        return readFile(path);
      },
      compilerHostOptions: {
        thirdPartyFileReader: (path: string) => {
          countRead(compilerThirdPartyReads, path);
          return readFileSync(path);
        },
      },
      lifecycleObserver: (event: LifecycleEvent) => {
        lifecycleEvents.push(event);
        if (event.type === "verified-input-map") {
          verifiedInputSnapshot = cloneByteMap(event.bytes);
        } else if (event.type === "output-map-complete") {
          outputSnapshots[event.buildIndex ?? -1] = cloneByteMap(event.bytes);
        } else if (event.type === "stage-map-complete") {
          stageSnapshots[event.stageIndex ?? -1] = cloneByteMap(event.bytes);
        }
      },
      materializationProbe: async ({
        stages,
        builds,
      }: {
        stages: StageProbe[];
        builds: BuildProbe[];
      }) => {
        const baselineTars = await Promise.all(
          stages.map(({ bytes }) => createDeterministicTar(bytes)),
        );
        for (let index = 0; index < 2; index += 1) {
          const build = builds[index];
          const stage = stages[index];
          const distPrefix = "package/dist/";
          const distFiles = new Map(
            [...build.outputBytes]
              .filter(([path]) => path.startsWith(distPrefix))
              .map(
                ([path, bytes]) =>
                  [path.slice(distPrefix.length), Buffer.from(bytes)] as const,
              ),
          );
          const distRoot = join(build.buildRoot, "packages", "cli", "dist");
          await writeFile(
            join(distRoot, "index.d.ts"),
            "mutated private dist materialization\n",
          );
          await expect(
            verifyMaterializedFileMap({
              root: distRoot,
              files: distFiles,
              label: "Private dist mutation probe",
            }),
          ).rejects.toThrow(
            "Private dist mutation probe bytes differ from its immutable map: index.d.ts.",
          );
          mutationVerifierRejections += 1;

          await writeFile(
            join(stage.stageRoot, "package", "dist", "index.d.ts"),
            "mutated stage materialization\n",
          );
          await expect(
            verifyMaterializedFileMap({
              root: stage.stageRoot,
              files: stage.bytes,
              executablePaths: new Set(["package/dist/bin.js"]),
              label: "Stage mutation probe",
            }),
          ).rejects.toThrow(
            "Stage mutation probe bytes differ from its immutable map: package/dist/index.d.ts.",
          );
          mutationVerifierRejections += 1;

          expectDeterministicTarResultsIdentical(
            await createDeterministicTar(stage.bytes),
            baselineTars[index],
            "immutable stage tar " + index,
          );
          expect(
            auditStageDeclarationClosure(
              stage.bytes,
              stage.firstParty,
              stage.thirdParty,
            ),
          ).toEqual(stage.declarationClosure);
        }
      },
    });

    expect(mutationVerifierRejections).toBe(4);
    expect([...authorityReads.values()]).toEqual([1, 1, 1, 1]);
    expect(disposable.verifiedInputs.has("package.json")).toBe(true);
    expect(disposable.verifiedInputMaps[0]).toBe(disposable.verifiedInputs);
    expect(disposable.verifiedInputMaps[1]).toBe(disposable.verifiedInputs);
    expectByteMapsIdentical(
      disposable.verifiedInputs,
      verifiedInputSnapshot,
      "verified input snapshot",
    );
    expectByteMapArraysIdentical(
      disposable.outputMaps,
      outputSnapshots,
      "output snapshots",
    );
    expectByteMapArraysIdentical(
      disposable.stageMaps,
      stageSnapshots,
      "stage snapshots",
    );
    expectByteMapsIdentical(
      disposable.outputMaps[0],
      disposable.outputMaps[1],
      "twin output maps",
    );
    expectByteMapsIdentical(
      disposable.stageMaps[0],
      disposable.stageMaps[1],
      "twin stage maps",
    );

    const expectedReleaseInputs = [...disposable.verifiedInputs.keys()]
      .map((path) => join(repositoryRoot, ...path.split("/")))
      .sort();
    expect([...releaseInputReads.keys()].sort()).toEqual(expectedReleaseInputs);
    expect([...releaseInputReads.values()].every((count) => count === 1)).toBe(
      true,
    );
    const expectedAssets = new Set([
      join(repositoryRoot, "AGENTS.md"),
      ...disposable.firstParty.packages.flatMap((package_) =>
        package_.files
          .filter(({ role }) => !["declaration", "runtime"].includes(role))
          .map(({ sourcePath }) =>
            join(repositoryRoot, ...sourcePath.split("/")),
          ),
      ),
    ]);
    expect([...assetReads.keys()].sort()).toEqual([...expectedAssets].sort());
    expect([...assetReads.values()].every((count) => count === 1)).toBe(true);
    const expectedThirdPartyReads = disposable.thirdPartySource.packages
      .flatMap((package_) =>
        package_.files.map(({ path }) =>
          installedPath(
            join(repositoryRoot, "node_modules"),
            package_.lockKey,
            path,
          ),
        ),
      )
      .sort();
    expect([...thirdPartyReads.keys()].sort()).toEqual(expectedThirdPartyReads);
    expect([...thirdPartyReads.values()].every((count) => count === 1)).toBe(
      true,
    );
    expect(compilerThirdPartyReads.size).toBeGreaterThan(0);
    expect(
      [...compilerThirdPartyReads.values()].every((count) => count === 1),
    ).toBe(true);

    const firstStageWrite = lifecycleEvents.findIndex(
      ({ type }) => type === "stage-write",
    );
    expect(firstStageWrite).toBeGreaterThan(0);
    for (let index = 0; index < 2; index += 1) {
      const mapComplete = lifecycleEvents.findIndex(
        (event) =>
          event.type === "stage-map-complete" && event.stageIndex === index,
      );
      const declarationResolution = lifecycleEvents.findIndex(
        (event) =>
          event.type === "declaration-resolution" && event.stageIndex === index,
      );
      const stageWrite = lifecycleEvents.findIndex(
        (event) => event.type === "stage-write" && event.stageIndex === index,
      );
      expect(mapComplete).toBeGreaterThan(-1);
      expect(mapComplete).toBeLessThan(declarationResolution);
      expect(mapComplete).toBeLessThan(stageWrite);
      expect(mapComplete).toBeLessThan(firstStageWrite);
    }

    const expectedThirdPartyDeclarations = disposable.thirdPartyStage.packages
      .flatMap((package_) =>
        package_.files
          .filter(({ role }) => role === "declaration")
          .map(({ path }) => path),
      )
      .sort();
    for (let index = 0; index < 2; index += 1) {
      const observed = auditStageDeclarationClosure(
        disposable.stageMaps[index],
        disposable.firstParty,
        disposable.thirdPartyStage,
      );
      expect(observed).toEqual(disposable.declarationClosures[index]);
      expect(
        observed.reached
          .filter((path) => expectedThirdPartyDeclarations.includes(path))
          .sort(),
      ).toEqual(expectedThirdPartyDeclarations);
    }
    const missingDeclaration = expectedThirdPartyDeclarations[0];
    const incompleteStage = new Map(disposable.stageMaps[0]);
    incompleteStage.delete(missingDeclaration);
    expect(() =>
      auditStageDeclarationClosure(
        incompleteStage,
        disposable.firstParty,
        disposable.thirdPartyStage,
      ),
    ).toThrow("PKG007");

    let standaloneRoot: string | undefined;
    try {
      standaloneRoot = await mkdtemp(
        join(tmpdir(), "thermite-schematics-standalone-audit-test-"),
      );
      for (const [name, bytes] of disposable.releaseOutputs) {
        await writeFile(join(standaloneRoot, name), bytes, { flag: "wx" });
      }
      const standaloneReads = new Map<string, number>();
      await auditReleaseOutputs({
        outputRoot: standaloneRoot,
        fileReader: async (path: string) => {
          countRead(standaloneReads, path);
          return readFile(path);
        },
      });
      expect(standaloneReads.size).toBe(10);
      expect([...standaloneReads.values()]).toEqual(Array(10).fill(1));
    } finally {
      if (standaloneRoot !== undefined) {
        await rm(standaloneRoot, { recursive: true, force: false });
      }
    }
  }, 120_000);

  it("creates tar bytes from the immutable stage map after on-disk mutation", async () => {
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "thermite-schematics-immutable-stage-test-"),
    );
    try {
      const stageFile = join(
        temporaryRoot,
        "stage",
        "package",
        "dist",
        "bin.js",
      );
      await mkdir(dirname(stageFile), { recursive: true });
      const recorded = Buffer.from('console.log("recorded");\n');
      const stageBytes = new Map([
        ["package/dist/bin.js", recorded],
        ["package/package.json", Buffer.from('{"name":"fixture"}\n')],
      ]);
      await writeFile(stageFile, 'console.log("tampered");\n');
      const tar = await createDeterministicTar(stageBytes);
      const extracted = join(temporaryRoot, "extracted");
      const parsed = await safeExtractTarball(tar.gzip, extracted);
      expectBuffersIdentical(
        parsed.files.get("package/dist/bin.js"),
        recorded,
        "immutable staged bin",
      );
      expect(
        parsed.files.get("package/dist/bin.js")?.toString("utf8"),
      ).not.toContain("tampered");
    } finally {
      await rm(temporaryRoot, { recursive: true, force: false });
    }
  });
  it("builds independent link-free emissions and runs packed init/core in process", async () => {
    const sentinel = join(
      repositoryRoot,
      "packages",
      "schema",
      "dist",
      "task6-worktree-dist-sentinel.map",
    );
    let disposable;
    let sentinelCreated = false;
    try {
      await expect(lstat(sentinel)).rejects.toMatchObject({ code: "ENOENT" });
      await writeFile(
        sentinel,
        "forbidden worktree dist sentinel" + String.fromCharCode(10),
        { flag: "wx" },
      );
      sentinelCreated = true;
      disposable = await buildDisposableReleaseCandidate({
        repositoryRoot,
      });
    } finally {
      if (sentinelCreated) await rm(sentinel, { force: false });
    }
    const [firstParty, source, stage] = await Promise.all([
      readFile(
        join(repositoryRoot, "scripts", "release-first-party-files.json"),
        "utf8",
      ),
      readFile(
        join(
          repositoryRoot,
          "scripts",
          "release-third-party-source-files.json",
        ),
        "utf8",
      ),
      readFile(
        join(repositoryRoot, "scripts", "release-third-party-stage-files.json"),
        "utf8",
      ),
    ]);
    expect(disposable.firstParty).toEqual(JSON.parse(firstParty));
    expect(disposable.thirdPartySource).toEqual(JSON.parse(source));
    expect(disposable.thirdPartyStage).toEqual(JSON.parse(stage));
    expect(disposable.thirdPartySource.packages).toHaveLength(26);
    expectBuffersIdentical(
      disposable.tar.gzip.subarray(0, 3),
      Buffer.from([0x1f, 0x8b, 8]),
      "gzip header",
    );

    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "thermite-schematics-release-package-test-"),
    );
    const captured = await lstat(temporaryRoot, { bigint: true });
    try {
      const extracted = join(temporaryRoot, "extracted");
      const parsed = await safeExtractTarball(disposable.tar.gzip, extracted);
      expect(
        [...parsed.files.keys()].some((path) => path.includes("sentinel")),
      ).toBe(false);
      expect([...parsed.files.keys()]).toContain("package/dist/bin.js");
      expect([...parsed.files.keys()]).toContain(
        "package/node_modules/@thermite/schema/dist/index.js",
      );
      expect([...parsed.files.keys()]).toContain(
        "package/node_modules/@thermite/core-library/dist/index.js",
      );
      const packageRoot = join(extracted, "package");
      const compiler = await import(
        pathToFileURL(
          join(
            packageRoot,
            "node_modules",
            "@thermite",
            "compiler",
            "dist",
            "index.js",
          ),
        ).href
      );
      const core = await import(
        pathToFileURL(
          join(
            packageRoot,
            "node_modules",
            "@thermite",
            "core-library",
            "dist",
            "index.js",
          ),
        ).href
      );
      const schema = await import(
        pathToFileURL(
          join(
            packageRoot,
            "node_modules",
            "@thermite",
            "schema",
            "dist",
            "index.js",
          ),
        ).href
      );
      expect(core.SHIPPED_CORE_LIBRARY_LOCATOR).toBe("ais-shipped:core@0.1.0");
      expect(schema.createInMemoryCanonicalSchemaRegistry()).toBeDefined();
      const project = join(temporaryRoot, "project");
      await import("node:fs/promises").then(({ mkdir }) => mkdir(project));
      const cli = await import(
        pathToFileURL(join(packageRoot, "dist", "index.js")).href
      );
      let stdout = "";
      let stderr = "";
      const exitCode = await cli.runCli(["node", "thermite", "init"], {
        cwd: project,
        stdout: { write: (value: string) => (stdout += value) },
        stderr: { write: (value: string) => (stderr += value) },
      });
      expect({ exitCode, stdout, stderr }).toEqual({
        exitCode: 0,
        stdout: 'Initialized Thermite Schematics project in ".".\n',
        stderr: "",
      });
      const compiled = await compiler.compileProject(project);
      expect(compiled.ok).toBe(true);
      for (const path of [
        "system.json",
        "presentation.json",
        "electrical-system.lock.json",
        "devices/equipment.json",
        "connections/control-power.json",
        "potentials/potentials.json",
      ]) {
        expectBuffersIdentical(
          await readFile(join(project, ...path.split("/"))),
          await readFile(
            join(
              packageRoot,
              "templates",
              "starter-default",
              ...path.split("/"),
            ),
          ),
          "initialized template " + path,
        );
      }
    } finally {
      const observed = await lstat(temporaryRoot, { bigint: true });
      expect(observed.dev).toBe(captured.dev);
      expect(observed.ino).toBe(captured.ino);
      await rm(temporaryRoot, {
        recursive: true,
        force: false,
        maxRetries: 10,
        retryDelay: 100,
      });
    }
  }, 120_000);

  it("rejects picomatch identity confusion and every missing declaration root", async () => {
    const sourceInventory = JSON.parse(
      await readFile(
        join(
          repositoryRoot,
          "scripts",
          "release-third-party-source-files.json",
        ),
        "utf8",
      ),
    );
    const lock = JSON.parse(
      await readFile(join(repositoryRoot, "package-lock.json"), "utf8"),
    );
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "thermite-schematics-release-negative-test-"),
    );
    const captured = await lstat(temporaryRoot, { bigint: true });
    try {
      const modulesRoot = join(temporaryRoot, "node_modules");
      await copyRecordedThirdPartyTree(modulesRoot, sourceInventory);
      const lockPath = join(temporaryRoot, "package-lock.json");
      await writeFile(
        lockPath,
        JSON.stringify(lock, undefined, 2) + String.fromCharCode(10),
      );
      const nestedPicomatch = sourceInventory.packages.find(
        ({ name }: { name: string }) => name === "picomatch",
      );
      await copyFile(
        join(repositoryRoot, "node_modules", "picomatch", "package.json"),
        installedPath(modulesRoot, nestedPicomatch.lockKey, "package.json"),
      );
      await expect(
        collectThirdPartySource({
          repositoryRoot,
          lockPath,
          modulesPath: modulesRoot,
        }),
      ).rejects.toThrow(picomatchError);
      await copyFile(
        join(
          repositoryRoot,
          "node_modules",
          "micromatch",
          "node_modules",
          "picomatch",
          "package.json",
        ),
        installedPath(modulesRoot, nestedPicomatch.lockKey, "package.json"),
      );

      const rootOnlyLock = structuredClone(lock);
      delete rootOnlyLock.packages[
        "node_modules/micromatch/node_modules/picomatch"
      ];
      await writeFile(
        lockPath,
        JSON.stringify(rootOnlyLock, undefined, 2) + String.fromCharCode(10),
      );
      await expect(
        collectThirdPartySource({
          repositoryRoot,
          lockPath,
          modulesPath: modulesRoot,
        }),
      ).rejects.toThrow(picomatchError);
      await writeFile(
        lockPath,
        JSON.stringify(lock, undefined, 2) + String.fromCharCode(10),
      );

      for (const [name, path] of [
        ["ajv", "dist/ajv.d.ts"],
        ["elkjs", "lib/main.d.ts"],
        ["jsonc-parser", "lib/umd/main.d.ts"],
        ["fast-uri", "types/index.d.ts"],
      ] as const) {
        const package_ = sourceInventory.packages.find(
          ({ name: candidate }: { name: string }) => candidate === name,
        );
        const target = installedPath(modulesRoot, package_.lockKey, path);
        await rm(target, { force: false });
        await expect(
          collectThirdPartySource({
            repositoryRoot,
            lockPath,
            modulesPath: modulesRoot,
          }),
        ).rejects.toThrow("PKG007");
        await copyFile(
          join(
            repositoryRoot,
            "node_modules",
            ...package_.lockKey.slice("node_modules/".length).split("/"),
            ...path.split("/"),
          ),
          target,
        );
      }
    } finally {
      const observed = await lstat(temporaryRoot, { bigint: true });
      expect(observed.dev).toBe(captured.dev);
      expect(observed.ino).toBe(captured.ino);
      await rm(temporaryRoot, {
        recursive: true,
        force: false,
        maxRetries: 10,
        retryDelay: 100,
      });
    }
  }, 120_000);

  it("separates private protected candidate authority from publisher push authority", async () => {
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "thermite-schematics-release-target-test-"),
    );
    const captured = await lstat(temporaryRoot, { bigint: true });
    const sha = "1234567890abcdef1234567890abcdef12345678";
    const eventPath = join(temporaryRoot, "event.json");
    await writeFile(
      eventPath,
      JSON.stringify({ after: sha }) + String.fromCharCode(10),
    );
    const repository = {
      full_name: "BlackettApplied/ThermiteSchematics",
      private: true,
      visibility: "private",
      fork: false,
      permissions: { push: true },
    };
    const response = (value: unknown) => ({
      ok: true,
      status: 200,
      json: async () => value,
    });
    const request = async (url: string) => {
      if (url.endsWith("/branches/dev"))
        return response({ name: "dev", protected: true });
      if (url.endsWith(`/commits/${sha}/pulls`))
        return response([
          {
            merged_at: "deterministic-presence-marker",
            base: { ref: "dev" },
            merge_commit_sha: sha,
          },
        ]);
      return response(repository);
    };
    try {
      await expect(
        verifyPrivateReleaseTarget({
          mode: "candidate",
          environment: {
            GITHUB_REPOSITORY: "BlackettApplied/ThermiteSchematics",
            GITHUB_TOKEN: "test-token",
            GITHUB_EVENT_NAME: "push",
            GITHUB_REF: "refs/heads/dev",
            GITHUB_SHA: sha,
            GITHUB_EVENT_PATH: eventPath,
          },
          request,
        }),
      ).resolves.toEqual({
        repository: "BlackettApplied/ThermiteSchematics",
        sourceCommit: sha,
        branch: "dev",
        protected: true,
      });
      await expect(
        verifyPrivateReleaseTarget({
          mode: "publisher",
          environment: {
            GITHUB_REPOSITORY: "BlackettApplied/ThermiteSchematics",
            GITHUB_TOKEN: "test-token",
          },
          request,
        }),
      ).resolves.toEqual({
        repository: "BlackettApplied/ThermiteSchematics",
        push: true,
      });
      await expect(
        verifyPrivateReleaseTarget({
          mode: "publisher",
          environment: {
            GITHUB_REPOSITORY: "BlackettApplied/ThermiteSchematics",
            GITHUB_TOKEN: "test-token",
          },
          request: async () =>
            response({
              ...repository,
              permissions: { push: false },
            }),
        }),
      ).rejects.toThrow(
        "AUTH002 Publisher principal lacks repository push permission.",
      );
    } finally {
      const observed = await lstat(temporaryRoot, { bigint: true });
      expect(observed.dev).toBe(captured.dev);
      expect(observed.ino).toBe(captured.ino);
      await rm(temporaryRoot, {
        recursive: true,
        force: false,
        maxRetries: 10,
        retryDelay: 100,
      });
    }
  });
});
