/** Preserve reviewed drawing-byte hashes across additive route ownership exports. */
export function withoutRouteOwnershipMetadata(svg: string): string {
  return svg.replace(
    / data-(?:layout-(?:source-port|target-port|port)|terminal-ends|loop-terminal)="[^"]*"/gu,
    "",
  );
}
