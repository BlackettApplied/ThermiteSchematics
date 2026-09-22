import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, inflateSync } from "node:zlib";

import { parseTree } from "jsonc-parser";
import * as prettier from "prettier";

export const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const RELEASE_VERSION = "0.2.0";
export const RELEASE_ARTIFACT = `thermite-cli-${RELEASE_VERSION}.tgz`;
// Release inputs are source/configuration objects, not media archives. 64 MiB is
// comfortably above the repository's largest tracked object and plausible pack
// entry while keeping corrupt object metadata from driving unbounded allocation.
export const MAX_RELEASE_GIT_OBJECT_SIZE = 64 * 1024 * 1024;
export const RELEASE_OUTPUT_NAMES = Object.freeze([
  RELEASE_ARTIFACT,
  `${RELEASE_ARTIFACT}.sha256`,
  `thermite-cli-${RELEASE_VERSION}.tar-headers.json`,
  `thermite-cli-${RELEASE_VERSION}.stage-files.json`,
  `thermite-cli-${RELEASE_VERSION}.runtime-closure.json`,
  `thermite-cli-${RELEASE_VERSION}.third-party-licenses.json`,
  `thermite-cli-${RELEASE_VERSION}.build-provenance.json`,
]);

export const WORKSPACES = Object.freeze(
  [
    [
      "agent-tools",
      "@thermite/agent-tools",
      "package/node_modules/@thermite/agent-tools",
    ],
    ["cli", "@thermite/cli", "package"],
    [
      "compiler",
      "@thermite/compiler",
      "package/node_modules/@thermite/compiler",
    ],
    [
      "core-library",
      "@thermite/core-library",
      "package/node_modules/@thermite/core-library",
    ],
    ["query", "@thermite/query", "package/node_modules/@thermite/query"],
    ["render", "@thermite/render", "package/node_modules/@thermite/render"],
    ["schema", "@thermite/schema", "package/node_modules/@thermite/schema"],
  ].map(([directory, name, stagePath]) =>
    Object.freeze({ directory, name, stagePath }),
  ),
);

export function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function toPosixPath(value) {
  return value.split(sep).join("/");
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function canonicalizeJson(value) {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort(compareCodeUnits)
        .map((key) => [key, canonicalizeJson(value[key])]),
    );
  }
  return value;
}

export function serializeCanonicalJson(value) {
  return `${JSON.stringify(value, undefined, 2)}\n`;
}

function rejectDuplicateMembers(node, file) {
  if (node.type === "object") {
    const seen = new Set();
    for (const property of node.children ?? []) {
      const keyNode = property.children?.[0];
      const valueNode = property.children?.[1];
      const key = keyNode?.value;
      if (typeof key !== "string" || valueNode === undefined) {
        throw new Error(`Invalid JSON object member in ${file}.`);
      }
      if (seen.has(key)) {
        throw new Error(
          `Duplicate JSON member ${JSON.stringify(key)} in ${file}.`,
        );
      }
      seen.add(key);
      rejectDuplicateMembers(valueNode, file);
    }
    return;
  }
  if (node.type === "array") {
    for (const child of node.children ?? [])
      rejectDuplicateMembers(child, file);
  }
}

export function parseJsonBytes(bytes, file) {
  const text = Buffer.from(bytes).toString("utf8");
  if (!Buffer.from(text, "utf8").equals(Buffer.from(bytes))) {
    throw new Error(`Invalid UTF-8 JSON in ${file}.`);
  }
  const errors = [];
  const tree = parseTree(text, errors, {
    allowEmptyContent: false,
    allowTrailingComma: false,
    disallowComments: true,
  });
  if (tree === undefined || errors.length !== 0) {
    throw new Error(`Invalid strict JSON in ${file}.`);
  }
  rejectDuplicateMembers(tree, file);
  return JSON.parse(text);
}

export async function readJsonFile(file) {
  return parseJsonBytes(await readFile(file), file);
}

function invalidGitIndex(message) {
  return new Error(`REL034 Git index is invalid: ${message}`);
}

export function assertGitPath(value, label = "Git path") {
  if (
    typeof value !== "string" ||
    value === "" ||
    value.includes("\0") ||
    value.includes(String.fromCharCode(92)) ||
    isAbsolute(value) ||
    /^[A-Za-z]:($|\/)/u.test(value) ||
    value
      .split("/")
      .some(
        (part) =>
          part === "" ||
          part === "." ||
          part === ".." ||
          part.toLowerCase() === ".git" ||
          /^[A-Za-z]:/u.test(part),
      )
  ) {
    throw invalidGitIndex(`unsafe ${label} ${JSON.stringify(value)}.`);
  }
}

export function parseGitIndexEntries(input) {
  const bytes = Buffer.from(input);
  if (bytes.length < 32) throw invalidGitIndex("the file is truncated.");
  const trailerStart = bytes.length - 20;
  const expectedChecksum = bytes.subarray(trailerStart);
  const observedChecksum = createHash("sha1")
    .update(bytes.subarray(0, trailerStart))
    .digest();
  if (!observedChecksum.equals(expectedChecksum)) {
    throw invalidGitIndex("the trailing SHA-1 checksum does not match.");
  }
  if (!bytes.subarray(0, 4).equals(Buffer.from("DIRC"))) {
    throw invalidGitIndex("the signature is not DIRC.");
  }
  const version = bytes.readUInt32BE(4);
  if (version !== 2 && version !== 3) {
    throw invalidGitIndex(`unsupported version ${version}.`);
  }
  const entryCount = bytes.readUInt32BE(8);
  const entries = [];
  const paths = new Set();
  let previousPathBytes;
  let offset = 12;
  for (let index = 0; index < entryCount; index += 1) {
    const entryStart = offset;
    if (entryStart + 62 > trailerStart) {
      throw invalidGitIndex("an entry is truncated.");
    }
    const mode = bytes.readUInt32BE(entryStart + 24).toString(8);
    if (!["40000", "100644", "100755", "120000", "160000"].includes(mode)) {
      throw invalidGitIndex(`an entry has unsupported mode ${mode}.`);
    }
    const objectId = bytes
      .subarray(entryStart + 40, entryStart + 60)
      .toString("hex");
    const flags = bytes.readUInt16BE(entryStart + 60);
    const extended = (flags & 0x4000) !== 0;
    offset = entryStart + 62;
    if (version === 2 && extended) {
      throw invalidGitIndex("a version-2 entry sets the extended flag.");
    }
    if (version === 3 && extended) {
      if (offset + 2 > trailerStart) {
        throw invalidGitIndex("an extended entry is truncated.");
      }
      const extendedFlags = bytes.readUInt16BE(offset);
      if ((extendedFlags & ~0x6000) !== 0) {
        throw invalidGitIndex("a version-3 entry sets a reserved flag.");
      }
      offset += 2;
    }
    const declaredLength = flags & 0x0fff;
    const nameStart = offset;
    let nameEnd;
    if (declaredLength < 0x0fff) {
      nameEnd = nameStart + declaredLength;
      if (
        nameEnd >= trailerStart ||
        bytes[nameEnd] !== 0 ||
        bytes.indexOf(0, nameStart) !== nameEnd
      ) {
        throw invalidGitIndex("an entry pathname length is invalid.");
      }
    } else {
      nameEnd = bytes.indexOf(0, nameStart);
      if (nameEnd === -1 || nameEnd >= trailerStart) {
        throw invalidGitIndex("an entry pathname is unterminated.");
      }
      if (nameEnd - nameStart < 0x0fff) {
        throw invalidGitIndex(
          "a 0xFFF pathname length represents fewer than 4095 bytes.",
        );
      }
    }
    const pathBytes = bytes.subarray(nameStart, nameEnd);
    if (pathBytes.some((byte) => byte > 0x7f)) {
      throw invalidGitIndex("an entry pathname is not 7-bit clean.");
    }
    const path = pathBytes.toString("latin1");
    assertGitPath(path, "entry path");
    const entryLength = nameEnd + 1 - entryStart;
    offset = entryStart + Math.ceil(entryLength / 8) * 8;
    if (offset > trailerStart) {
      throw invalidGitIndex("an entry padding region is truncated.");
    }
    for (let padding = nameEnd; padding < offset; padding += 1) {
      if (bytes[padding] !== 0) {
        throw invalidGitIndex("an entry has nonzero padding.");
      }
    }

    const stage = (flags & 0x3000) >>> 12;
    if (stage !== 0) {
      throw invalidGitIndex(`an unresolved stage exists for ${path}.`);
    }
    if (
      previousPathBytes !== undefined &&
      Buffer.compare(previousPathBytes, pathBytes) >= 0
    ) {
      throw invalidGitIndex("stage-0 entry paths are not strictly sorted.");
    }
    if (paths.has(path)) {
      throw invalidGitIndex(`duplicate stage-0 path ${path}.`);
    }
    paths.add(path);
    previousPathBytes = Buffer.from(pathBytes);
    entries.push(Object.freeze({ path, mode, objectId }));
  }

  while (offset < trailerStart) {
    if (offset + 8 > trailerStart) {
      throw invalidGitIndex("an extension header is truncated.");
    }
    const signature = bytes.subarray(offset, offset + 4);
    if (
      !signature.every(
        (byte) =>
          (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a),
      )
    ) {
      throw invalidGitIndex("an extension signature is malformed.");
    }
    if (signature[0] >= 0x61 && signature[0] <= 0x7a) {
      throw invalidGitIndex(
        `required extension ${signature.toString("latin1")} is unsupported.`,
      );
    }
    const extensionSize = bytes.readUInt32BE(offset + 4);
    offset += 8;
    if (offset + extensionSize > trailerStart) {
      throw invalidGitIndex("an extension exceeds the checksum boundary.");
    }
    offset += extensionSize;
  }
  if (offset !== trailerStart) {
    throw invalidGitIndex("extensions do not end at the checksum boundary.");
  }
  return Object.freeze(entries);
}

export async function readGitIndexEntries(repositoryRoot = REPOSITORY_ROOT) {
  return parseGitIndexEntries(
    await readFile(join(repositoryRoot, ".git", "index")),
  );
}

async function gitDirectory(repositoryRoot) {
  const directory = join(repositoryRoot, ".git");
  let stats;
  try {
    stats = await lstat(directory, { bigint: true });
  } catch {
    throw new Error(
      "REL024 Git repository metadata is invalid: .git is missing.",
    );
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(
      "REL024 Git repository metadata is invalid: .git is not an ordinary directory.",
    );
  }
  if (await pathExists(join(directory, "objects", "info", "alternates"))) {
    throw new Error(
      "REL024 Git repository metadata is invalid: object alternates are forbidden.",
    );
  }
  return directory;
}

function parseObjectId(value, context) {
  if (!/^[0-9a-f]{40}$/u.test(value)) {
    throw new Error(`REL024 Git repository metadata is invalid: ${context}.`);
  }
  return value;
}

function parseRefLine(bytes, context) {
  const input = Buffer.from(bytes);
  if (input.some((byte) => byte > 0x7f) || input.includes(0x0d)) {
    throw new Error(`REL024 Git repository metadata is invalid: ${context}.`);
  }
  const value = input.toString("latin1");
  const line = value.endsWith("\n") ? value.slice(0, -1) : value;
  if (line === "" || line.includes("\n")) {
    throw new Error(`REL024 Git repository metadata is invalid: ${context}.`);
  }
  return line;
}

function validateRefName(ref, context, { headsOnly = false } = {}) {
  if (headsOnly && !ref.startsWith("refs/heads/")) {
    throw new Error(
      "REL024 Git repository metadata is invalid: HEAD must name a branch ref or a detached commit.",
    );
  }
  const components = typeof ref === "string" ? ref.split("/") : [];
  if (
    typeof ref !== "string" ||
    ref === "" ||
    ref === "@" ||
    ref.startsWith("/") ||
    ref.endsWith("/") ||
    ref.endsWith(".") ||
    ref.includes("//") ||
    ref.includes("..") ||
    ref.includes("@{") ||
    /[\u0000-\u0020\u007f-\uffff~^:?*[\\]/u.test(ref) ||
    components.length < 2 ||
    components.some(
      (component) =>
        component === "" ||
        component.startsWith(".") ||
        component.endsWith(".lock"),
    )
  ) {
    throw new Error(`REL024 Git repository metadata is invalid: ${context}.`);
  }
  return ref;
}

async function readLooseRef(gitRoot, ref) {
  const path = resolve(gitRoot, ...ref.split("/"));
  const child = relative(gitRoot, path);
  if (child.startsWith(`..${sep}`) || child === ".." || isAbsolute(child)) {
    throw new Error(
      "REL024 Git repository metadata is invalid: HEAD ref escaped .git.",
    );
  }
  try {
    await assertContainedPath(gitRoot, path);
    const stats = await lstat(path, { bigint: true });
    if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1n) {
      throw new Error(
        "REL024 Git repository metadata is invalid: loose HEAD ref is not an ordinary file.",
      );
    }
    const value = parseRefLine(await readFile(path), "loose ref is malformed");
    if (/^[0-9a-f]{40}$/u.test(value)) return { objectId: value };
    if (!value.startsWith("ref: ")) {
      throw new Error(
        "REL024 Git repository metadata is invalid: loose ref is malformed.",
      );
    }
    const target = value.slice("ref: ".length);
    validateRefName(target, "loose symbolic ref target is invalid");
    return { target };
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

async function readPackedRef(gitRoot, targetRef) {
  let bytes;
  try {
    const path = join(gitRoot, "packed-refs");
    const stats = await lstat(path, { bigint: true });
    if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1n) {
      throw new Error(
        "REL024 Git repository metadata is invalid: packed-refs is not an ordinary file.",
      );
    }
    bytes = await readFile(path);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
  if (bytes.some((byte) => byte > 0x7f) || bytes.includes(0x0d)) {
    throw new Error(
      "REL024 Git repository metadata is invalid: packed-refs is malformed.",
    );
  }
  const text = bytes.toString("latin1");
  let matchId;
  let previousRef;
  let previousWasPeeled = false;
  const refs = new Set();
  for (const line of text.split("\n")) {
    if (line === "" || line.startsWith("#")) {
      previousRef = undefined;
      previousWasPeeled = false;
      continue;
    }
    if (line.startsWith("^")) {
      if (
        previousRef === undefined ||
        !previousRef.startsWith("refs/tags/") ||
        previousWasPeeled
      ) {
        throw new Error(
          "REL024 Git repository metadata is invalid: packed-refs has an invalid peel line.",
        );
      }
      parseObjectId(line.slice(1), "packed-refs peel is malformed");
      previousWasPeeled = true;
      continue;
    }
    const match = /^([0-9a-f]{40}) (refs\/[^ ]+)$/u.exec(line);
    if (match === null) {
      throw new Error(
        "REL024 Git repository metadata is invalid: packed-refs has a malformed row.",
      );
    }
    previousRef = match[2];
    validateRefName(previousRef, "packed-refs contains an invalid ref name");
    if (refs.has(previousRef)) {
      throw new Error(
        "REL024 Git repository metadata is invalid: packed-refs contains a duplicate ref.",
      );
    }
    refs.add(previousRef);
    previousWasPeeled = false;
    if (previousRef === targetRef) matchId = match[1];
  }
  return matchId;
}

async function resolveRef(gitRoot, ref, depth, seen) {
  if (seen.has(ref)) {
    throw new Error(
      "REL024 Git repository metadata is invalid: symbolic ref cycle.",
    );
  }
  seen.add(ref);
  try {
    const loose = await readLooseRef(gitRoot, ref);
    if (loose?.objectId !== undefined) return loose.objectId;
    if (loose?.target !== undefined) {
      if (depth >= 5) {
        throw new Error(
          "REL024 Git repository metadata is invalid: symbolic ref depth exceeds 5.",
        );
      }
      return await resolveRef(gitRoot, loose.target, depth + 1, seen);
    }
    const packed = await readPackedRef(gitRoot, ref);
    if (packed !== undefined) return packed;
    throw new Error(
      "REL024 Git repository metadata is invalid: symbolic ref target is missing.",
    );
  } finally {
    seen.delete(ref);
  }
}

export async function resolveHeadCommit(repositoryRoot = REPOSITORY_ROOT) {
  const gitRoot = await gitDirectory(repositoryRoot);
  let headBytes;
  try {
    const headPath = join(gitRoot, "HEAD");
    const stats = await lstat(headPath, { bigint: true });
    if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1n) {
      throw new Error(
        "REL024 Git repository metadata is invalid: HEAD is not an ordinary file.",
      );
    }
    headBytes = await readFile(headPath);
  } catch {
    throw new Error(
      "REL024 Git repository metadata is invalid: HEAD is missing.",
    );
  }
  const value = parseRefLine(headBytes, "HEAD is malformed");
  if (/^[0-9a-f]{40}$/u.test(value)) return value;
  if (!value.startsWith("ref: ")) {
    throw new Error(
      "REL024 Git repository metadata is invalid: HEAD is malformed.",
    );
  }
  const ref = value.slice("ref: ".length);
  validateRefName(ref, "unsafe HEAD ref", { headsOnly: true });
  return resolveRef(gitRoot, ref, 0, new Set());
}

function malformedGitObject(context) {
  return new Error(
    `REL027 Git object data is truncated or malformed: ${context}.`,
  );
}

function inflateGitBytes(
  compressed,
  context,
  maxOutputLength = MAX_RELEASE_GIT_OBJECT_SIZE,
) {
  try {
    const result = inflateSync(compressed, { info: true, maxOutputLength });
    if (result.engine.bytesWritten !== compressed.byteLength) {
      throw malformedGitObject(`${context} has trailing compressed bytes`);
    }
    return Buffer.from(result.buffer);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("REL027 ")) {
      throw error;
    }
    if (error?.code === "ERR_BUFFER_TOO_LARGE") {
      throw malformedGitObject(`${context} exceeds the release object limit`);
    }
    throw new Error(`REL028 Git object inflate failed: ${context}.`);
  }
}

function gitObjectId(type, bytes) {
  return createHash("sha1")
    .update(`${type} ${bytes.byteLength}\0`)
    .update(bytes)
    .digest("hex");
}

function verifyObjectIdentity(object, expectedObjectId) {
  if (gitObjectId(object.type, object.bytes) !== expectedObjectId) {
    throw new Error(`REL029 Git object hash mismatch: ${expectedObjectId}.`);
  }
  return Object.freeze({ type: object.type, bytes: object.bytes });
}

async function readLooseGitObject(gitRoot, objectId) {
  const path = join(
    gitRoot,
    "objects",
    objectId.slice(0, 2),
    objectId.slice(2),
  );
  let compressed;
  try {
    const stats = await lstat(path, { bigint: true });
    if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1n) {
      throw malformedGitObject(`loose object ${objectId} is not ordinary`);
    }
    if (stats.size > BigInt(MAX_RELEASE_GIT_OBJECT_SIZE)) {
      throw malformedGitObject(
        `loose object ${objectId} exceeds the release object limit`,
      );
    }
    compressed = await readFile(path);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
  const inflated = inflateGitBytes(
    compressed,
    `loose object ${objectId}`,
    MAX_RELEASE_GIT_OBJECT_SIZE + 64,
  );
  const headerEnd = inflated.indexOf(0);
  if (headerEnd === -1) throw malformedGitObject(`loose object ${objectId}`);
  const header = inflated.subarray(0, headerEnd);
  if (header.some((byte) => byte > 0x7f)) {
    throw malformedGitObject(`loose object ${objectId}`);
  }
  const match = /^(commit|tree|blob|tag) (0|[1-9][0-9]*)$/u.exec(
    header.toString("latin1"),
  );
  if (match === null) throw malformedGitObject(`loose object ${objectId}`);
  const size = Number(match[2]);
  const body = inflated.subarray(headerEnd + 1);
  if (
    !Number.isSafeInteger(size) ||
    size > MAX_RELEASE_GIT_OBJECT_SIZE ||
    size !== body.byteLength
  ) {
    throw malformedGitObject(`loose object ${objectId} has the wrong size`);
  }
  if (createHash("sha1").update(inflated).digest("hex") !== objectId) {
    throw new Error(`REL029 Git object hash mismatch: ${objectId}.`);
  }
  return Object.freeze({ type: match[1], bytes: body });
}

function parsePackIndex(bytes, indexPath) {
  if (bytes.length < 8 + 256 * 4 + 40) {
    throw malformedGitObject(`pack index ${indexPath}`);
  }
  if (
    !bytes.subarray(0, 4).equals(Buffer.from([0xff, 0x74, 0x4f, 0x63])) ||
    bytes.readUInt32BE(4) !== 2
  ) {
    throw malformedGitObject(`pack index ${indexPath} is not version 2`);
  }
  const expectedIndexChecksum = bytes.subarray(bytes.length - 20);
  const observedIndexChecksum = createHash("sha1")
    .update(bytes.subarray(0, bytes.length - 20))
    .digest();
  if (!observedIndexChecksum.equals(expectedIndexChecksum)) {
    throw new Error(
      `REL029 Git object hash mismatch: pack index ${indexPath}.`,
    );
  }
  const fanout = [];
  for (let index = 0; index < 256; index += 1) {
    const count = bytes.readUInt32BE(8 + index * 4);
    if (index > 0 && count < fanout[index - 1]) {
      throw malformedGitObject(`pack index ${indexPath} fanout`);
    }
    fanout.push(count);
  }
  const count = fanout[255];
  const namesStart = 8 + 256 * 4;
  const namesEnd = namesStart + count * 20;
  const crcStart = namesEnd;
  const offsetsStart = crcStart + count * 4;
  const largeOffsetsStart = offsetsStart + count * 4;
  const trailerStart = bytes.length - 40;
  if (
    !Number.isSafeInteger(largeOffsetsStart) ||
    largeOffsetsStart > trailerStart ||
    (trailerStart - largeOffsetsStart) % 8 !== 0
  ) {
    throw malformedGitObject(`pack index ${indexPath} tables`);
  }
  const largeOffsetCount = (trailerStart - largeOffsetsStart) / 8;
  const entries = [];
  let previousName;
  const observedFanout = new Array(256).fill(0);
  const referencedLargeOffsets = new Set();
  for (let index = 0; index < count; index += 1) {
    const name = Buffer.from(
      bytes.subarray(namesStart + index * 20, namesStart + (index + 1) * 20),
    );
    if (previousName !== undefined && Buffer.compare(previousName, name) >= 0) {
      throw malformedGitObject(`pack index ${indexPath} object-name order`);
    }
    previousName = name;
    observedFanout[name[0]] += 1;
    const shortOffset = bytes.readUInt32BE(offsetsStart + index * 4);
    let offset;
    if ((shortOffset & 0x80000000) === 0) {
      offset = shortOffset;
    } else {
      const largeIndex = shortOffset & 0x7fffffff;
      if (largeIndex >= largeOffsetCount) {
        throw malformedGitObject(`pack index ${indexPath} large offset`);
      }
      referencedLargeOffsets.add(largeIndex);
      const large = bytes.readBigUInt64BE(largeOffsetsStart + largeIndex * 8);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw malformedGitObject(`pack index ${indexPath} unsafe offset`);
      }
      offset = Number(large);
    }
    entries.push(
      Object.freeze({
        objectId: name.toString("hex"),
        offset,
        crc: bytes.readUInt32BE(crcStart + index * 4),
      }),
    );
  }
  let cumulative = 0;
  for (let index = 0; index < 256; index += 1) {
    cumulative += observedFanout[index];
    if (fanout[index] !== cumulative) {
      throw malformedGitObject(`pack index ${indexPath} fanout`);
    }
  }
  if (referencedLargeOffsets.size !== largeOffsetCount) {
    throw malformedGitObject(`pack index ${indexPath} large-offset table`);
  }
  const objectIdByOffset = new Map();
  for (const entry of entries) {
    if (entry.offset < 12 || objectIdByOffset.has(entry.offset)) {
      throw malformedGitObject(`pack index ${indexPath} object offset`);
    }
    objectIdByOffset.set(entry.offset, entry.objectId);
  }
  return Object.freeze({
    indexPath,
    packPath: indexPath.slice(0, -4) + ".pack",
    count,
    entries: Object.freeze(entries),
    entriesById: new Map(entries.map((entry) => [entry.objectId, entry])),
    objectIdByOffset,
    packChecksum: Buffer.from(bytes.subarray(trailerStart, trailerStart + 20)),
  });
}

async function readExact(handle, length, position, context) {
  if (
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > MAX_RELEASE_GIT_OBJECT_SIZE
  ) {
    throw malformedGitObject(`${context} exceeds the release object limit`);
  }
  const output = Buffer.alloc(length);
  let read = 0;
  while (read < length) {
    const result = await handle.read(
      output,
      read,
      length - read,
      position + read,
    );
    if (result.bytesRead === 0) throw malformedGitObject(context);
    read += result.bytesRead;
  }
  return output;
}

async function loadPackState(context, index) {
  const cached = context.packStates.get(index.packPath);
  if (cached !== undefined) return cached;
  let handle;
  try {
    const pathStats = await lstat(index.packPath, { bigint: true });
    if (
      !pathStats.isFile() ||
      pathStats.isSymbolicLink() ||
      pathStats.nlink !== 1n
    ) {
      throw malformedGitObject(`pack ${index.packPath} is not ordinary`);
    }
    handle = await open(index.packPath, "r");
    const stats = await handle.stat({ bigint: true });
    if (!stats.isFile() || stats.nlink !== 1n) {
      throw malformedGitObject(`pack ${index.packPath} is not ordinary`);
    }
    if (stats.size > BigInt(Number.MAX_SAFE_INTEGER) || stats.size < 32n) {
      throw malformedGitObject(`pack ${index.packPath} size`);
    }
    const size = Number(stats.size);
    const header = await readExact(handle, 12, 0, `pack ${index.packPath}`);
    const version = header.readUInt32BE(4);
    if (
      !header.subarray(0, 4).equals(Buffer.from("PACK")) ||
      (version !== 2 && version !== 3) ||
      header.readUInt32BE(8) !== index.count
    ) {
      throw malformedGitObject(`pack ${index.packPath} header`);
    }
    const trailer = await readExact(
      handle,
      20,
      size - 20,
      `pack ${index.packPath} trailer`,
    );
    if (!trailer.equals(index.packChecksum)) {
      throw new Error(
        `REL029 Git object hash mismatch: pack ${index.packPath}.`,
      );
    }
    const hash = createHash("sha1");
    const buffer = Buffer.alloc(Math.min(1024 * 1024, size - 20));
    let position = 0;
    while (position < size - 20) {
      const length = Math.min(buffer.byteLength, size - 20 - position);
      const result = await handle.read(buffer, 0, length, position);
      if (result.bytesRead !== length) {
        throw malformedGitObject(`pack ${index.packPath} checksum read`);
      }
      hash.update(buffer.subarray(0, length));
      position += length;
    }
    if (!hash.digest().equals(trailer)) {
      throw new Error(
        `REL029 Git object hash mismatch: pack ${index.packPath}.`,
      );
    }
    const sortedOffsets = [...index.objectIdByOffset.keys()].sort(
      (left, right) => left - right,
    );
    if (sortedOffsets.length !== index.count) {
      throw malformedGitObject(`pack ${index.packPath} offset count`);
    }
    if (sortedOffsets.at(-1) >= size - 20) {
      throw malformedGitObject(`pack ${index.packPath} object offset`);
    }
    const nextOffset = new Map();
    for (let position = 0; position < sortedOffsets.length; position += 1) {
      nextOffset.set(
        sortedOffsets[position],
        sortedOffsets[position + 1] ?? size - 20,
      );
    }
    const state = { handle, size, nextOffset };
    context.packStates.set(index.packPath, state);
    return state;
  } catch (error) {
    await handle?.close();
    throw error;
  }
}

function readPackSize(bytes, cursor, context) {
  if (cursor.offset >= bytes.length) throw malformedGitObject(context);
  let byte = bytes[cursor.offset++];
  const type = (byte >>> 4) & 7;
  let size = byte & 0x0f;
  let shift = 4;
  while ((byte & 0x80) !== 0) {
    if (cursor.offset >= bytes.length || shift > 53) {
      throw malformedGitObject(context);
    }
    byte = bytes[cursor.offset++];
    size += (byte & 0x7f) * 2 ** shift;
    shift += 7;
  }
  if (!Number.isSafeInteger(size) || size > MAX_RELEASE_GIT_OBJECT_SIZE) {
    throw malformedGitObject(`${context} size`);
  }
  return { type, size };
}

function readDeltaSize(bytes, cursor, context) {
  let size = 0;
  let shift = 0;
  let byte;
  do {
    if (cursor.offset >= bytes.length || shift > 49) {
      throw malformedGitObject(context);
    }
    byte = bytes[cursor.offset++];
    size += (byte & 0x7f) * 2 ** shift;
    shift += 7;
  } while ((byte & 0x80) !== 0);
  if (!Number.isSafeInteger(size) || size > MAX_RELEASE_GIT_OBJECT_SIZE) {
    throw malformedGitObject(`${context} size`);
  }
  return size;
}

function applyGitDelta(base, delta, context) {
  const cursor = { offset: 0 };
  const baseSize = readDeltaSize(delta, cursor, context);
  const resultSize = readDeltaSize(delta, cursor, context);
  if (
    base.byteLength > MAX_RELEASE_GIT_OBJECT_SIZE ||
    baseSize !== base.byteLength
  ) {
    throw malformedGitObject(`${context} base size`);
  }
  const output = Buffer.alloc(resultSize);
  let outputOffset = 0;
  while (cursor.offset < delta.length) {
    const instruction = delta[cursor.offset++];
    if (instruction === 0) {
      throw malformedGitObject(`${context} instruction`);
    }
    if ((instruction & 0x80) === 0) {
      const length = instruction & 0x7f;
      if (
        length === 0 ||
        cursor.offset + length > delta.length ||
        outputOffset + length > resultSize
      ) {
        throw malformedGitObject(`${context} insert`);
      }
      delta.copy(output, outputOffset, cursor.offset, cursor.offset + length);
      cursor.offset += length;
      outputOffset += length;
      continue;
    }
    let copyOffset = 0;
    let copySize = 0;
    for (let index = 0; index < 4; index += 1) {
      if ((instruction & (1 << index)) !== 0) {
        if (cursor.offset >= delta.length) {
          throw malformedGitObject(`${context} copy offset`);
        }
        copyOffset += delta[cursor.offset++] * 2 ** (index * 8);
      }
    }
    for (let index = 0; index < 3; index += 1) {
      if ((instruction & (0x10 << index)) !== 0) {
        if (cursor.offset >= delta.length) {
          throw malformedGitObject(`${context} copy size`);
        }
        copySize += delta[cursor.offset++] * 2 ** (index * 8);
      }
    }
    if (copySize === 0) copySize = 0x10000;
    if (
      copyOffset + copySize > base.byteLength ||
      outputOffset + copySize > resultSize
    ) {
      throw malformedGitObject(`${context} copy range`);
    }
    base.copy(output, outputOffset, copyOffset, copyOffset + copySize);
    outputOffset += copySize;
  }
  if (outputOffset !== resultSize) {
    throw malformedGitObject(`${context} result size`);
  }
  return output;
}

async function readPackedEntry(
  context,
  index,
  offset,
  expectedObjectId,
  depth,
) {
  if (depth > 64) {
    throw malformedGitObject("delta recursion depth exceeded");
  }
  const recursionKey = `${index.packPath}:${offset}`;
  if (context.recursion.has(recursionKey)) {
    throw malformedGitObject("delta recursion cycle");
  }
  context.recursion.add(recursionKey);
  try {
    const state = await loadPackState(context, index);
    const end = state.nextOffset.get(offset);
    if (end === undefined || end <= offset) {
      throw malformedGitObject(`pack ${index.packPath} entry offset`);
    }
    if (end - offset > MAX_RELEASE_GIT_OBJECT_SIZE) {
      throw malformedGitObject(
        `pack ${index.packPath} entry ${offset} exceeds the release object limit`,
      );
    }
    const packed = await readExact(
      state.handle,
      end - offset,
      offset,
      `pack ${index.packPath} entry ${offset}`,
    );
    const indexEntry = index.entriesById.get(expectedObjectId);
    if (
      indexEntry === undefined ||
      indexEntry.offset !== offset ||
      crc32(packed) >>> 0 !== indexEntry.crc
    ) {
      throw malformedGitObject(`pack ${index.packPath} entry CRC ${offset}`);
    }
    const cursor = { offset: 0 };
    const header = readPackSize(
      packed,
      cursor,
      `pack ${index.packPath} entry ${offset}`,
    );
    let base;
    if (header.type === 6) {
      if (cursor.offset >= packed.length) {
        throw malformedGitObject(`pack ${index.packPath} OFS_DELTA ${offset}`);
      }
      let byte = packed[cursor.offset++];
      let distance = byte & 0x7f;
      while ((byte & 0x80) !== 0) {
        if (
          cursor.offset >= packed.length ||
          distance > Number.MAX_SAFE_INTEGER / 128
        ) {
          throw malformedGitObject(
            `pack ${index.packPath} OFS_DELTA ${offset}`,
          );
        }
        byte = packed[cursor.offset++];
        distance = (distance + 1) * 128 + (byte & 0x7f);
      }
      const baseOffset = offset - distance;
      const baseObjectId = index.objectIdByOffset.get(baseOffset);
      if (baseOffset < 12 || baseObjectId === undefined) {
        throw malformedGitObject(`pack ${index.packPath} OFS_DELTA base`);
      }
      base = await readPackedEntry(
        context,
        index,
        baseOffset,
        baseObjectId,
        depth + 1,
      );
    } else if (header.type === 7) {
      if (cursor.offset + 20 > packed.length) {
        throw malformedGitObject(`pack ${index.packPath} REF_DELTA ${offset}`);
      }
      const baseObjectId = packed
        .subarray(cursor.offset, cursor.offset + 20)
        .toString("hex");
      cursor.offset += 20;
      base = await loadGitObject(context, baseObjectId, depth + 1);
    } else if (header.type < 1 || header.type > 4 || header.type === 5) {
      throw new Error(
        `REL026 Git object type mismatch: invalid packed type ${header.type} for ${expectedObjectId}.`,
      );
    }
    const inflated = inflateGitBytes(
      packed.subarray(cursor.offset),
      `pack ${index.packPath} entry ${offset}`,
    );
    if (inflated.byteLength !== header.size) {
      throw malformedGitObject(`pack ${index.packPath} entry ${offset} size`);
    }
    let object;
    if (base === undefined) {
      object = {
        type: [undefined, "commit", "tree", "blob", "tag"][header.type],
        bytes: inflated,
      };
    } else {
      object = {
        type: base.type,
        bytes: applyGitDelta(
          base.bytes,
          inflated,
          `pack ${index.packPath} delta ${offset}`,
        ),
      };
    }
    return verifyObjectIdentity(object, expectedObjectId);
  } finally {
    context.recursion.delete(recursionKey);
  }
}

async function loadGitObject(context, objectId, depth = 0) {
  const cached = context.objects.get(objectId);
  if (cached !== undefined) return cached;
  const loose = await readLooseGitObject(context.gitRoot, objectId);
  if (loose !== undefined) {
    context.objects.set(objectId, loose);
    return loose;
  }
  for (const index of context.packIndexes) {
    const entry = index.entriesById.get(objectId);
    if (entry === undefined) continue;
    const object = await readPackedEntry(
      context,
      index,
      entry.offset,
      objectId,
      depth,
    );
    context.objects.set(objectId, object);
    return object;
  }
  throw new Error(`REL025 Git object is unknown: ${objectId}.`);
}

export async function readGitObject(
  repositoryRoot = REPOSITORY_ROOT,
  objectId,
) {
  parseObjectId(objectId, "object id is malformed");
  const gitRoot = await gitDirectory(repositoryRoot);
  const packDirectory = join(gitRoot, "objects", "pack");
  let names = [];
  try {
    names = (await readdir(packDirectory))
      .filter((name) => name.endsWith(".idx"))
      .sort(compareCodeUnits);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const packIndexes = [];
  for (const name of names) {
    const indexPath = join(packDirectory, name);
    const stats = await lstat(indexPath, { bigint: true });
    if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1n) {
      throw malformedGitObject(`pack index ${indexPath} is not ordinary`);
    }
    if (stats.size > BigInt(MAX_RELEASE_GIT_OBJECT_SIZE)) {
      throw malformedGitObject(
        `pack index ${indexPath} exceeds the release object limit`,
      );
    }
    packIndexes.push(parsePackIndex(await readFile(indexPath), indexPath));
  }
  const context = {
    gitRoot,
    packIndexes,
    packStates: new Map(),
    objects: new Map(),
    recursion: new Set(),
  };
  try {
    return await loadGitObject(context, objectId);
  } finally {
    await Promise.all(
      [...context.packStates.values()].map(({ handle }) => handle.close()),
    );
  }
}

export function assertLogicalPath(value, label = "path") {
  if (
    typeof value !== "string" ||
    value === "" ||
    value.includes("\\") ||
    isAbsolute(value) ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    value
      .split("/")
      .some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`Invalid ${label} ${JSON.stringify(value)}.`);
  }
}

export async function assertOrdinaryFile(file, label = file) {
  const stats = await lstat(file, { bigint: true });
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1n) {
    throw new Error(`${label} is not an ordinary single-link file.`);
  }
  return stats;
}

export async function assertOrdinaryDirectory(directory, label = directory) {
  const stats = await lstat(directory, { bigint: true });
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`${label} is not an ordinary directory.`);
  }
  return stats;
}

export async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export async function mkdirExclusive(directory) {
  await mkdir(directory, { recursive: false, mode: 0o755 });
  await chmod(directory, 0o755);
  await assertOrdinaryDirectory(directory);
}

export async function ensureDirectory(directory) {
  const parent = dirname(directory);
  if (parent !== directory && !(await pathExists(parent)))
    await ensureDirectory(parent);
  if (!(await pathExists(directory))) await mkdirExclusive(directory);
  else await assertOrdinaryDirectory(directory);
}

export async function enumerateTree(root, { includeDirectories = false } = {}) {
  await assertOrdinaryDirectory(root);
  const output = [];
  async function visit(directory, prefix) {
    const names = (await readdir(directory)).sort(compareCodeUnits);
    for (const name of names) {
      const absolute = join(directory, name);
      const logical = prefix === "" ? name : `${prefix}/${name}`;
      assertLogicalPath(logical);
      const stats = await lstat(absolute, { bigint: true });
      if (stats.isSymbolicLink()) {
        throw new Error(
          `Symbolic link or reparse entry is forbidden: ${logical}.`,
        );
      }
      if (stats.isDirectory()) {
        if (includeDirectories)
          output.push({ path: logical, type: "directory", stats });
        await visit(absolute, logical);
      } else if (stats.isFile() && stats.nlink === 1n) {
        output.push({ path: logical, type: "file", stats });
      } else {
        throw new Error(
          `Non-ordinary or multiply linked entry is forbidden: ${logical}.`,
        );
      }
    }
  }
  await visit(root, "");
  return output;
}

function materializationDirectories(files) {
  const directories = new Set();
  for (const path of files.keys()) {
    assertLogicalPath(path, "materialized file path");
    const parts = path.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      directories.add(parts.slice(0, index).join("/"));
    }
  }
  return directories;
}

export async function verifyMaterializedFileMap({
  root,
  files,
  executablePaths = new Set(),
  label = "Materialized tree",
  platform = process.platform,
  enumerate = enumerateTree,
  fileReader = readFile,
} = {}) {
  if (!(files instanceof Map)) {
    throw new Error(`${label} requires an immutable file map.`);
  }
  await assertOrdinaryDirectory(root, label);
  const directories = materializationDirectories(files);
  const expectedEntries = [
    ...[...directories].map((path) => ({ path, type: "directory" })),
    ...[...files.keys()].map((path) => ({ path, type: "file" })),
  ].sort(({ path: left }, { path: right }) => compareCodeUnits(left, right));
  const observedEntries = await enumerate(root, { includeDirectories: true });
  if (
    JSON.stringify(
      observedEntries.map(({ path, type }) => ({ path, type })),
    ) !== JSON.stringify(expectedEntries)
  ) {
    throw new Error(`${label} path/type set differs from its immutable map.`);
  }
  for (const entry of observedEntries) {
    if (entry.stats.isSymbolicLink()) {
      throw new Error(`${label} contains a reparse entry: ${entry.path}.`);
    }
    const expectedMode =
      entry.type === "directory" || executablePaths.has(entry.path)
        ? 0o755
        : 0o644;
    // Windows does not expose POSIX execute bits through stat/chmod. The pinned
    // release authority is Linux; callers can inject Linux-shaped stats in the
    // cross-platform rejection tests.
    if (
      platform !== "win32" &&
      (Number(entry.stats.mode) & 0o777) !== expectedMode
    ) {
      throw new Error(`${label} has the wrong normalized mode: ${entry.path}.`);
    }
    if (entry.type === "file") {
      if (entry.stats.nlink !== 1n) {
        throw new Error(
          `${label} contains a multiply linked file: ${entry.path}.`,
        );
      }
      const expectedBytes = files.get(entry.path);
      const observedBytes = Buffer.from(
        await fileReader(join(root, ...entry.path.split("/"))),
      );
      if (sha256(observedBytes) !== sha256(expectedBytes)) {
        throw new Error(
          `${label} bytes differ from its immutable map: ${entry.path}.`,
        );
      }
    }
  }
}

export async function materializeFileMap({
  root,
  files,
  executablePaths = new Set(),
  label = "Materialized tree",
  precreatedRoot = false,
} = {}) {
  if (!(files instanceof Map)) {
    throw new Error(`${label} requires an immutable file map.`);
  }
  if (precreatedRoot) {
    await assertOrdinaryDirectory(root, label);
    if (
      (await enumerateTree(root, { includeDirectories: true })).length !== 0
    ) {
      throw new Error(`${label} precreated root is not empty.`);
    }
  } else {
    await mkdirExclusive(root);
  }
  for (const path of [...files.keys()].sort(compareCodeUnits)) {
    await writeExclusiveFile(
      join(root, ...path.split("/")),
      files.get(path),
      executablePaths.has(path) ? 0o755 : 0o644,
    );
  }
  await verifyMaterializedFileMap({ root, files, executablePaths, label });
}

export async function copyOrdinaryFile(source, destination, mode = 0o644) {
  await assertOrdinaryFile(source, source);
  await ensureDirectory(dirname(destination));
  if (await pathExists(destination)) {
    throw new Error(`Release destination already exists: ${destination}.`);
  }
  await copyFile(source, destination);
  await assertOrdinaryFile(destination, destination);
  const handle = await open(destination, "r+");
  try {
    await handle.chmod(mode);
  } finally {
    await handle.close();
  }
}

export async function writeExclusiveFile(path, bytes, mode = 0o644) {
  await ensureDirectory(dirname(path));
  const handle = await open(path, "wx", mode);
  try {
    await handle.writeFile(bytes);
    await handle.chmod(mode);
  } finally {
    await handle.close();
  }
  await assertOrdinaryFile(path);
}

export async function writeAtomicFile(path, bytes) {
  await ensureDirectory(dirname(path));
  const temporary = `${path}.task6-tmp`;
  if (await pathExists(temporary)) {
    throw new Error(
      `Atomic-write temporary path already exists: ${temporary}.`,
    );
  }
  await writeFile(temporary, bytes, { flag: "wx" });
  await assertOrdinaryFile(temporary);
  if (await pathExists(path)) {
    await rm(temporary, { force: false });
    throw new Error(`Atomic-write destination already exists: ${path}.`);
  }
  await rename(temporary, path);
  await assertOrdinaryFile(path);
}

export async function formatCommittedJson(value, destination) {
  const formatted = await prettier.format(serializeCanonicalJson(value), {
    ...(await prettier.resolveConfig(destination)),
    filepath: destination,
  });
  if (!formatted.endsWith("\n") || formatted.includes("\r")) {
    throw new Error(
      `Prettier produced noncanonical line endings for ${destination}.`,
    );
  }
  return formatted;
}

export async function writeCommittedJson(value, destination) {
  const formatted = await formatCommittedJson(value, destination);
  await writeAtomicFile(destination, formatted);
  const written = await readFile(destination, "utf8");
  const second = await prettier.format(written, {
    ...(await prettier.resolveConfig(destination)),
    filepath: destination,
  });
  if (written !== second) {
    throw new Error(`Committed JSON is not Prettier-stable: ${destination}.`);
  }
}

export async function assertContainedPath(root, target) {
  const roots = await Promise.all([realpath(root), realpath(target)]);
  const child = relative(roots[0], roots[1]);
  if (
    child === "" ||
    child === ".." ||
    child.startsWith(".." + sep) ||
    isAbsolute(child)
  ) {
    throw new Error(`Path escaped its declared root: ${target}.`);
  }
  return roots[1];
}

export function parseNamedArguments(argv, specification) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (
      !specification.includes(flag) ||
      value === undefined ||
      values[flag] !== undefined
    ) {
      throw new Error(`Invalid command arguments: ${argv.join(" ")}.`);
    }
    values[flag] = value;
  }
  return values;
}
