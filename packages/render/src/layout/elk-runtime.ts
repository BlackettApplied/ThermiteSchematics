import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import BundledElk from "elkjs/lib/elk.bundled.js";
import type { ELK as ElkApi } from "elkjs/lib/elk-api.js";

// elkjs 0.12.0 runs its GWT layout engine behind a worker interface. Outside a
// browser the bundle substitutes an in-process faux worker, but the embedded
// worker picks its role by probing `typeof document === "undefined" &&
// typeof self !== "undefined"`. Bun defines a global `self` without `document`,
// so there the worker installs `self.onmessage` as a real Web Worker, exports
// nothing, and `new ELK()` fails constructing an undefined `_Worker`.
//
// Evaluate the unmodified upstream `elk-worker.min.js` (the same source the
// bundle embeds as its worker module, and the one elkjs's own Node entry uses)
// in a CommonJS scope whose `self` is shadowed as undefined, so it takes the
// module-export branch on every runtime. The global `self` is never read or
// written. The faux worker is handed to the bundled ELK class through its
// public `workerFactory` option, so engines keep that class's prototype and
// the bundle's embedded worker is never evaluated.

interface ElkFauxWorker {
  postMessage(message: unknown): void;
}

type ElkFauxWorkerConstructor = new (url?: string) => ElkFauxWorker;

const ElkConstructor = BundledElk as unknown as new (args: {
  workerFactory: (url?: string) => ElkFauxWorker;
}) => ElkApi;

const WORKER_SPECIFIER = "elkjs/lib/elk-worker.min.js";

let fauxWorker: ElkFauxWorkerConstructor | undefined;

function loadFauxWorker(): ElkFauxWorkerConstructor {
  if (fauxWorker !== undefined) return fauxWorker;
  const source = readFileSync(
    createRequire(import.meta.url).resolve(WORKER_SPECIFIER),
    "utf8",
  );
  const scope: { exports: { Worker?: unknown } } = { exports: {} };
  const evaluate = new Function(
    "module",
    "exports",
    "self",
    `${source}\n//# sourceURL=${WORKER_SPECIFIER}`,
  ) as (
    module: { exports: unknown },
    exports: unknown,
    self: undefined,
  ) => void;
  evaluate(scope, scope.exports, undefined);
  const exported = scope.exports.Worker;
  if (typeof exported !== "function") {
    throw new Error(
      `ELK runtime: ${WORKER_SPECIFIER} did not export its in-process Worker.`,
    );
  }
  fauxWorker = exported as ElkFauxWorkerConstructor;
  return fauxWorker;
}

/** Every ELK engine the renderer constructs comes from here. */
export function createElkEngine(): ElkApi {
  const FauxWorker = loadFauxWorker();
  return new ElkConstructor({ workerFactory: (url) => new FauxWorker(url) });
}
