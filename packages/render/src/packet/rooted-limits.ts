/** Shared limits for routed placement search and its compact-frame receipt. */
export const INITIAL_PLACEMENT_LAYOUTS = 24;
export const MAX_MIXED_LAYOUTS = 24;
export const MAX_PLACEMENT_LAYOUTS =
  INITIAL_PLACEMENT_LAYOUTS + MAX_MIXED_LAYOUTS;
export const ROOTED_COMPACT_PROFILES = [undefined, "compact", "dense"] as const;
