import assert from "node:assert/strict";
import { CString, dlopen, FFIType, toArrayBuffer } from "bun:ffi";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  rmdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { constants as osConstants } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const { O_DIRECTORY, O_NOFOLLOW = 0, O_NONBLOCK = 0, O_RDONLY } = constants;
const { ENOENT, EAGAIN, EINTR, EACCES } = osConstants.errno;
const stat = (path) => lstatSync(path, { bigint: true, throwIfNoEntry: false });
const fdStat = (fd) => fstatSync(fd, { bigint: true });
const sameFile = (a, b) =>
  a != null && b != null && a.dev === b.dev && a.ino === b.ino;
const errnoName = (number) =>
  Object.entries(osConstants.errno).find(([, value]) => value === number)?.[0];
function syscallError(syscall, number, path) {
  const code = errnoName(number) ?? `ERRNO_${number}`;
  return Object.assign(new Error(`${code}: ${syscall} failed for ${path}`), {
    code,
    errno: -number,
    syscall,
    path,
  });
}
const ordinaryFile = (s) => s?.isFile() && s.nlink === 1n;
const inputError = "Capture input must be an ordinary file inside project";
// Node has no descriptor-relative open on Windows, and pathname checks around
// an open cannot stop a concurrent junction swap. Refuse instead.
export const windowsError =
  "Visual capture is unavailable on Windows: project files cannot be opened there without following links";
// Native openat does not apply Node's close-on-exec default.
const closeOnExec = process.platform === "darwin" ? 0x1000000 : 0x80000;
const readFlags = O_RDONLY | O_NOFOLLOW | O_NONBLOCK | closeOnExec;
// Open a directory entry itself without following a final symlink so fstatSync
// reports the entry's own dev, ino, and type relative to an open directory fd.
// macOS O_SYMLINK (0x200000) opens symlinks directly (O_NOFOLLOW would reject
// them); Linux O_PATH (0x200000 on x86_64/arm64) + O_NOFOLLOW opens any entry
// without following symlinks or blocking on FIFOs.
const linkStatFlags =
  process.platform === "darwin"
    ? O_RDONLY | 0x200000 | O_NONBLOCK | closeOnExec
    : (constants.O_PATH ?? 0x200000) | O_NOFOLLOW | closeOnExec;

function directoryIdentity(path, expected) {
  const current = stat(path);
  assert(
    current?.isDirectory() && realpathSync(path) === path,
    "Capture directory must be ordinary",
  );
  assert(!expected || sameFile(current, expected), "Capture directory changed");
  return current;
}

let libc;
const darwin = process.platform === "darwin";
// Intel macOS names the 64-bit-inode directory calls with a suffix.
const inode64 = darwin && process.arch === "x64" ? "$INODE64" : "";
function lib() {
  // This read-only openat call does not take its optional creation mode.
  libc ??= dlopen(darwin ? "libSystem.B.dylib" : "libc.so.6", {
    openat: {
      args: [FFIType.i32, FFIType.ptr, FFIType.i32],
      returns: FFIType.i32,
    },
    ["fdopendir" + inode64]: { args: [FFIType.i32], returns: FFIType.ptr },
    ["readdir" + inode64]: { args: [FFIType.ptr], returns: FFIType.ptr },
    closedir: { args: [FFIType.ptr], returns: FFIType.i32 },
    flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
    readlinkat: {
      args: [FFIType.i32, FFIType.ptr, FFIType.ptr, FFIType.u64],
      returns: FFIType.i64,
    },
    symlinkat: {
      args: [FFIType.ptr, FFIType.i32, FFIType.ptr],
      returns: FFIType.i32,
    },
    unlinkat: {
      args: [FFIType.i32, FFIType.ptr, FFIType.i32],
      returns: FFIType.i32,
    },
    [errnoLocation]: { args: [], returns: FFIType.ptr },
  }).symbols;
  return libc;
}
const errnoLocation = darwin ? "__error" : "__errno_location";
let errnoView;
function nativeErrno() {
  return (errnoView ??= new Int32Array(
    toArrayBuffer(lib()[errnoLocation](), 0, 4),
  ));
}
// An openat result and, on failure, its errno.
function tryOpen(dir, name, flags) {
  const symbols = lib();
  const errno = nativeErrno();
  const fd = symbols.openat(dir, Buffer.from(name + "\0"), flags);
  return { fd, errno: fd < 0 ? errno[0] : 0 };
}
function openRelative(dir, name, flags) {
  const { fd, errno } = tryOpen(dir, name, flags);
  if (errno === ENOENT)
    throw Object.assign(new Error(inputError), { code: "ENOENT" });
  assert(fd >= 0, inputError);
  return fd;
}
// Names in an open directory. The directory takes ownership of fd. The name
// follows d_ino, d_seekoff, d_reclen, d_namlen and d_type on macOS, and
// d_ino, d_off, d_reclen and d_type on Linux. readdir returns null both at
// the end and on an error; only an error sets errno, which is cleared first.
function listDescriptor(fd) {
  const symbols = lib(),
    dir = symbols["fdopendir" + inode64](fd);
  if (!dir) {
    closeSync(fd);
    assert.fail("Project directory could not be listed");
  }
  const errno = nativeErrno();
  const names = [];
  try {
    for (;;) {
      errno[0] = 0;
      const entry = symbols["readdir" + inode64](dir);
      if (!entry) {
        assert(errno[0] === 0, "Project directory listing failed");
        break;
      }
      const name = new CString(entry, darwin ? 21 : 19).toString();
      if (name !== "." && name !== "..") names.push(name);
    }
  } finally {
    symbols.closedir(dir);
  }
  return names;
}
function removeEntry(dir, name) {
  const opened = tryOpen(dir, name, readFlags | O_DIRECTORY);
  if (opened.errno === ENOENT) return;
  const directory = opened.fd >= 0;
  if (directory) {
    try {
      clearDirectory(opened.fd);
    } finally {
      closeSync(opened.fd);
    }
  }
  // A replacement symlink is either unlinked itself or refused by AT_REMOVEDIR.
  const removed = lib().unlinkat(
    dir,
    Buffer.from(name + "\0"),
    directory ? (darwin ? 0x80 : 0x200) : 0,
  );
  assert(
    removed === 0 || errnoView[0] === ENOENT,
    "Run scratch cleanup failed",
  );
}
function clearDirectory(dir) {
  let failure;
  for (const name of listDescriptor(
    openRelative(dir, ".", readFlags | O_DIRECTORY),
  )) {
    try {
      removeEntry(dir, name);
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure) throw failure;
}
// Project-relative components, never empty, "." or "..".
function components(rel) {
  const parts = rel.split(sep);
  assert(
    parts.every(
      (part) => part && part !== "." && part !== ".." && !part.includes("\0"),
    ),
    inputError,
  );
  return parts;
}

function readLinkAt(dir, name) {
  const path = Buffer.from(name + "\0");
  let size = 1024;
  for (;;) {
    const buffer = Buffer.alloc(size);
    const length = Number(lib().readlinkat(dir, path, buffer, buffer.length));
    if (length < 0) return null;
    if (length < buffer.length)
      return buffer.subarray(0, length).toString("utf8");
    size *= 2;
    assert(size <= 65536, "Symbolic link target is too long");
  }
}
function statEntryAt(dir, name) {
  const { fd } = tryOpen(dir, name, linkStatFlags);
  if (fd < 0) return null;
  try {
    return fdStat(fd);
  } finally {
    closeSync(fd);
  }
}
function statLinkedDirectory(dir, name) {
  const { fd } = tryOpen(
    dir,
    name,
    O_RDONLY | O_DIRECTORY | O_NONBLOCK | closeOnExec,
  );
  if (fd < 0) return null;
  try {
    return fdStat(fd);
  } finally {
    closeSync(fd);
  }
}
// Cleanup tracks every descriptor before closing another, so a close that
// throws never strands a child or the opened file.
function openDescendant(rootFd, parts, finalFlags = 0) {
  let dir = rootFd,
    fd;
  try {
    for (const part of parts.slice(0, -1)) {
      const parent = dir;
      dir = openRelative(parent, part, readFlags | O_DIRECTORY);
      if (parent !== rootFd) closeSync(parent);
    }
    fd = openRelative(dir, parts.at(-1), readFlags | finalFlags);
  } finally {
    try {
      if (dir !== rootFd) closeSync(dir);
    } catch (error) {
      if (fd !== undefined) closeSync(fd);
      throw error;
    }
  }
  return fd;
}

// `expected` is a root identity recorded earlier; a different root is refused.
export function projectReader(project, expected) {
  assert(
    process.platform === "darwin" || process.platform === "linux",
    windowsError,
  );
  assert(
    stat(project)?.isDirectory(),
    expected
      ? "Project root was replaced"
      : "Capture directory must be ordinary",
  );
  const root = realpathSync(project);
  const identity = directoryIdentity(root);
  assert(
    !expected ||
      (root === expected.path &&
        String(identity.dev) === expected.dev &&
        String(identity.ino) === expected.ino),
    "Project root was replaced",
  );
  const rootFd = openSync(root, readFlags | O_DIRECTORY);
  try {
    assert(sameFile(fdStat(rootFd), identity), "Project changed");
    return {
      identity: {
        path: root,
        dev: String(identity.dev),
        ino: String(identity.ino),
      },
      path(name) {
        const rel = relative(root, resolve(root, name));
        assert(
          rel &&
            rel !== ".." &&
            !rel.startsWith(".." + sep) &&
            !isAbsolute(rel) &&
            !rel.includes("\0"),
          inputError,
        );
        return rel;
      },
      // A failed no-follow open can still indicate a present link or special
      // file. Its caller then attempts a confined read and records refusal.
      has(name) {
        assert(components(name).length === 1);
        directoryIdentity(root, identity);
        const { fd, errno } = tryOpen(rootFd, name, readFlags);
        if (fd >= 0) closeSync(fd);
        assert(errno !== EACCES, "Capture input could not be inspected");
        return errno !== ENOENT;
      },
      // Whether the root is still the pinned directory at its path.
      intact() {
        try {
          directoryIdentity(root, identity);
          return true;
        } catch {
          return false;
        }
      },
      // Open an existing ordinary file. Creation, truncation and following
      // links are forbidden here. A writer truncates only after this check.
      openFile(rel, flags = 0) {
        assert((flags & (constants.O_CREAT | constants.O_TRUNC)) === 0);
        directoryIdentity(root, identity);
        const fd = openDescendant(rootFd, components(rel), flags);
        if (ordinaryFile(fdStat(fd))) return fd;
        closeSync(fd);
        assert.fail(inputError);
      },
      read(rel) {
        const fd = this.openFile(rel);
        try {
          const before = fdStat(fd);
          const bytes = readFileSync(fd);
          const check = this.openFile(rel);
          try {
            const after = fdStat(check);
            assert(
              sameFile(before, after) &&
                after.size === before.size &&
                after.mtimeNs === before.mtimeNs &&
                after.ctimeNs === before.ctimeNs,
              "Capture input changed during snapshot; request again",
            );
          } finally {
            closeSync(check);
          }
          return bytes;
        } finally {
          closeSync(fd);
        }
      },
      inspect(rel) {
        if (!rel) return fdStat(rootFd);
        const fd = openDescendant(rootFd, components(rel));
        try {
          const state = fdStat(fd);
          assert(state.isDirectory() || ordinaryFile(state), inputError);
          return state;
        } finally {
          closeSync(fd);
        }
      },
      list(rel = "") {
        directoryIdentity(root, identity);
        return listDescriptor(
          rel
            ? openDescendant(rootFd, components(rel), O_DIRECTORY)
            : openRelative(rootFd, ".", readFlags | O_DIRECTORY),
        );
      },
      // LOCK_EX | LOCK_NB. The open directory is the lock identity. There
      // is no owner file to read or reap, and exit releases the lock.
      tryLock() {
        const errno = nativeErrno();
        if (lib().flock(rootFd, 2 | 4) === 0) return true;
        if (errno[0] === EAGAIN || errno[0] === EINTR) return false;
        throw new Error("Audit lock could not be acquired");
      },
      symlinkLink(name, target) {
        assert(components(name).length === 1);
        assert(typeof target === "string" && target && !target.includes("\0"));
        directoryIdentity(root, identity);
        const errno = nativeErrno();
        errno[0] = 0;
        const created = lib().symlinkat(
          Buffer.from(target + "\0"),
          rootFd,
          Buffer.from(name + "\0"),
        );
        if (created !== 0) throw syscallError("symlinkat", errno[0], name);
        const entry = statEntryAt(rootFd, name);
        assert(
          entry?.isSymbolicLink(),
          "Symbolic link identity could not be verified after creation",
        );
        return { dev: entry.dev, ino: entry.ino };
      },
      linkedDirectory(name, expectedIdentity, expectedLinkIdentity) {
        assert(components(name).length === 1);
        const entry = statEntryAt(rootFd, name);
        if (!entry?.isSymbolicLink()) return false;
        if (expectedLinkIdentity && !sameFile(entry, expectedLinkIdentity))
          return false;
        if (readLinkAt(rootFd, name) === null) return false;
        const actual = statLinkedDirectory(rootFd, name);
        return !!actual && sameFile(actual, expectedIdentity);
      },
      unlinkLink(name, expectedLinkIdentity) {
        assert(components(name).length === 1);
        if (!expectedLinkIdentity) return false;
        const current = statEntryAt(rootFd, name);
        if (
          !current?.isSymbolicLink() ||
          !sameFile(current, expectedLinkIdentity)
        )
          return false;
        // POSIX has no atomic unlink-by-inode/symlink-only syscall; verifying
        // the descriptor-relative entry's type and dev/ino immediately before
        // unlinkat refuses replacement links and regular files while keeping
        // the residual TOCTOU window as narrow as POSIX permits.
        return lib().unlinkat(rootFd, Buffer.from(name + "\0"), 0) === 0;
      },
      remove(name) {
        assert(components(name).length === 1);
        removeEntry(rootFd, name);
      },
      removeRoot() {
        clearDirectory(rootFd);
        // rmdir never follows the last component. Its parent is the trusted
        // temporary-directory root; a replaced workspace is left alone.
        assert(this.intact(), "Run scratch root was replaced");
        rmdirSync(root);
      },
      close() {
        closeSync(rootFd);
      },
    };
  } catch (error) {
    closeSync(rootFd);
    throw error;
  }
}

// Copy data into a new directory supplied by the harness. Never materialize a
// link or special file, even if it is reachable within the source tree.
export function copyConfinedTree(source, destination) {
  const refused = [];
  const walk = (dir, names) => {
    mkdirSync(join(destination, dir));
    for (const name of names.sort()) {
      if (name === ".git") continue;
      const path = join(dir, name);
      let children;
      try {
        children = source.list(path);
      } catch {}
      if (children) {
        walk(path, children);
        continue;
      }
      let bytes;
      try {
        bytes = source.read(path);
      } catch {
        refused.push(path);
        continue;
      }
      writeFileSync(join(destination, path), bytes, { flag: "wx" });
    }
  };
  walk("", source.list());
  return refused;
}
