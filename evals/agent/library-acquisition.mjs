// An explicit task permission, never a repository-wide source-read exemption.
export function allowedLibraryUrl(url, allowedPaths = [], original = url.href) {
  if (
    !allowedPaths.length ||
    url.username ||
    url.password ||
    url.hash ||
    /[%\\]/.test(original) ||
    /(?:^|\/)\.\.?(?:\/|$)/.test(original)
  )
    return false;
  const patterns = {
    "github.com":
      /^\/(?:blackettapplied|3mul0r)\/thermiteschematics\/(?:blob|tree)\/[^/]+\/(.+)$/,
    "api.github.com":
      /^\/repos\/(?:blackettapplied|3mul0r)\/thermiteschematics\/contents\/(.+)$/,
    "raw.githubusercontent.com":
      /^\/(?:blackettapplied|3mul0r)\/thermiteschematics\/[^/]+\/(.+)$/,
  };
  const match = patterns[url.host]?.exec(url.pathname);
  return (
    !!match &&
    allowedPaths.some(
      (prefix) => match[1] === prefix || match[1].startsWith(prefix + "/"),
    )
  );
}
