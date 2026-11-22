function viewOrder(packet, sheet, request) {
  if (["index", "references"].includes(sheet.view.kind)) return null;
  const navigation = packet.navigation;
  const documents =
    navigation?.documents?.filter((d) =>
      d.rows.some((r) => r.sheet === sheet.number),
    ) ?? [];
  const occurrences = navigation?.occurrences ?? [];
  const dependencies = navigation?.dependencies ?? [];
  const companion = navigation?.autoDocuments?.find((d) =>
    d.sheets.includes(sheet.number),
  );
  const owners = new Set(
    dependencies
      .filter((d) => companion?.dependencyIds.includes(d.id))
      .map((d) => d.owner.viewKey),
  );
  if (companion && owners.size > 1) return null;
  const orders = new Set(
    [
      ...documents.map((d) => d.authoredOrder),
      ...occurrences
        .filter((o) =>
          companion
            ? owners.has(o.provenance.view.key)
            : o.destination.sheet === sheet.number,
        )
        .map((o) => o.provenance.view.authoredOrder),
    ].filter(Number.isInteger),
  );
  if (orders.size === 1) return [...orders][0] + 1;
  return request.views?.length === 1 && orders.size === 0 ? 1 : undefined;
}

export function compactRevisionSource(presentation, packet, sheet, request) {
  if (presentation?.format !== "project-presentation/0.3") return undefined;
  const authored = presentation.compactFrame ?? presentation;
  const field = authored.titleBlock?.fields?.revision;
  const label = `${field?.label ?? "REV"}:`;
  const titleData = request?.titleData;
  const order = titleData?.byView?.length
    ? viewOrder(packet, sheet, request)
    : null;
  const views = titleData?.byView ?? [];
  const key = !field || field.bind === "sheet.revision" ? "revision" : "value";
  const hasRevision = (record) =>
    key === "revision"
      ? Object.hasOwn(record ?? {}, "revision")
      : Object.hasOwn(record?.values ?? {}, "revision");
  const getRevision = (record) =>
    key === "revision" ? record.revision : record.values.revision;
  const exact = titleData?.bySheet?.find((r) => r.sheetKey === sheet.sheetKey);
  if (order === undefined && !hasRevision(exact) && views.some(hasRevision))
    return { label, unavailable: true };
  const layers = [
    titleData?.defaults,
    views.find((r) => r.viewIndex === order),
    exact,
  ];
  const override = layers.findLast(hasRevision);
  return {
    label,
    value: override
      ? getRevision(override)
      : key === "revision"
        ? authored.revision
        : field.value,
  };
}
