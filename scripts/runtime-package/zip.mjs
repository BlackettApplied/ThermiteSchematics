import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { crc32 } from "../safe-zip-reader.mjs";
import { listFiles } from "./common.mjs";

// A deterministic ordinary-file ZIP with UTF-8 paths. No shell tools, host
// timestamps, executable permissions or ZIP64 extensions enter the payload.
export async function createRuntimeZip(root) {
  const files = await listFiles(root);
  if (files.length >= 65535)
    throw new Error("Runtime ZIP exceeds classic ZIP entry limit.");
  const local = [],
    central = [];
  let offset = 0;
  for (const path of files) {
    const name = Buffer.from(path, "utf8");
    const bytes = await readFile(join(root, path));
    const compressed = deflateRawSync(bytes, { level: 9 });
    if (
      name.length > 65535 ||
      bytes.length >= 0xffffffff ||
      offset + 30 + name.length + compressed.length >= 0xffffffff
    )
      throw new Error("Runtime ZIP exceeds classic ZIP size limit.");
    const crc = crc32(bytes);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt16LE(0x2821, 12); // 2000-01-01, 00:00:00
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, compressed);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(0x0314, 4);
    header.copy(record, 6, 4, 30);
    record.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    record.writeUInt32LE(offset, 42);
    central.push(record, name);
    offset += header.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(central);
  if (directory.length >= 0xffffffff)
    throw new Error("Runtime ZIP exceeds classic ZIP directory limit.");
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
