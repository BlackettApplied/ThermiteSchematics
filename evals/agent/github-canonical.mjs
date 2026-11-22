// These values are used for classification only, never for execution.
export function canonicalText(input, { url = false } = {}) {
  if (typeof input !== "string") return { text: "", valid: false };
  let text = input,
    previous,
    valid = true;
  do {
    previous = text;
    text = text
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[\u3002\uff61]/gu, ".");
    try {
      text = decodeURIComponent(text);
    } catch {
      // Refuse the exemption, but still expose encoded hosts next to bad data.
      valid = false;
      text = text.replace(/(?:%[0-9a-f]{2})+/gi, (part) => {
        try {
          return decodeURIComponent(part);
        } catch {
          return part;
        }
      });
    }
  } while (text !== previous);
  return {
    text: url
      ? text
          .replace(/[\t\n\r]/g, "")
          .replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, "")
      : text.replace(/\s+/gu, " ").trim(),
    valid,
  };
}
export function canonicalUrl(input) {
  const normalized = canonicalText(input, { url: true });
  try {
    return { ...normalized, url: new URL(normalized.text) };
  } catch {
    return normalized;
  }
}
export function touchesGitHub(text) {
  return (
    /(?:^|[^a-z0-9-])(?:[a-z0-9-]+\.)*(?:github\.com|githubusercontent\.com)(?=$|[^a-z0-9-])/u.test(
      text,
    ) || /\brepo:[^\s/]+\/[^\s/]+/u.test(text)
  );
}
