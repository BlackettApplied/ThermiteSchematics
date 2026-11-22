import type { ElectricalIr } from "@thermite/compiler";
import type { RenderFailure, RenderOutcome } from "./types.js";
import { packetViewContext, record } from "./packet/errors.js";
import { Issues, checkText } from "./internal/title-data/validation.js";

/** Existing precise device/view details take precedence over caller scope. */
function hasNamedScope(details: unknown): boolean {
  const pending = [details],
    seen = new Set<object>();
  while (pending.length) {
    const value = pending.pop();
    if (value === null || typeof value !== "object" || seen.has(value))
      continue;
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
      if (key === "designation" && typeof child === "string" && child.length)
        return true;
      if (key === "viewIndex" && Number.isInteger(child) && Number(child) >= 0)
        return true;
      if (
        key === "functionDisplayKeys" &&
        Array.isArray(child) &&
        child.some((v) => typeof v === "string" && v.length)
      )
        return true;
      if (child !== null && typeof child === "object") pending.push(child);
    }
  }
  return false;
}

/** Only own data properties can contribute single-view context. */
function dataProperty(value: object, key: string): unknown {
  const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
  if (descriptor && !("value" in descriptor))
    throw Error("Uninspectable diagnostic context property");
  return descriptor?.value;
}

/** Array.isArray inspects the internal brand without ordinary Proxy gets. */
function inputRecord(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function snapshotView(value: unknown, depth = 0): Record<string, unknown> {
  if (!inputRecord(value) || depth > 2) return {};
  const result: Record<string, unknown> = {};
  for (const key of [
    "format",
    "title",
    "root",
    "intent",
    "family",
    "kind",
    "medium",
    "by",
    "value",
    "to",
    "from",
    "includePower",
  ]) {
    const child = dataProperty(value, key);
    if (typeof child === "string" || typeof child === "boolean")
      result[key] = child;
    else if (
      child !== undefined &&
      ["root", "intent", "to", "from"].includes(key)
    )
      result[key] = snapshotView(child, depth + 1);
  }
  return result;
}

function singleViewContext(
  request: unknown,
  ir: Readonly<ElectricalIr>,
  viewIndex = 0,
) {
  const view = snapshotView(request);
  // Missing/non-object requests have no authored view identity to invent.
  if (
    (typeof view.format !== "string" && typeof view.title !== "string") ||
    (!view.root && !view.title && !view.kind && !view.from)
  )
    return [];
  const context = packetViewContext(view, viewIndex, ir);
  return context.title === "Untitled view" && !("title" in view)
    ? []
    : [context];
}

function validProjectName(ir: Readonly<ElectricalIr>): string | undefined {
  const name = ir.project.name;
  if (typeof name !== "string" || !name.length || [...name].length > 160)
    return undefined;
  const issues = new Issues("diagnostic-context");
  checkText(name, "/project/name", issues);
  return issues.diagnostics.length ? undefined : name;
}

function callerScope(
  ir: Readonly<ElectricalIr>,
  request: unknown,
  error: RenderFailure,
) {
  let requestField = "/";
  let projectName: string | undefined;
  try {
    if ("reason" in error && error.reason === "invalid-page")
      requestField = "/page";
    projectName = validProjectName(ir);
    const format = inputRecord(request)
      ? dataProperty(request, "format")
      : undefined;
    const packet = format === "schematic-packet-request/0.1";
    requestField =
      "reason" in error && error.reason === "invalid-page"
        ? "/page"
        : packet
          ? "/views"
          : "/";
    const base = {
      ...(projectName === undefined ? {} : { projectName }),
      requestField,
    };
    if (packet && inputRecord(request)) {
      const authoredViews = dataProperty(request, "views");
      if (!Array.isArray(authoredViews)) return { ...base, views: [] };
      const length = dataProperty(authoredViews, "length");
      if (
        typeof length !== "number" ||
        !Number.isSafeInteger(length) ||
        length < 0
      )
        throw Error("Uninspectable diagnostic context array length");
      if (!length) return { ...base, views: [] };
      // Bound context work for a rejected oversized packet.
      const views =
        length > 40
          ? singleViewContext(dataProperty(authoredViews, "40"), ir, 40)
          : Array.from({ length }, (_, index) => index).flatMap((index) =>
              singleViewContext(
                dataProperty(authoredViews, String(index)),
                ir,
                index,
              ),
            );
      return { ...base, views };
    }
    return { ...base, views: singleViewContext(request, ir) };
  } catch {
    // All caller/IR reads are guarded; keep the selected failure unchanged.
    return {
      ...(projectName === undefined ? {} : { projectName }),
      requestField,
      views: [],
      scopeUnavailable: true,
    };
  }
}

/** Add identities after failure selection; preserve code, reason and message. */
export function renderDiagnosticContext<E extends RenderFailure>(
  ir: Readonly<ElectricalIr>,
  request: unknown,
  error: E,
): E {
  if (!/^R00[1-6]$/u.test(error.code)) return error;
  const details =
    "details" in error && record(error.details) ? error.details : undefined;
  if (hasNamedScope(details)) return error;
  return {
    ...error,
    details: { ...details, diagnosticContext: callerScope(ir, request, error) },
  };
}

export function contextualRenderOutcome<T>(
  ir: Readonly<ElectricalIr>,
  request: unknown,
  result: RenderOutcome<T>,
): RenderOutcome<T> {
  if (result.ok) return result;
  const error = renderDiagnosticContext(ir, request, result.error);
  return error === result.error ? result : { ...result, error };
}
