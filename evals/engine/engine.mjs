// Engine selection is fixed before checker modules load. Resolve public exports
// from the selected checkout, never from the eval kit's workspace packages.
import { readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
export const kitRoot = fileURLToPath(new URL("../../", import.meta.url));
export const engineRoot = await realpath(
  resolve(process.env.THERMITE_EVAL_ENGINE ?? kitRoot),
);
const packages = new Map();
export function publicPackage(name) {
  if (!packages.has(name))
    packages.set(
      name,
      (async () => {
        const directory = join(engineRoot, "packages", name);
        const metadata = JSON.parse(
          await readFile(join(directory, "package.json"), "utf8"),
        );
        const entry = metadata.exports["."];
        return import(
          pathToFileURL(
            join(directory, typeof entry === "string" ? entry : entry.import),
          ).href
        );
      })(),
    );
  return packages.get(name);
}
export const {
  compileProject,
  compileLoadedProject,
  loadProject,
  lockProject,
  writeFileAtomically,
  serializeIr,
} = await publicPackage("compiler");
export const renderSchematicPacket = async (...args) =>
  (await publicPackage("render")).renderSchematicPacket(...args);
let patchModule;
export function patchEngine() {
  // Fault/barrier seams have no public exports. Keep that compatibility boundary
  // here and load it only for contract probes, outside the fast oracle check.
  patchModule ??= (async () => {
    const internal = (path) =>
      import(
        pathToFileURL(join(engineRoot, "packages/agent-tools/dist", path)).href
      );
    const [patch, filesystem, lock] = await Promise.all([
      internal("apply-source-patch.js"),
      internal("patch-filesystem.js"),
      internal("project-write-lock.js").catch((error) => {
        if (["ERR_MODULE_NOT_FOUND", "MODULE_NOT_FOUND"].includes(error.code))
          return {};
        throw error;
      }),
    ]);
    return {
      ...patch,
      captureProjectControlledSnapshot:
        filesystem.captureProjectControlledSnapshot,
      reserveProjectWrite: lock.reserveProjectWrite,
    };
  })();
  return patchModule;
}

let renderFaultModule;
export function renderFaultEngine() {
  // Validator fault injection is internal, like the guarded patch barriers above.
  // Resolve both seams from the selected engine checkout, not the eval kit.
  renderFaultModule ??= (async () => {
    const internal = (path) =>
      import(
        pathToFileURL(join(engineRoot, "packages/render/dist", path)).href
      );
    const [renderer, runtime] = await Promise.all([
      internal("renderer.js"),
      internal("layout/elk-runtime.js"),
    ]);
    return {
      createSchematicRendererWithDependencies:
        renderer.createSchematicRendererWithDependencies,
      createElkEngine: runtime.createElkEngine,
    };
  })();
  return renderFaultModule;
}
