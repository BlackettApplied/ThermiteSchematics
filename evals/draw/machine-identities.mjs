const uuid = /[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}/iu;
const clean = (value) => value?.trim().replace(/\s+/gu, " ");
const unwrapped = (value) => value?.normalize("NFC").replace(/\s/gu, "");

function textFields(texts, key) {
  const fields = new Map();
  for (const t of texts) {
    const id = key(t);
    const field = fields.get(id) ?? [];
    field.push(t);
    fields.set(id, field);
  }
  return fields.values();
}

function measuredText(field, separator = " ") {
  return field
    .slice()
    .sort(
      (a, b) =>
        (a.anchor?.y ?? 0) - (b.anchor?.y ?? 0) ||
        (a.anchor?.x ?? 0) - (b.anchor?.x ?? 0),
    )
    .map((t) => t.text)
    .join(separator);
}

function uuidFindings(texts, issue) {
  const findings = [];
  for (const field of textFields(texts, (t) =>
    t.row != null && Number.isInteger(t.columnIndex)
      ? JSON.stringify([t.row, t.columnIndex])
      : (t.continuationLink ??
        (t.textContainer && t.tagField
          ? JSON.stringify([t.textContainer, t.tagOwnerUid, t.tagField])
          : undefined) ??
        (t.circuitText?.related ? t.textContainer : undefined) ??
        t.locatorElement ??
        t.element ??
        t),
  )) {
    const match =
      field.map((t) => uuid.exec(t.text)).find(Boolean) ??
      uuid.exec(measuredText(field, ""));
    if (match)
      findings.push(
        issue("printed-internal-vocabulary", field[0], {
          text: measuredText(field),
          mechanism: "raw-uuid",
          key: match[0],
        }),
      );
  }
  return findings;
}

function* relatedCaptions(texts) {
  for (const field of textFields(
    texts.filter((t) => t.circuitText?.related),
    (t) => t.textContainer ?? t,
  )) {
    // A colon starts a caption. Its destination can continue on later lines.
    const ordered = field
      .slice()
      .sort((a, b) => (a.anchor?.y ?? 0) - (b.anchor?.y ?? 0));
    let caption = [];
    for (const t of ordered) {
      if (t.text.includes(":")) {
        if (caption.length) yield caption;
        caption = [t];
      } else if (caption.length) caption.push(t);
    }
    if (caption.length) yield caption;
  }
}

function groupFindings(texts, request, issue) {
  const groups = (request?.views ?? [])
    .filter((view) => view.format === "circuit-view-request/0.1")
    .flatMap((view) =>
      view.groups.map((group) => ({
        ...group,
        destination: unwrapped(
          group.lineReference ?? group.label ?? view.title,
        ),
        partTitle:
          view.groups.length === 1 && !group.lineReference
            ? unwrapped(view.title)
            : undefined,
      })),
    );
  if (!groups.length) return [];
  const destinations = new Set(
    groups.flatMap((g) => [g.destination, g.partTitle]).filter(Boolean),
  );
  const keys = new Map(groups.map((g) => [unwrapped(g.id), g.id]));
  const tokens = [...new Set([...destinations, ...keys.keys()])].sort(
    (a, b) => b.length - a.length,
  );
  const findings = [];
  const report = (field, text, key) =>
    findings.push(
      issue("printed-internal-vocabulary", field[0], {
        text,
        mechanism: "circuit-group-key",
        key,
      }),
    );
  for (const field of textFields(
    texts.filter((t) => t.circuitHeading != null),
    (t) => JSON.stringify([t.textContainer, t.circuitHeading]),
  )) {
    const heading = clean(measuredText(field))
      .replace(/(?: - )?\bPart \d+\/\d+$/u, "")
      .trim();
    const parts = heading.split(" · ");
    const key = keys.get(unwrapped(parts.at(-1)));
    if (
      key &&
      !groups.some(
        (g) =>
          g.id === field[0].circuitHeading &&
          unwrapped(g.label) === unwrapped(key),
      )
    )
      report(field, heading, key);
  }
  for (const caption of relatedCaptions(texts)) {
    const text = clean(measuredText(caption));
    let rest = unwrapped(text.slice(text.indexOf(":") + 1));
    while (rest) {
      const token =
        tokens.find(
          (value) => rest === value || rest.startsWith(value + ","),
        ) ?? rest.split(",", 1)[0];
      const key = keys.get(token);
      if (key && !destinations.has(token)) report(caption, text, key);
      rest = rest.slice(token.length + 1);
    }
  }
  return findings;
}

export function machineIdentityFindings(g, context, issue) {
  const texts = g.texts.filter((t) => t.painted !== false);
  return [
    ...uuidFindings(texts, issue),
    ...groupFindings(texts, context.request, issue),
  ];
}
