import { readBunLock, lockedPackage } from "../../../scripts/read-bun-lock.mjs";
import { readFile, realpath } from "node:fs/promises";
import { isBuiltin } from "node:module";
import { join, posix, relative, resolve, sep } from "node:path";

import ts from "typescript";

interface FirstPartyInventoryFile {
  readonly stagePath: string;
  readonly role: string;
}

interface FirstPartyInventoryPackage {
  readonly name: string;
  readonly stagePath: string;
  readonly stagedManifest: { readonly path: string };
  readonly files: readonly FirstPartyInventoryFile[];
}

interface FirstPartyInventory {
  readonly format: string;
  readonly packages: readonly FirstPartyInventoryPackage[];
}

interface ThirdPartyInventoryFile {
  readonly path: string;
  readonly role: string;
}

interface ThirdPartyInventoryPackage {
  readonly name: string;
  readonly version: string;
  readonly files: readonly ThirdPartyInventoryFile[];
}

interface ThirdPartyStageInventory {
  readonly format: string;
  readonly packages: readonly ThirdPartyInventoryPackage[];
}

interface RealProgramSource {
  readonly sourceFile: ts.SourceFile;
  readonly realPath: string;
}

interface CompilerBoundary {
  readonly candidateRoot: string;
  readonly checkoutRoot: string;
  readonly nodeRoot: string;
  readonly undiciRoot: string;
  readonly typescriptLibRoot: string;
}

interface LoadedDeclarationSets {
  readonly firstParty: readonly string[];
  readonly thirdParty: readonly string[];
  readonly nodeTools: readonly string[];
  readonly candidateSources: readonly RealProgramSource[];
  readonly sourcesByRealPath: ReadonlyMap<string, RealProgramSource>;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function pathKey(path: string): string {
  const normalized = resolve(path);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function pathsEqual(left: string, right: string): boolean {
  return pathKey(left) === pathKey(right);
}

function isContainedBy(root: string, child: string): boolean {
  const rootKey = pathKey(root);
  const childKey = pathKey(child);
  return childKey === rootKey || childKey.startsWith(`${rootKey}${sep}`);
}

function containedRelativePath(root: string, child: string): string {
  if (!isContainedBy(root, child)) {
    throw new Error(`Path is outside its realpath boundary: ${child}.`);
  }
  const result = relative(root, child);
  if (result === "" || result === ".." || result.startsWith(`..${sep}`)) {
    throw new Error(`Path does not identify a contained file: ${child}.`);
  }
  return result.split(sep).join("/");
}

function candidateIdentity(candidateRoot: string, path: string): string {
  return `package/${containedRelativePath(candidateRoot, path)}`;
}

function nodeToolIdentity(
  root: string,
  prefix: "node_modules/@types/node" | "node_modules/undici-types",
  path: string,
): string {
  return `${prefix}/${containedRelativePath(root, path)}`;
}

function sortedUnique(label: string, values: readonly string[]): string[] {
  const sorted = [...values].sort(compareCodeUnits);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index] === sorted[index - 1]) {
      throw new Error(
        `${label} contains duplicate identity '${sorted[index]}'.`,
      );
    }
  }
  return sorted;
}

function assertExactIdentities(
  label: string,
  observed: readonly string[],
  expected: readonly string[],
): void {
  const observedSorted = sortedUnique(`${label} observed set`, observed);
  const expectedSorted = sortedUnique(`${label} expected set`, expected);
  if (JSON.stringify(observedSorted) !== JSON.stringify(expectedSorted)) {
    throw new Error(
      `${label} differs.\nExpected: ${JSON.stringify(expectedSorted)}\nObserved: ${JSON.stringify(observedSorted)}`,
    );
  }
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is not an object.`);
  }
  return value as Record<string, unknown>;
}

function candidatePathForIdentity(
  candidateRoot: string,
  identity: string,
): string {
  if (
    !identity.startsWith("package/") ||
    identity.includes(String.fromCharCode(92))
  ) {
    throw new Error(`Invalid candidate inventory identity '${identity}'.`);
  }
  const relativeIdentity = identity.slice("package/".length);
  const normalized = posix.normalize(relativeIdentity);
  if (
    normalized !== relativeIdentity ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    posix.isAbsolute(normalized)
  ) {
    throw new Error(`Unsafe candidate inventory identity '${identity}'.`);
  }
  return join(candidateRoot, ...relativeIdentity.split("/"));
}

async function readDeclarationInventories(repositoryRoot: string): Promise<{
  readonly firstParty: FirstPartyInventory;
  readonly firstPartyDeclarations: readonly string[];
  readonly thirdPartyDeclarations: readonly string[];
}> {
  const [firstValue, thirdValue] = await Promise.all([
    readJson(join(repositoryRoot, "scripts", "release-first-party-files.json")),
    readJson(
      join(repositoryRoot, "scripts", "release-third-party-stage-files.json"),
    ),
  ]);
  const firstParty = firstValue as FirstPartyInventory;
  const thirdParty = thirdValue as ThirdPartyStageInventory;
  if (
    firstParty.format !== "thermite-schematics-release-first-party-files/0.1" ||
    !Array.isArray(firstParty.packages)
  ) {
    throw new Error("First-party release inventory has an invalid format.");
  }
  if (
    thirdParty.format !==
      "thermite-schematics-release-third-party-stage-files/0.1" ||
    !Array.isArray(thirdParty.packages)
  ) {
    throw new Error("Third-party stage inventory has an invalid format.");
  }
  const firstPartyDeclarations = sortedUnique(
    "First-party declaration inventory",
    firstParty.packages.flatMap((package_) =>
      package_.files
        .filter((file: FirstPartyInventoryFile) => file.role === "declaration")
        .map((file: FirstPartyInventoryFile) => file.stagePath),
    ),
  );
  const thirdPartyDeclarations = sortedUnique(
    "Third-party declaration inventory",
    thirdParty.packages.flatMap((package_) =>
      package_.files
        .filter((file: ThirdPartyInventoryFile) => file.role === "declaration")
        .map((file: ThirdPartyInventoryFile) => file.path),
    ),
  );
  if (
    thirdPartyDeclarations.length !== 49 ||
    !thirdPartyDeclarations.includes(
      "package/node_modules/elkjs/lib/main.d.ts",
    ) ||
    !thirdPartyDeclarations.includes(
      "package/node_modules/elkjs/lib/elk-api.d.ts",
    )
  ) {
    throw new Error(
      "Third-party declaration inventory is not the Task-6-recorded 49-row closure.",
    );
  }
  const declarationPackages = thirdParty.packages
    .filter((package_) =>
      package_.files.some(
        (file: ThirdPartyInventoryFile) => file.role === "declaration",
      ),
    )
    .map((package_) => `${package_.name}@${package_.version}`);
  assertExactIdentities(
    "Third-party declaration package identities",
    declarationPackages,
    ["ajv@8.20.0", "elkjs@0.12.0", "fast-uri@3.1.6", "jsonc-parser@3.3.1"],
  );
  return { firstParty, firstPartyDeclarations, thirdPartyDeclarations };
}

function collectExportTypeTargets(value: unknown, targets: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectExportTypeTargets(item, targets);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (key === "types") {
      if (typeof child !== "string") {
        throw new Error(
          "A retained first-party exports types target is invalid.",
        );
      }
      targets.push(child);
    } else {
      collectExportTypeTargets(child, targets);
    }
  }
}

async function retainedFirstPartyEntries(
  candidateRoot: string,
  inventory: FirstPartyInventory,
  inventoryDeclarations: ReadonlySet<string>,
): Promise<string[]> {
  const entries: string[] = [];
  for (const package_ of inventory.packages) {
    const manifestPath = candidatePathForIdentity(
      candidateRoot,
      package_.stagedManifest.path,
    );
    const manifest = requireRecord(
      await readJson(manifestPath),
      `${package_.name} staged manifest`,
    );
    if (manifest.name !== package_.name || manifest.version !== "0.2.0") {
      throw new Error(`${package_.name} staged manifest identity differs.`);
    }
    const targets: string[] = [];
    collectExportTypeTargets(manifest.exports, targets);
    for (const key of ["types", "typings"] as const) {
      if (manifest[key] !== undefined) {
        if (typeof manifest[key] !== "string") {
          throw new Error(`${package_.name} ${key} entry is invalid.`);
        }
        targets.push(manifest[key]);
      }
    }
    const uniqueTargets = sortedUnique(
      `${package_.name} retained declaration entries`,
      targets,
    );
    if (uniqueTargets.length === 0) {
      throw new Error(`${package_.name} has no retained declaration entry.`);
    }
    for (const target of uniqueTargets) {
      if (!target.startsWith("./")) {
        throw new Error(`${package_.name} declaration entry is not relative.`);
      }
      const identity = posix.normalize(
        `${package_.stagePath}/${target.slice(2)}`,
      );
      if (!inventoryDeclarations.has(identity)) {
        throw new Error(
          `${package_.name} declaration entry is absent from the first-party inventory: ${identity}.`,
        );
      }
      const entryPath = await realpath(
        candidatePathForIdentity(candidateRoot, identity),
      );
      if (candidateIdentity(candidateRoot, entryPath) !== identity) {
        throw new Error(
          `${package_.name} declaration entry does not retain its inventory identity.`,
        );
      }
      entries.push(entryPath);
    }
  }
  return sortedUnique("Retained first-party declaration entries", entries);
}

function createCandidateCompilerHost(
  options: ts.CompilerOptions,
  checkedInConsumer: string,
  installedConsumerLocation: string,
  candidateConsumerLocation: string,
  repositoryRoot: string,
): {
  readonly host: ts.CompilerHost;
  readonly moduleCache: ts.ModuleResolutionCache;
  readonly typeReferenceCache: ts.TypeReferenceDirectiveResolutionCache;
} {
  const host = ts.createCompilerHost(options, true);
  const moduleCache = ts.createModuleResolutionCache(
    repositoryRoot,
    (path) => host.getCanonicalFileName(path),
    options,
  );
  const typeReferenceCache = ts.createTypeReferenceDirectiveResolutionCache(
    repositoryRoot,
    (path) => host.getCanonicalFileName(path),
    options,
  );
  host.resolveModuleNameLiterals = (
    moduleLiterals,
    containingFile,
    redirectedReference,
    compilerOptions,
    containingSourceFile,
  ) => {
    const isConsumerRoot = pathsEqual(containingFile, checkedInConsumer);
    return moduleLiterals.map((usage) =>
      ts.resolveModuleName(
        usage.text,
        isConsumerRoot && usage.text !== "@thermite/cli"
          ? candidateConsumerLocation
          : isConsumerRoot
            ? installedConsumerLocation
            : containingFile,
        compilerOptions,
        host,
        moduleCache,
        redirectedReference,
        ts.getModeForUsageLocation(
          containingSourceFile,
          usage,
          compilerOptions,
        ),
      ),
    );
  };
  return { host, moduleCache, typeReferenceCache };
}

async function realProgramSources(
  program: ts.Program,
  label: string,
): Promise<RealProgramSource[]> {
  const sources: RealProgramSource[] = [];
  const compilerNamesByRealPath = new Map<string, string>();
  for (const sourceFile of program.getSourceFiles()) {
    const real = await realpath(resolve(sourceFile.fileName));
    const key = pathKey(real);
    const previous = compilerNamesByRealPath.get(key);
    if (previous !== undefined) {
      throw new Error(
        `${label} compiler filenames alias one realpath: '${previous}' and '${sourceFile.fileName}'.`,
      );
    }
    compilerNamesByRealPath.set(key, sourceFile.fileName);
    sources.push({ sourceFile, realPath: real });
  }
  return sources;
}

async function assertPinnedTestToolRoots(repositoryRoot: string): Promise<{
  readonly checkoutRoot: string;
  readonly nodeRoot: string;
  readonly undiciRoot: string;
  readonly typescriptLibRoot: string;
  readonly nodeEntry: string;
}> {
  const lock = await readBunLock(repositoryRoot);
  const nodeLock = lockedPackage(lock, "@types/node");
  const undiciLock = lockedPackage(lock, "undici-types");
  const typescriptLock = lockedPackage(lock, "typescript");
  const nodeDependencies = requireRecord(
    nodeLock.dependencies,
    "@types/node lock dependencies",
  );
  if (
    nodeLock.version !== "22.20.1" ||
    nodeDependencies["undici-types"] !== "~6.21.0" ||
    undiciLock.version !== "6.21.0" ||
    typescriptLock.version !== "5.9.3" ||
    ts.version !== "5.9.3"
  ) {
    throw new Error("Repository test-tool versions differ from Amendment C1.");
  }
  const [checkoutRoot, nodeRoot, undiciRoot, typescriptRoot] =
    await Promise.all([
      realpath(repositoryRoot),
      realpath(join(repositoryRoot, "node_modules", "@types", "node")),
      realpath(join(repositoryRoot, "node_modules", "undici-types")),
      realpath(join(repositoryRoot, "node_modules", "typescript")),
    ]);
  const manifests = await Promise.all([
    readJson(join(nodeRoot, "package.json")),
    readJson(join(undiciRoot, "package.json")),
    readJson(join(typescriptRoot, "package.json")),
  ]);
  const nodeManifest = requireRecord(manifests[0], "@types/node manifest");
  const undiciManifest = requireRecord(manifests[1], "undici-types manifest");
  const typescriptManifest = requireRecord(manifests[2], "TypeScript manifest");
  if (
    nodeManifest.name !== "@types/node" ||
    nodeManifest.version !== "22.20.1" ||
    undiciManifest.name !== "undici-types" ||
    undiciManifest.version !== "6.21.0" ||
    typescriptManifest.name !== "typescript" ||
    typescriptManifest.version !== "5.9.3"
  ) {
    throw new Error(
      "Installed test-tool package identity differs from the lock.",
    );
  }
  const nodeEntryField = nodeManifest.types ?? nodeManifest.typings;
  if (typeof nodeEntryField !== "string") {
    throw new Error("@types/node has no declaration entry.");
  }
  const [typescriptLibRoot, nodeEntry] = await Promise.all([
    realpath(join(typescriptRoot, "lib")),
    realpath(join(nodeRoot, ...nodeEntryField.split("/"))),
  ]);
  return { checkoutRoot, nodeRoot, undiciRoot, typescriptLibRoot, nodeEntry };
}

function nodeIdentityForSource(
  source: RealProgramSource,
  boundary: CompilerBoundary,
): string | undefined {
  if (isContainedBy(boundary.nodeRoot, source.realPath)) {
    return nodeToolIdentity(
      boundary.nodeRoot,
      "node_modules/@types/node",
      source.realPath,
    );
  }
  if (isContainedBy(boundary.undiciRoot, source.realPath)) {
    return nodeToolIdentity(
      boundary.undiciRoot,
      "node_modules/undici-types",
      source.realPath,
    );
  }
  return undefined;
}

async function expectedNodeToolClosure(
  options: ts.CompilerOptions,
  host: ts.CompilerHost,
  boundary: CompilerBoundary,
  nodeEntry: string,
): Promise<string[]> {
  const program = ts.createProgram({ rootNames: [nodeEntry], options, host });
  const identities: string[] = [];
  for (const source of await realProgramSources(
    program,
    "Expected Node test-tool closure",
  )) {
    const identity = nodeIdentityForSource(source, boundary);
    if (identity !== undefined) {
      if (!source.sourceFile.isDeclarationFile) {
        throw new Error(
          `Node test-tool closure loaded non-declaration '${identity}'.`,
        );
      }
      identities.push(identity);
      continue;
    }
    if (!isContainedBy(boundary.typescriptLibRoot, source.realPath)) {
      throw new Error(
        `Expected Node test-tool closure escaped its two roots: ${source.sourceFile.fileName}.`,
      );
    }
  }
  return sortedUnique("Expected Node test-tool closure", identities);
}

async function expectedFirstPartyClosure(
  options: ts.CompilerOptions,
  host: ts.CompilerHost,
  boundary: CompilerBoundary,
  rootNames: readonly string[],
  firstPartyInventory: ReadonlySet<string>,
  thirdPartyInventory: ReadonlySet<string>,
): Promise<string[]> {
  const program = ts.createProgram({ rootNames, options, host });
  const identities: string[] = [];
  for (const source of await realProgramSources(
    program,
    "Expected first-party declaration closure",
  )) {
    if (!isContainedBy(boundary.candidateRoot, source.realPath)) continue;
    if (!source.sourceFile.isDeclarationFile) {
      throw new Error(
        `Expected first-party closure loaded a candidate non-declaration: ${source.sourceFile.fileName}.`,
      );
    }
    const identity = candidateIdentity(boundary.candidateRoot, source.realPath);
    if (firstPartyInventory.has(identity)) {
      identities.push(identity);
    } else if (!thirdPartyInventory.has(identity)) {
      throw new Error(
        `Expected first-party closure loaded an uninventoried candidate declaration: ${identity}.`,
      );
    }
  }
  return sortedUnique("Expected first-party declaration closure", identities);
}

async function classifyLoadedProgram(
  program: ts.Program,
  checkedInSource: string,
  boundary: CompilerBoundary,
  expectedFirstParty: ReadonlySet<string>,
  expectedThirdParty: ReadonlySet<string>,
): Promise<LoadedDeclarationSets> {
  const firstParty: string[] = [];
  const thirdParty: string[] = [];
  const nodeTools: string[] = [];
  const candidateSources: RealProgramSource[] = [];
  const candidateIdentities = new Set<string>();
  const sourcesByRealPath = new Map<string, RealProgramSource>();
  let consumerRootCount = 0;
  for (const source of await realProgramSources(
    program,
    "Strict consumer program",
  )) {
    sourcesByRealPath.set(pathKey(source.realPath), source);
    if (!source.sourceFile.isDeclarationFile) {
      if (!pathsEqual(source.realPath, checkedInSource)) {
        throw new Error(
          `Unexpected non-declaration program source: ${source.sourceFile.fileName}.`,
        );
      }
      consumerRootCount += 1;
      continue;
    }
    if (isContainedBy(boundary.candidateRoot, source.realPath)) {
      if (isContainedBy(boundary.checkoutRoot, source.realPath)) {
        throw new Error(
          `Candidate declaration resolved inside the checkout: ${source.sourceFile.fileName}.`,
        );
      }
      const identity = candidateIdentity(
        boundary.candidateRoot,
        source.realPath,
      );
      if (candidateIdentities.has(identity)) {
        throw new Error(
          `Two loaded candidate files map to inventory identity '${identity}'.`,
        );
      }
      candidateIdentities.add(identity);
      candidateSources.push(source);
      if (expectedFirstParty.has(identity)) firstParty.push(identity);
      else if (expectedThirdParty.has(identity)) thirdParty.push(identity);
      else {
        throw new Error(
          `Loaded candidate declaration is outside the expected inventories: ${identity}.`,
        );
      }
      continue;
    }
    const nodeIdentity = nodeIdentityForSource(source, boundary);
    if (nodeIdentity !== undefined) {
      nodeTools.push(nodeIdentity);
      continue;
    }
    if (isContainedBy(boundary.typescriptLibRoot, source.realPath)) continue;
    throw new Error(
      `Program declaration is outside the candidate and exact test-tool roots: ${source.sourceFile.fileName}.`,
    );
  }
  if (consumerRootCount !== 1) {
    throw new Error(
      `Strict consumer program has ${consumerRootCount} non-declaration roots instead of one.`,
    );
  }
  return {
    firstParty: sortedUnique("Loaded first-party declarations", firstParty),
    thirdParty: sortedUnique("Loaded third-party declarations", thirdParty),
    nodeTools: sortedUnique("Loaded Node test-tool declarations", nodeTools),
    candidateSources,
    sourcesByRealPath,
  };
}

interface ModuleUsage {
  readonly kind:
    | "dynamic-import"
    | "export"
    | "import"
    | "import-equals"
    | "import-type"
    | "module-declaration";
  readonly usage: ts.StringLiteralLike;
}

function collectModuleUsages(sourceFile: ts.SourceFile): ModuleUsage[] {
  const usages: ModuleUsage[] = [];
  function add(kind: ModuleUsage["kind"], usage: ts.Node | undefined): void {
    if (usage !== undefined && ts.isStringLiteralLike(usage)) {
      usages.push({ kind, usage });
    }
  }
  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node)) {
      add("import", node.moduleSpecifier);
    } else if (ts.isExportDeclaration(node)) {
      add("export", node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      add("import-equals", node.moduleReference.expression);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument)
    ) {
      add("import-type", node.argument.literal);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      add("dynamic-import", node.arguments[0]);
    }
    if (ts.isModuleDeclaration(node)) {
      add("module-declaration", node.name);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return usages;
}

const APPROVED_CANDIDATE_TEST_TOOL_EDGES = new Set<string>();

function approvedTestToolEdgeKey(
  origin: string,
  kind: string,
  specifier: string,
  target: "node" | "typescript",
): string {
  return `${origin}\u0000${kind}\u0000${specifier}\u0000${target}`;
}

async function assertResolvedCandidateEdge({
  origin,
  edgeKind,
  specifier,
  resolvedFile,
  boundary,
  loaded,
  expectedFirstParty,
  expectedThirdParty,
  expectedNodeTools,
}: {
  readonly origin: string;
  readonly edgeKind: string;
  readonly specifier: string;
  readonly resolvedFile: string;
  readonly boundary: CompilerBoundary;
  readonly loaded: LoadedDeclarationSets;
  readonly expectedFirstParty: ReadonlySet<string>;
  readonly expectedThirdParty: ReadonlySet<string>;
  readonly expectedNodeTools: ReadonlySet<string>;
}): Promise<void> {
  const resolvedRealPath = await realpath(resolve(resolvedFile));
  const targetSource = loaded.sourcesByRealPath.get(pathKey(resolvedRealPath));
  if (
    targetSource === undefined ||
    !targetSource.sourceFile.isDeclarationFile
  ) {
    throw new Error(
      `Candidate declaration edge '${origin}' -> '${specifier}' did not resolve to a loaded declaration.`,
    );
  }
  if (isContainedBy(boundary.candidateRoot, resolvedRealPath)) {
    const identity = candidateIdentity(
      boundary.candidateRoot,
      resolvedRealPath,
    );
    const inFirstParty =
      expectedFirstParty.has(identity) && loaded.firstParty.includes(identity);
    const inThirdParty =
      expectedThirdParty.has(identity) && loaded.thirdParty.includes(identity);
    if (!inFirstParty && !inThirdParty) {
      throw new Error(
        `Candidate declaration edge '${origin}' -> '${specifier}' misses expected/loaded inventory membership at '${identity}'.`,
      );
    }
    return;
  }
  const nodeIdentity = nodeIdentityForSource(targetSource, boundary);
  if (nodeIdentity !== undefined) {
    const key = approvedTestToolEdgeKey(origin, edgeKind, specifier, "node");
    if (
      !APPROVED_CANDIDATE_TEST_TOOL_EDGES.has(key) ||
      !expectedNodeTools.has(nodeIdentity) ||
      !loaded.nodeTools.includes(nodeIdentity)
    ) {
      throw new Error(
        `Candidate declaration has an unapproved Node test-tool edge '${origin}' -> '${specifier}'.`,
      );
    }
    return;
  }
  if (isContainedBy(boundary.typescriptLibRoot, resolvedRealPath)) {
    const key = approvedTestToolEdgeKey(
      origin,
      edgeKind,
      specifier,
      "typescript",
    );
    if (!APPROVED_CANDIDATE_TEST_TOOL_EDGES.has(key)) {
      throw new Error(
        `Candidate declaration has an unapproved TypeScript-library edge '${origin}' -> '${specifier}'.`,
      );
    }
    return;
  }
  throw new Error(
    `Candidate declaration edge '${origin}' -> '${specifier}' resolved outside every permitted realpath root.`,
  );
}

async function assertCandidateDeclarationEdges({
  program,
  options,
  host,
  moduleCache,
  typeReferenceCache,
  boundary,
  loaded,
  expectedFirstParty,
  expectedThirdParty,
  expectedNodeTools,
}: {
  readonly program: ts.Program;
  readonly options: ts.CompilerOptions;
  readonly host: ts.CompilerHost;
  readonly moduleCache: ts.ModuleResolutionCache;
  readonly typeReferenceCache: ts.TypeReferenceDirectiveResolutionCache;
  readonly boundary: CompilerBoundary;
  readonly loaded: LoadedDeclarationSets;
  readonly expectedFirstParty: ReadonlySet<string>;
  readonly expectedThirdParty: ReadonlySet<string>;
  readonly expectedNodeTools: ReadonlySet<string>;
}): Promise<void> {
  for (const source of loaded.candidateSources) {
    const origin = candidateIdentity(boundary.candidateRoot, source.realPath);
    if (source.sourceFile.libReferenceDirectives.length !== 0) {
      throw new Error(
        `Candidate declaration '${origin}' contains a lib reference directive.`,
      );
    }
    for (const moduleUsage of collectModuleUsages(source.sourceFile)) {
      const specifier = moduleUsage.usage.text;
      const resolved = ts.resolveModuleName(
        specifier,
        source.sourceFile.fileName,
        options,
        host,
        moduleCache,
        undefined,
        program.getModeForUsageLocation(source.sourceFile, moduleUsage.usage),
      ).resolvedModule;
      if (
        resolved === undefined ||
        typeof resolved.resolvedFileName !== "string"
      ) {
        if (specifier.startsWith("node:") && isBuiltin(specifier)) continue;
        throw new Error(
          `Candidate declaration edge '${origin}' -> '${specifier}' is unresolved.`,
        );
      }
      await assertResolvedCandidateEdge({
        origin,
        edgeKind: moduleUsage.kind,
        specifier,
        resolvedFile: resolved.resolvedFileName,
        boundary,
        loaded,
        expectedFirstParty,
        expectedThirdParty,
        expectedNodeTools,
      });
    }
    for (const reference of source.sourceFile.referencedFiles) {
      const resolved = ts.resolveTripleslashReference(
        reference.fileName,
        source.sourceFile.fileName,
      );
      if (!host.fileExists(resolved)) {
        throw new Error(
          `Candidate triple-slash path '${origin}' -> '${reference.fileName}' is unresolved.`,
        );
      }
      await assertResolvedCandidateEdge({
        origin,
        edgeKind: "triple-slash-path",
        specifier: reference.fileName,
        resolvedFile: resolved,
        boundary,
        loaded,
        expectedFirstParty,
        expectedThirdParty,
        expectedNodeTools,
      });
    }
    for (const reference of source.sourceFile.typeReferenceDirectives) {
      const name = reference.fileName;
      const resolved = ts.resolveTypeReferenceDirective(
        name,
        source.sourceFile.fileName,
        options,
        host,
        undefined,
        typeReferenceCache,
        ts.getModeForFileReference(
          reference,
          source.sourceFile.impliedNodeFormat,
        ),
      ).resolvedTypeReferenceDirective;
      if (
        resolved === undefined ||
        typeof resolved.resolvedFileName !== "string"
      ) {
        throw new Error(
          `Candidate type-reference edge '${origin}' -> '${name}' is unresolved.`,
        );
      }
      await assertResolvedCandidateEdge({
        origin,
        edgeKind: "type-reference",
        specifier: name,
        resolvedFile: resolved.resolvedFileName,
        boundary,
        loaded,
        expectedFirstParty,
        expectedThirdParty,
        expectedNodeTools,
      });
    }
  }
}

export async function compileStrictCandidateConsumer({
  consumerDirectory,
  candidateRoot: candidateRootPath,
  checkedInSource,
  repositoryRoot,
}: {
  readonly consumerDirectory: string;
  readonly candidateRoot: string;
  readonly checkedInSource: string;
  readonly repositoryRoot: string;
}): Promise<void> {
  const inventories = await readDeclarationInventories(repositoryRoot);
  const tools = await assertPinnedTestToolRoots(repositoryRoot);
  const [candidateRoot, checkedInSourceRoot] = await Promise.all([
    realpath(candidateRootPath),
    realpath(checkedInSource),
  ]);
  const candidateManifest = requireRecord(
    await readJson(join(candidateRoot, "package.json")),
    "Installed candidate manifest",
  );
  if (
    candidateManifest.name !== "@thermite/cli" ||
    candidateManifest.version !== "0.2.0"
  ) {
    throw new Error(
      "Fresh local install does not contain the exact CLI candidate.",
    );
  }
  if (isContainedBy(tools.checkoutRoot, candidateRoot)) {
    throw new Error(
      "Freshly installed candidate root resolves inside the checkout.",
    );
  }
  const boundary: CompilerBoundary = {
    candidateRoot,
    checkoutRoot: tools.checkoutRoot,
    nodeRoot: tools.nodeRoot,
    undiciRoot: tools.undiciRoot,
    typescriptLibRoot: tools.typescriptLibRoot,
  };
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    typeRoots: [join(repositoryRoot, "node_modules", "@types")],
    types: ["node"],
  };
  const compiler = createCandidateCompilerHost(
    options,
    checkedInSourceRoot,
    join(consumerDirectory, "consumer.ts"),
    join(candidateRoot, "consumer.ts"),
    repositoryRoot,
  );
  const program = ts.createProgram({
    rootNames: [checkedInSourceRoot],
    options,
    host: compiler.host,
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length !== 0) {
    throw new Error(
      `Strict candidate consumer produced ${diagnostics.length} diagnostics.\n${diagnostics
        .map((value) =>
          ts.flattenDiagnosticMessageText(value.messageText, "\n"),
        )
        .join("\n")}`,
    );
  }

  const firstInventorySet = new Set(inventories.firstPartyDeclarations);
  const thirdInventorySet = new Set(inventories.thirdPartyDeclarations);
  const firstEntries = await retainedFirstPartyEntries(
    candidateRoot,
    inventories.firstParty,
    firstInventorySet,
  );
  const expectedFirstParty = await expectedFirstPartyClosure(
    options,
    compiler.host,
    boundary,
    firstEntries,
    firstInventorySet,
    thirdInventorySet,
  );
  const expectedNodeTools = await expectedNodeToolClosure(
    options,
    compiler.host,
    boundary,
    tools.nodeEntry,
  );
  const loaded = await classifyLoadedProgram(
    program,
    checkedInSourceRoot,
    boundary,
    new Set(expectedFirstParty),
    thirdInventorySet,
  );
  assertExactIdentities(
    "Loaded first-party declaration closure",
    loaded.firstParty,
    expectedFirstParty,
  );
  assertExactIdentities(
    "Loaded third-party declaration closure",
    loaded.thirdParty,
    inventories.thirdPartyDeclarations,
  );
  assertExactIdentities(
    "Loaded Node test-tool declaration closure",
    loaded.nodeTools,
    expectedNodeTools,
  );
  await assertCandidateDeclarationEdges({
    program,
    options,
    host: compiler.host,
    moduleCache: compiler.moduleCache,
    typeReferenceCache: compiler.typeReferenceCache,
    boundary,
    loaded,
    expectedFirstParty: new Set(expectedFirstParty),
    expectedThirdParty: thirdInventorySet,
    expectedNodeTools: new Set(expectedNodeTools),
  });
}
