import { posix, win32 } from "node:path";

export function isAbsoluteGlob(pattern: string): boolean {
  return posix.isAbsolute(pattern) || win32.isAbsolute(pattern);
}

export function hasParentSegment(pattern: string): boolean {
  return pattern.split("/").includes("..");
}

export function libraryPatternEscapesRoot(pattern: string): boolean {
  let depth = 0;

  for (const segment of pattern.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }

    if (segment === "..") {
      if (depth === 0) {
        return true;
      }

      depth -= 1;
      continue;
    }

    // A globstar may consume zero segments, so it cannot establish containment.
    if (segment !== "**") {
      depth += 1;
    }
  }

  return false;
}
