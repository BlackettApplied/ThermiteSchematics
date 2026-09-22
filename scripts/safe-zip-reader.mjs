import { open, lstat, mkdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const ZIP64_SENTINEL = 0xffffffff;

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertRange(bytes, offset, length, label) {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > bytes.length
  ) {
    throw new Error(`ZIP001 Truncated ${label}.`);
  }
}

function decodeName(bytes, utf8, label) {
  if (!utf8 && bytes.some((byte) => byte > 0x7f)) {
    throw new Error(`ZIP001 Non-UTF-8 ${label} is forbidden.`);
  }
  const decoder = new TextDecoder(utf8 ? "utf-8" : "ascii", {
    fatal: true,
  });
  try {
    return decoder.decode(bytes);
  } catch {
    throw new Error(`ZIP001 Invalid ${label} encoding.`);
  }
}

function assertZipPath(path, directory) {
  const logical = directory ? path.slice(0, -1) : path;
  if (
    logical === "" ||
    path.includes("\\") ||
    isAbsolute(logical) ||
    /^[A-Za-z]:/u.test(logical) ||
    /^\/{2}/u.test(logical) ||
    /[\u0000-\u001f\u007f]/u.test(logical) ||
    logical
      .split("/")
      .some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error(`ZIP001 Unsafe archive path ${JSON.stringify(path)}.`);
  }
  return logical;
}

const CRC_TABLE = Object.freeze(
  Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 0 ? value >>> 1 : 0xedb88320 ^ (value >>> 1);
    }
    return value >>> 0;
  }),
);

export function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function findEndOfCentralDirectory(bytes) {
  const minimum = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (bytes.readUInt32LE(offset) !== EOCD_SIGNATURE) continue;
    const commentLength = bytes.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength === bytes.length) return offset;
  }
  throw new Error("ZIP001 End-of-central-directory record is absent.");
}

function parseEndOfCentralDirectory(bytes) {
  const offset = findEndOfCentralDirectory(bytes);
  assertRange(bytes, offset, 22, "end-of-central-directory record");
  const disk = bytes.readUInt16LE(offset + 4);
  const centralDisk = bytes.readUInt16LE(offset + 6);
  const diskEntries = bytes.readUInt16LE(offset + 8);
  const entries = bytes.readUInt16LE(offset + 10);
  const centralSize = bytes.readUInt32LE(offset + 12);
  const centralOffset = bytes.readUInt32LE(offset + 16);
  if (
    disk !== 0 ||
    centralDisk !== 0 ||
    diskEntries !== entries ||
    entries === 0xffff ||
    centralSize === ZIP64_SENTINEL ||
    centralOffset === ZIP64_SENTINEL ||
    centralOffset + centralSize !== offset
  ) {
    throw new Error(
      "ZIP001 Multi-disk, ZIP64, or malformed archives are forbidden.",
    );
  }
  return { entries, centralOffset, centralSize };
}

function assertEntryType(versionMadeBy, externalAttributes, directory, path) {
  const host = versionMadeBy >>> 8;
  if (host !== 3) return;
  const mode = externalAttributes >>> 16;
  if (mode === 0) return;
  const type = mode & 0xf000;
  const expected = directory ? 0x4000 : 0x8000;
  if (type !== expected) {
    throw new Error(`ZIP001 Link or non-ordinary entry is forbidden: ${path}.`);
  }
}

function parseCentralEntries(bytes, end) {
  const entries = [];
  const seenPaths = new Set();
  const seenLocalOffsets = new Set();
  let offset = end.centralOffset;
  for (let index = 0; index < end.entries; index += 1) {
    assertRange(bytes, offset, 46, "central-directory header");
    if (bytes.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new Error("ZIP001 Invalid central-directory signature.");
    }
    const versionMadeBy = bytes.readUInt16LE(offset + 4);
    const flags = bytes.readUInt16LE(offset + 8);
    const method = bytes.readUInt16LE(offset + 10);
    const checksum = bytes.readUInt32LE(offset + 16);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const size = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const disk = bytes.readUInt16LE(offset + 34);
    const externalAttributes = bytes.readUInt32LE(offset + 38);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const total = 46 + nameLength + extraLength + commentLength;
    assertRange(bytes, offset, total, "central-directory entry");
    if (
      disk !== 0 ||
      compressedSize === ZIP64_SENTINEL ||
      size === ZIP64_SENTINEL ||
      localOffset === ZIP64_SENTINEL ||
      (flags & 0x0001) !== 0 ||
      (method !== 0 && method !== 8)
    ) {
      throw new Error("ZIP001 Encrypted, ZIP64, or unsupported ZIP entry.");
    }
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength);
    const path = decodeName(
      nameBytes,
      (flags & 0x0800) !== 0,
      "entry pathname",
    );
    const directory = path.endsWith("/");
    const logicalPath = assertZipPath(path, directory);
    assertEntryType(versionMadeBy, externalAttributes, directory, path);
    if (seenPaths.has(logicalPath) || seenLocalOffsets.has(localOffset)) {
      throw new Error(`ZIP001 Duplicate archive entry: ${logicalPath}.`);
    }
    if (directory && (size !== 0 || compressedSize !== 0)) {
      throw new Error(`ZIP001 Directory entry has content: ${logicalPath}.`);
    }
    seenPaths.add(logicalPath);
    seenLocalOffsets.add(localOffset);
    entries.push({
      path: logicalPath,
      directory,
      flags,
      method,
      checksum,
      compressedSize,
      size,
      localOffset,
      nameBytes: Buffer.from(nameBytes),
    });
    offset += total;
  }
  if (offset !== end.centralOffset + end.centralSize) {
    throw new Error("ZIP001 Central-directory size mismatch.");
  }
  return entries;
}

async function inflateEntry(method, bytes) {
  if (method === 0) return Buffer.from(bytes);
  const { inflateRawSync } = await import("node:zlib");
  try {
    return inflateRawSync(bytes);
  } catch {
    throw new Error("ZIP001 Deflate stream is invalid.");
  }
}

async function readEntryBytes(archive, entry, centralOffset) {
  const offset = entry.localOffset;
  assertRange(archive, offset, 30, `local header for ${entry.path}`);
  if (archive.readUInt32LE(offset) !== LOCAL_SIGNATURE) {
    throw new Error(`ZIP001 Invalid local header for ${entry.path}.`);
  }
  const flags = archive.readUInt16LE(offset + 6);
  const method = archive.readUInt16LE(offset + 8);
  const localChecksum = archive.readUInt32LE(offset + 14);
  const localCompressedSize = archive.readUInt32LE(offset + 18);
  const localSize = archive.readUInt32LE(offset + 22);
  const nameLength = archive.readUInt16LE(offset + 26);
  const extraLength = archive.readUInt16LE(offset + 28);
  const headerLength = 30 + nameLength + extraLength;
  assertRange(archive, offset, headerLength, `local header for ${entry.path}`);
  const localName = archive.subarray(offset + 30, offset + 30 + nameLength);
  if (
    flags !== entry.flags ||
    method !== entry.method ||
    !Buffer.from(localName).equals(entry.nameBytes)
  ) {
    throw new Error(`ZIP001 Central/local header mismatch for ${entry.path}.`);
  }
  if (
    (flags & 0x0008) === 0 &&
    (localChecksum !== entry.checksum ||
      localCompressedSize !== entry.compressedSize ||
      localSize !== entry.size)
  ) {
    throw new Error(`ZIP001 Local size or CRC mismatch for ${entry.path}.`);
  }
  const contentOffset = offset + headerLength;
  if (contentOffset + entry.compressedSize > centralOffset) {
    throw new Error(
      `ZIP001 Entry overlaps the central directory: ${entry.path}.`,
    );
  }
  const compressed = archive.subarray(
    contentOffset,
    contentOffset + entry.compressedSize,
  );
  const content = await inflateEntry(entry.method, compressed);
  if (content.length !== entry.size || crc32(content) !== entry.checksum) {
    throw new Error(
      `ZIP001 Size or CRC verification failed for ${entry.path}.`,
    );
  }
  return {
    content,
    extent: {
      start: offset,
      end: contentOffset + entry.compressedSize,
    },
  };
}

function assertExpectedFiles(entries, expectedFiles) {
  if (expectedFiles === undefined) return;
  const expected = [...expectedFiles].sort(compareCodeUnits);
  if (
    expected.length === 0 ||
    new Set(expected).size !== expected.length ||
    expected.some((path) => assertZipPath(path, false) !== path)
  ) {
    throw new Error("ZIP001 Expected file list is invalid.");
  }
  const observed = entries
    .filter((entry) => !entry.directory)
    .map((entry) => entry.path)
    .sort(compareCodeUnits);
  if (JSON.stringify(observed) !== JSON.stringify(expected)) {
    throw new Error(
      "ZIP001 Archive file set differs from the exact expected list.",
    );
  }
  const permittedDirectories = new Set();
  for (const path of expected) {
    const segments = path.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      permittedDirectories.add(segments.slice(0, index).join("/"));
    }
  }
  if (
    entries.some(
      (entry) => entry.directory && !permittedDirectories.has(entry.path),
    )
  ) {
    throw new Error("ZIP001 Archive contains an unexpected directory entry.");
  }
}

export async function readSafeZipArchive(archiveBytes, { expectedFiles } = {}) {
  const archive = Buffer.from(archiveBytes);
  const end = parseEndOfCentralDirectory(archive);
  const centralEntries = parseCentralEntries(archive, end);
  assertExpectedFiles(centralEntries, expectedFiles);
  const verified = [];
  for (const entry of centralEntries) {
    const local = await readEntryBytes(archive, entry, end.centralOffset);
    verified.push({ entry, ...local });
  }
  const extents = verified
    .map(({ extent }) => extent)
    .sort((left, right) => left.start - right.start);
  for (let index = 1; index < extents.length; index += 1) {
    if (extents[index - 1].end > extents[index].start) {
      throw new Error("ZIP001 Local ZIP entries overlap.");
    }
  }
  return verified.map(({ entry, content }) => ({
    path: entry.path,
    type: entry.directory ? "directory" : "file",
    bytes: content,
  }));
}

async function ensureOwnedDirectory(root, logicalPath) {
  let current = root;
  for (const segment of logicalPath.split("/")) {
    current = join(current, segment);
    try {
      await mkdir(current, { recursive: false, mode: 0o755 });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    const stats = await lstat(current);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error(
        "ZIP002 Extraction encountered a non-ordinary directory.",
      );
    }
  }
}

export async function extractSafeZipArchive(
  archiveBytes,
  destination,
  { expectedFiles } = {},
) {
  try {
    await lstat(destination);
    throw new Error("ZIP002 Extraction destination must be absent.");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await mkdir(destination, { recursive: false, mode: 0o755 });
  const rootStats = await lstat(destination);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error("ZIP002 Extraction destination is not ordinary.");
  }
  const entries = await readSafeZipArchive(archiveBytes, { expectedFiles });
  for (const entry of entries) {
    if (entry.type === "directory") {
      await ensureOwnedDirectory(destination, entry.path);
      continue;
    }
    const parent = dirname(entry.path).replaceAll("\\", "/");
    if (parent !== ".") await ensureOwnedDirectory(destination, parent);
    const path = join(destination, ...entry.path.split("/"));
    const handle = await open(path, "wx", 0o644);
    try {
      await handle.writeFile(entry.bytes);
    } finally {
      await handle.close();
    }
    const stats = await lstat(path, { bigint: true });
    if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1n) {
      throw new Error(`ZIP002 Extracted file is not ordinary: ${entry.path}.`);
    }
  }
  return entries;
}

export async function readAndExtractSafeZipArchive(
  archivePath,
  destination,
  options,
) {
  return extractSafeZipArchive(
    await readFile(archivePath),
    destination,
    options,
  );
}
