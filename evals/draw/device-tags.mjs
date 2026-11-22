import { hasLegibleEm } from "./text-legibility.mjs";
// Independent oracle: never import the renderer's tag resolver or source strings.
const normalized = (s) => s.replace(/\s+/gu, " ").trim();
const value = (s) => (typeof s === "string" && s.trim() ? s : undefined);
const rowText = (t) => t.renderedString ?? t.text;

function matches(rows, expected, literal = false) {
  if (!rows.length) return false;
  const target = literal ? expected : normalized(expected);
  if (
    rows.some((r) => r.tagRowStart !== undefined || r.tagRowEnd !== undefined)
  ) {
    let position = 0;
    for (const row of rows) {
      const { tagRowStart: start, tagRowEnd: end } = row;
      if (
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start !== position ||
        end < start ||
        end > target.length ||
        rowText(row) !== target.slice(start, end).trimEnd()
      )
        return false;
      position = end;
    }
    return position === target.length;
  }
  let positions = new Set([0]);
  for (const [index, row] of rows.entries()) {
    const text = literal ? rowText(row) : normalized(rowText(row)),
      next = new Set();
    for (const position of positions)
      for (const start of [
        position,
        ...((!literal || index > 0) && target[position] === " "
          ? [position + 1]
          : []),
      ])
        if (target.startsWith(text, start)) next.add(start + text.length);
    positions = next;
  }
  return positions.has(target.length);
}

function terminalIdentity(block, device, ir) {
  const ids = block.rows.map((r) => r.tagTerminal).filter(Boolean);
  if (!ids.length) return false;
  const id = ids[0],
    type = ir.deviceTypes?.find((t) => t.id === device.typeId);
  if (
    ids.some(
      (t) => t.deviceUid !== id.deviceUid || t.terminalKey !== id.terminalKey,
    ) ||
    id.deviceUid !== device.uid ||
    !type?.terminals?.some((t) => t.key === id.terminalKey)
  )
    return false;
  const rows = block.rows.filter((r) => r.tagField === "designation");
  const qualified = `${device.designation}.${id.terminalKey}`;
  const printed = [rows.map(rowText).join(""), rows.map(rowText).join(" ")];
  return printed.some((text) => {
    const identity = text.startsWith("Off-view at ")
      ? text.slice("Off-view at ".length)
      : text;
    return identity === qualified;
  });
}

function ownedBlocks(g, uid) {
  const blocks = new Map();
  for (const row of g.texts) {
    if (
      row.tagOwnerUid !== uid ||
      row.tagPainted !== true ||
      !hasLegibleEm(row) ||
      (row.tagKind === "legend" &&
        row.tagField === "designation" &&
        row.fontSize !== undefined &&
        row.fontSize < 2.7 - 0.03) ||
      !row.tagBlock ||
      !["body", "reference", "legend"].includes(row.tagKind) ||
      row.tagOwnershipValid !== true
    )
      continue;
    const key = JSON.stringify([
      row.tagKind,
      row.tagBlock,
      row.tagContainer ?? null,
    ]);
    if (!blocks.has(key))
      blocks.set(key, {
        id: row.tagBlock,
        kind: row.tagKind,
        container: row.tagContainer,
        rows: [],
      });
    blocks.get(key).rows.push(row);
  }
  for (const b of blocks.values())
    b.rows.sort((a, b) =>
      a.anchor && b.anchor
        ? Math.abs(a.anchor.y - b.anchor.y) > 0.17
          ? a.anchor.y - b.anchor.y
          : a.anchor.x - b.anchor.x
        : a.order - b.order,
    );
  return [...blocks.values()];
}

function missingFields(block, d, type, ir) {
  const rows = (field) => block.rows.filter((r) => r.tagField === field);
  const missing = [];
  const part = value(type?.catalog?.orderNumber),
    description = value(d.description) ?? value(type?.description);
  if (part && !matches(rows("part"), part, true))
    missing.push(`authored part ${part}`);
  if (
    !matches(rows("designation"), d.designation, true) &&
    !terminalIdentity(block, d, ir)
  )
    missing.push("designation");
  if (description && !matches(rows("description"), description))
    missing.push("authored description");
  for (const field of ["partNumber", "rating"])
    if (value(d[field]) && !matches(rows(field), d[field], true))
      missing.push(field);
  return missing;
}

function referenceEntry(block) {
  return (
    block.kind === "reference" &&
    block.rows.some(
      (r) =>
        r.tagReferenceEntry ||
        r.tagKey != null ||
        ["description", "part", "rating", "partNumber"].includes(r.tagField),
    )
  );
}
// Both markers describe the same physical element during the transition. Never
// collapse different elements or keys that happen to share an owner UID.
function declaredEntries(g, uid) {
  const entries = [];
  for (const e of [
    ...(g.deviceLegendEntries ?? []),
    ...(g.deviceReferenceEntries ?? []),
  ]) {
    if (e.deviceUid !== uid) continue;
    if (
      e.container != null &&
      entries.some(
        (other) =>
          other.container === e.container &&
          other.key === e.key &&
          other.kind === e.kind,
      )
    )
      continue;
    entries.push(e);
  }
  return entries;
}
function sheetEntryCount(entries, blocks) {
  const observed = blocks.filter(
    (b) => b.kind === "legend" || referenceEntry(b),
  );
  if (entries.some((e) => e.container == null))
    return Math.max(entries.length, observed.length);
  return (
    entries.length +
    observed.filter((b) => !entries.some((e) => e.container === b.container))
      .length
  );
}

function referenceEntryAudit(
  entries,
  blocks,
  uid,
  d,
  ir,
  bodyHere,
  duplicate,
  issue,
) {
  entries = entries.filter((e) => e.kind === "reference");
  const references = blocks.filter(
      (b) => b.kind === "reference" && terminalIdentity(b, d, ir),
    ),
    tags = blocks.filter(referenceEntry);
  const keyFor = (b) => b.rows[0]?.tagKey,
    qualified = (b) => {
      const terminal = b.rows.find((r) => r.tagTerminal)?.tagTerminal;
      return terminal ? `${d.designation}.${terminal.terminalKey}` : undefined;
    },
    valid = new Set(),
    findings = [];
  const keys = new Set([...entries.map((e) => e.key), ...tags.map(keyFor)]);
  for (const key of keys) {
    const local = references.some(
        (b) => qualified(b) === key && !b.rows.some((r) => r.tagReferenceEntry),
      ),
      declared = entries.filter((e) => e.key === key);
    for (const tag of tags.filter((b) => keyFor(b) === key)) {
      const containerEntries = entries.filter(
          (e) => e.container === tag.container,
        ),
        matchesEntry =
          !containerEntries.length ||
          containerEntries.every(
            (e) => e.key === key && e.kind === "reference",
          );
      if (
        !bodyHere &&
        local &&
        !duplicate &&
        matchesEntry &&
        tag.rows.every((r) => r.tagKey === key)
      )
        valid.add(tag);
      else
        findings.push(
          issue(
            "invalid-device-reference-key",
            { deviceUid: uid, designation: d.designation },
            {
              key,
              reason: bodyHere
                ? "device has a same-sheet body"
                : "missing exact same-sheet owned qualified key, duplicate, or entry ownership",
            },
          ),
        );
    }
    if (declared.length && !tags.some((b) => keyFor(b) === key))
      findings.push(
        issue(
          "invalid-device-reference-key",
          { deviceUid: uid, designation: d.designation },
          { key, reason: "entry is not painted" },
        ),
      );
  }
  return { valid, findings };
}

// A reference role only locates candidates. Native qualified terminal ink and
// complete source fields establish which rows may use the reference size floor.
export function classifyReferenceTags(g, ir) {
  for (const t of g.texts) t.nativeReference = false;
  for (const device of ir.devices ?? []) {
    const blocks = new Map();
    for (const t of g.texts.filter(
      (t) =>
        t.tagKind === "reference" &&
        t.tagOwnerUid === device.uid &&
        t.tagOwnershipValid === true &&
        t.tagPainted === true,
    )) {
      const key = JSON.stringify([t.tagBlock, t.tagContainer]);
      if (!blocks.has(key)) blocks.set(key, { kind: "reference", rows: [] });
      blocks.get(key).rows.push(t);
    }
    for (const block of blocks.values())
      block.rows.sort((a, b) =>
        a.anchor && b.anchor
          ? Math.abs(a.anchor.y - b.anchor.y) > 0.17
            ? a.anchor.y - b.anchor.y
            : a.anchor.x - b.anchor.x
          : a.order - b.order,
      );
    const qualified = [...blocks.values()].filter((b) =>
      terminalIdentity(b, device, ir),
    );
    const bodyHere = (g.devices ?? []).some(
      (d) => d.deviceUid === device.uid && d.tagKind !== "reference",
    );
    const type = ir.deviceTypes?.find((t) => t.id === device.typeId);
    for (const block of blocks.values()) {
      if (
        qualified.includes(block) ||
        (!bodyHere &&
          qualified.length &&
          referenceEntry(block) &&
          !missingFields(block, device, type, ir).length)
      )
        for (const t of block.rows) t.nativeReference = true;
    }
  }
}

export function deviceTagFindings(g, ir, references, issue, view) {
  classifyReferenceTags(g, ir);
  const appearances = (g.devices ?? []).filter(
    (d) => d.tagKind !== "reference",
  );
  const local = g.deviceReferences ?? [];
  const uids = new Set(
    [
      ...references,
      ...appearances,
      ...(g.terminals ?? []).filter((t) => t.tagKind !== "reference"),
      ...local,
      ...g.texts
        .filter((t) => t.tagKind === "reference")
        .map((t) => ({ deviceUid: t.tagOwnerUid })),
      ...(g.deviceLegendEntries ?? []),
      ...(g.deviceReferenceEntries ?? []),
    ].map((r) => r.deviceUid),
  );
  const out = [];
  for (const uid of uids) {
    if (!uid) continue;
    const d = ir.devices.find((d) => d.uid === uid);
    if (!d) {
      out.push(issue("invalid-device-tag-owner", { deviceUid: uid }));
      continue;
    }
    const type = ir.deviceTypes?.find((t) => t.id === d.typeId),
      blocks = ownedBlocks(g, uid);
    const referencesHere = local.filter((r) => r.deviceUid === uid);
    const targets = referencesHere.filter((r) => r.tagRef).map((r) => r.tagRef);
    const bodyHere = appearances.some((a) => a.deviceUid === uid);
    const legends = blocks.filter((b) => b.kind === "legend");
    const declarations = declaredEntries(g, uid),
      entryCount = sheetEntryCount(declarations, blocks),
      duplicate = entryCount > 1,
      entries = declarations.filter((e) => e.kind === "legend");
    const invalidEntry = entries.some(
      (e) => e.key !== d.designation || e.kind !== "legend",
    );
    const bodyKey = g.texts.some(
      (t) =>
        t.tagOwnerUid === uid &&
        t.tagKind === "body" &&
        (t.tagField === "designation" ||
          (!t.tagField && t.tagKey === d.designation)) &&
        t.tagOwnershipValid === true &&
        t.tagPainted === true &&
        hasLegibleEm(t) &&
        rowText(t) === d.designation,
    );
    const rootedLegend =
      /^schematic-view\//.test(view?.format ?? g.viewFormat ?? "") &&
      ["power", "control"].includes(view?.family ?? g.viewFamily);
    for (const legend of legends) {
      if (
        !rootedLegend ||
        invalidEntry ||
        !bodyHere ||
        !bodyKey ||
        legend.rows.some((t) => t.tagKey !== d.designation)
      )
        out.push(
          issue(
            "invalid-device-legend-key",
            { deviceUid: uid, designation: d.designation },
            {
              reason: !bodyKey
                ? "missing same-sheet owned body designation"
                : "legend designation key or view",
            },
          ),
        );
    }
    if (duplicate)
      out.push(
        issue(
          blocks.some(referenceEntry) ||
            declarations.some((e) => e.kind === "reference")
            ? "duplicate-device-reference-entry"
            : "duplicate-device-legend-entry",
          { deviceUid: uid, designation: d.designation },
          { entries: entryCount },
        ),
      );
    const referenceAudit = referenceEntryAudit(
      declarations,
      blocks,
      uid,
      d,
      ir,
      bodyHere,
      duplicate,
      issue,
    );
    out.push(...referenceAudit.findings);
    const candidates = blocks.filter((b) =>
      bodyHere
        ? b.kind === "body" ||
          (b.kind === "legend" &&
            rootedLegend &&
            bodyKey &&
            !invalidEntry &&
            !duplicate &&
            entries.length <= 1 &&
            legends.length === 1 &&
            b.rows.every((t) => t.tagKey === d.designation))
        : b.kind !== "legend" &&
          (b.kind === "body" ||
            ((referenceAudit.valid.has(b) ||
              (terminalIdentity(b, d, ir) &&
                b.rows.every((r) => r.tagField === "designation"))) &&
              (!targets.length || targets.includes(b.id)))),
    );
    const missing = (candidates.length ? candidates : [{ rows: [] }])
      .map((b) => missingFields(b, d, type, ir))
      .sort((a, b) => a.length - b.length)[0];
    const bbox =
      appearances.find((a) => a.deviceUid === uid)?.bbox ??
      referencesHere[0]?.bbox;
    if (missing.length)
      out.push(
        issue(
          "missing-device-tag-fields",
          { deviceUid: uid, designation: d.designation, bbox },
          { missing, description: d.description ?? null },
        ),
      );
    for (const ref of referencesHere) {
      const identityBlock = blocks.find(
        (b) =>
          b.id === ref.tagBlock &&
          b.container === ref.tagContainer &&
          terminalIdentity(b, d, ir),
      );
      const target =
        !ref.tagRef ||
        blocks.some(
          (b) =>
            b.id === ref.tagRef &&
            matches(
              b.rows.filter((r) => r.tagField === "designation"),
              d.designation,
              true,
            ),
        );
      if (!identityBlock || !target)
        out.push(
          issue(
            "invalid-device-tag-reference",
            { ...ref, designation: d.designation },
            { reason: !identityBlock ? "qualified identity" : "local tag key" },
          ),
        );
    }
  }
  return out;
}
