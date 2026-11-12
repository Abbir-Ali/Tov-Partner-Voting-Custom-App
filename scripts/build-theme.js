#!/usr/bin/env node
/**
 * Bundle theme-src JS into pvb-theme assets.
 *
 * Size limits:
 * - pvb-button.js, pvb-drawer.js: 10,000 bytes
 *   These are loaded on the page and referenced in block schemas.
 *   Shopify theme check enforces a 10KB limit on such assets.
 *
 * - pvb-share.js: 12,000 bytes
 *   This is lazy-loaded on first tap of "Get a Second Opinion".
 *   Not referenced in any block schema, so theme check doesn't apply.
 *   Extra budget allows readable code with full UI.
 */
import * as esbuild from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { statSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const src = join(root, 'theme-src');
const out = join(root, 'extensions', 'pvb-theme', 'assets');

const bundles = [
  { entry: 'entry-button.js', output: 'pvb-button.js', limit: 10000 },
  { entry: 'entry-drawer.js', output: 'pvb-drawer.js', limit: 10000 },
  { entry: 'entry-share.js', output: 'pvb-share.js', limit: 12000 }
];

async function build() {
  let failed = false;

  for (const { entry, output, limit } of bundles) {
    await esbuild.build({
      entryPoints: [join(src, entry)],
      outfile: join(out, output),
      bundle: true,
      minify: true,
      format: 'iife',
      target: ['es2017'],
      legalComments: 'none',
      banner: { js: '/* eslint-disable */' }
    });

    const size = statSync(join(out, output)).size;
    const ok = size <= limit;
    const status = ok ? '✓' : '✗ OVER LIMIT';
    console.log(`${output}: ${size.toLocaleString()} bytes (limit ${limit.toLocaleString()}) ${status}`);

    if (!ok) failed = true;
  }

  if (failed) {
    console.error('\nBuild failed: one or more bundles exceed size limit.');
    // eslint-disable-next-line no-undef
    process.exit(1);
  }
}

build().catch(e => {
  console.error(e);
  // eslint-disable-next-line no-undef
  process.exit(1);
});
