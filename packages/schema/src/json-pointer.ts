export function escapeJsonPointerSegment(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

export function unescapeJsonPointerSegment(segment: string): string {
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

export function appendJsonPointer(
  pointer: string,
  segment: string | number,
): string {
  return `${pointer}/${escapeJsonPointerSegment(String(segment))}`;
}

export function splitJsonPointer(pointer: string): string[] {
  if (pointer === "") {
    return [];
  }

  if (!pointer.startsWith("/")) {
    throw new TypeError(`Invalid JSON Pointer: ${pointer}`);
  }

  return pointer.slice(1).split("/").map(unescapeJsonPointerSegment);
}
