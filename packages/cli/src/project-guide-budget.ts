export const PROJECT_GUIDE_BYTE_LIMIT = 8_000;
export function assertProjectGuideBudget(value: string | Uint8Array): void {
  const bytes =
    typeof value === "string"
      ? Buffer.byteLength(value, "utf8")
      : value.byteLength;
  if (bytes > PROJECT_GUIDE_BYTE_LIMIT)
    throw Error(
      `Project guide requires ${bytes} bytes; ${PROJECT_GUIDE_BYTE_LIMIT} are available.`,
    );
}
