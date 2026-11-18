import type { ChangedFile } from "../shared/contracts";

const CODE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "go", "py", "rs", "java", "kt", "rb", "php", "cs",
  "swift", "c", "cc", "cpp", "h",
]);

const TEST_DIRS = new Set(["tests", "test", "__tests__", "spec"]);

const GENERATED_DIRS = new Set(["dist", "build", "vendor", "node_modules"]);

export const MANIFEST_LOCKFILES: Readonly<Record<string, readonly string[]>> = {
  "package.json": [
    "package-lock.json",
    "npm-shrinkwrap.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "bun.lock",
    "bun.lockb",
  ],
  "go.mod": ["go.sum"],
  "Cargo.toml": ["Cargo.lock"],
  "pyproject.toml": ["poetry.lock", "uv.lock", "pdm.lock"],
  Gemfile: ["Gemfile.lock"],
};

/** Lockfile names for a manifest file name; undefined when it is not a known manifest. */
export function lockfilesFor(manifestName: string): readonly string[] | undefined {
  return Object.hasOwn(MANIFEST_LOCKFILES, manifestName) ? MANIFEST_LOCKFILES[manifestName] : undefined;
}

const LOCKFILE_NAMES = new Set(Object.values(MANIFEST_LOCKFILES).flat());

export function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** Directory of a path; "" for the repo root. */
export function dirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

function extension(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

function directorySegments(path: string): string[] {
  return path.split("/").slice(0, -1);
}

export function isLockfile(path: string): boolean {
  const name = basename(path);
  return LOCKFILE_NAMES.has(name) || name.endsWith(".lock") || name.endsWith(".lockb");
}

export function isTestFile(path: string): boolean {
  const name = basename(path);
  return (
    directorySegments(path).some((segment) => TEST_DIRS.has(segment)) ||
    /\.(test|spec)\./.test(name) ||
    name.endsWith("_test.go") ||
    /^test_.*\.py$/.test(name) ||
    name.endsWith("_test.py")
  );
}

export function isCodeFile(path: string): boolean {
  return CODE_EXTENSIONS.has(extension(path));
}

export function isGeneratedOrVendored(path: string): boolean {
  const name = basename(path);
  return (
    directorySegments(path).some((segment) => GENERATED_DIRS.has(segment)) ||
    /\.min\.(js|css)$/.test(name) ||
    name.endsWith(".map") ||
    name.endsWith(".snap") ||
    isLockfile(path)
  );
}

/** Added, modified or renamed: the file has content in the PR head. */
export function isTouched(file: ChangedFile): boolean {
  return file.status === "added" || file.status === "modified" || file.status === "renamed";
}
