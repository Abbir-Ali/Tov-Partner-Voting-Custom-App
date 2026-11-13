/**
 * Build vote-page and results-page JS/CSS into server-only modules.
 * Outputs:
 *   app/vote-page/dist/vote-assets.server.js (limit 24 KB)
 *   app/results-page/dist/results-assets.server.js (limit 15 KB)
 */

/* global Buffer, process */

import * as esbuild from "esbuild";
import { writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const VOTE_PAGE_DIR = join(ROOT, "app", "vote-page");
const VOTE_DIST_DIR = join(VOTE_PAGE_DIR, "dist");
const VOTE_SIZE_LIMIT = 24000; // 24 KB

const RESULTS_PAGE_DIR = join(ROOT, "app", "results-page");
const RESULTS_DIST_DIR = join(RESULTS_PAGE_DIR, "dist");
const RESULTS_SIZE_LIMIT = 15000; // 15 KB

// Escape for JS template string
const escapeForTemplate = (str) =>
  str.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");

async function buildPage(name, srcDir, distDir, sizeLimit) {
  mkdirSync(distDir, { recursive: true });

  // Build JS
  const jsResult = await esbuild.build({
    entryPoints: [join(srcDir, `${name}.js`)],
    bundle: true,
    minify: true,
    write: false,
    format: "iife",
    target: ["es2020"],
  });
  const jsCode = jsResult.outputFiles[0].text;

  // Build CSS
  const cssResult = await esbuild.build({
    entryPoints: [join(srcDir, `${name}.css`)],
    bundle: true,
    minify: true,
    write: false,
    loader: { ".css": "css" },
  });
  const cssCode = cssResult.outputFiles[0].text;

  // Check combined size
  const jsSize = Buffer.byteLength(jsCode, "utf8");
  const cssSize = Buffer.byteLength(cssCode, "utf8");
  const totalSize = jsSize + cssSize;

  console.log(`${name}.js: ${jsSize.toLocaleString()} bytes`);
  console.log(`${name}.css: ${cssSize.toLocaleString()} bytes`);
  console.log(`Total: ${totalSize.toLocaleString()} bytes (limit ${sizeLimit.toLocaleString()})`);

  if (totalSize > sizeLimit) {
    console.error(`\nBuild failed: ${name} size ${totalSize} exceeds limit ${sizeLimit}`);
    process.exit(1);
  }

  // Export names: VOTE_JS/VOTE_CSS or RESULTS_JS/RESULTS_CSS
  const exportName = name.toUpperCase();
  const serverModule = `/**
 * ${name.charAt(0).toUpperCase() + name.slice(1)} page assets (auto-generated).
 * Do not edit by hand.
 */

export const ${exportName}_JS = \`${escapeForTemplate(jsCode)}\`;

export const ${exportName}_CSS = \`${escapeForTemplate(cssCode)}\`;

export const ${exportName}_ASSETS_SIZE = ${totalSize};
`;

  writeFileSync(join(distDir, `${name}-assets.server.js`), serverModule);
  console.log(`Wrote app/${name}-page/dist/${name}-assets.server.js\n`);

  return { jsSize, cssSize, totalSize };
}

async function build() {
  console.log("Building vote page...");
  await buildPage("vote", VOTE_PAGE_DIR, VOTE_DIST_DIR, VOTE_SIZE_LIMIT);

  console.log("Building results page...");
  await buildPage("results", RESULTS_PAGE_DIR, RESULTS_DIST_DIR, RESULTS_SIZE_LIMIT);

  console.log("All builds complete");
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
