#!/usr/bin/env node
/**
 * Bundle theme-src JS into pvb-theme assets.
 * Creates two minified bundles under 10KB each.
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
  { entry: 'entry-button.js', output: 'pvb-button.js' },
  { entry: 'entry-drawer.js', output: 'pvb-drawer.js' }
];

async function build() {
  for (const { entry, output } of bundles) {
    await esbuild.build({
      entryPoints: [join(src, entry)],
      outfile: join(out, output),
      bundle: true,
      minify: true,
      format: 'iife',
      target: ['es2017'],
      legalComments: 'none'
    });

    const size = statSync(join(out, output)).size;
    const ok = size < 10000 ? '✓' : '✗ OVER LIMIT';
    console.log(`${output}: ${size.toLocaleString()} bytes ${ok}`);
  }
}

build().catch(e => {
  console.error(e);
  // eslint-disable-next-line no-undef
  process.exit(1);
});
