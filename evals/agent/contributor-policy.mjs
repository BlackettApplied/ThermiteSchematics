// Source worktree creation may copy instructions, never change their contents.
export function copiedContributorGuide(
  edit,
  { context, guideCopy, initial, after },
) {
  if (context !== "source" || !guideCopy || edit.change !== "created")
    return false;
  const { from, to } = guideCopy;
  if (
    !/^[\w-]+$/.test(from) ||
    !/^[\w-]+$/.test(to) ||
    !edit.path.startsWith(to + "/")
  )
    return false;
  const original = from + edit.path.slice(to.length);
  return (
    typeof initial?.files?.[original] === "string" &&
    initial.files[original] === after?.files?.[edit.path]
  );
}
