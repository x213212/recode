import {
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  rmSync,
  symlinkSync
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = process.env.NEXT_DIST_DIR || ".next";
const standaloneRoot = resolve(projectRoot, distDir, "standalone");
const publicRoot = process.env.RECODE_PUBLIC_DIR
  ? resolve(projectRoot, process.env.RECODE_PUBLIC_DIR)
  : resolve(projectRoot, "public");

const links = [
  {
    source: publicRoot,
    destination: resolve(standaloneRoot, "public")
  },
  {
    source: resolve(projectRoot, distDir, "static"),
    destination: resolve(standaloneRoot, distDir, "static")
  }
];

for (const { source, destination } of links) {
  if (!existsSync(source)) {
    throw new Error(`缺少 standalone 必要資源：${source}`);
  }

  mkdirSync(dirname(destination), { recursive: true });
  const expectedTarget = relative(dirname(destination), source);

  if (existsSync(destination) || lstatExists(destination)) {
    const stat = lstatSync(destination);
    if (stat.isSymbolicLink() && readlinkSync(destination) === expectedTarget) {
      continue;
    }

    rmSync(destination, { recursive: true, force: true });
  }

  symlinkSync(expectedTarget, destination, "dir");
}

function lstatExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}
