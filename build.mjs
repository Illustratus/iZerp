// build.mjs — produce the minified dist/ bundle with esbuild.
//   npm run build
// iZerp's sources (izerp-lib.js / .css) stay hand-editable and drop-in usable;
// this only generates the optional minified variants that jsDelivr/unpkg serve.
import { build } from 'esbuild';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)));
const banner = `/*! iZerp v${pkg.version} | MIT License | ${pkg.homepage} */`;

mkdirSync(new URL('./dist/', import.meta.url), { recursive: true });

const targets = [
  { in: 'izerp-lib.js',  out: 'dist/izerp-lib.min.js',  loader: 'js'  },
  { in: 'izerp-lib.css', out: 'dist/izerp-lib.min.css', loader: 'css' },
];

for (const t of targets) {
  await build({
    entryPoints: [t.in],
    outfile: t.out,
    minify: true,
    bundle: false,
    legalComments: 'none',
    banner: { [t.loader]: banner },
    logLevel: 'info',
  });
  const bytes = readFileSync(new URL('./' + t.out, import.meta.url)).length;
  console.log(`  ${t.out}  ${(bytes / 1024).toFixed(1)} kB`);
}

// A tiny manifest so consumers/CI can see what was built.
writeFileSync(
  new URL('./dist/BUILD.txt', import.meta.url),
  [
    `iZerp v${pkg.version} minified build`,
    ...targets.map(t => `- ${t.out}`),
    'Regenerate with: npm run build',
    '',
  ].join('\n')
);

console.log('build complete');
