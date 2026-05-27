const { build, context } = require('esbuild')
const isWatch = process.argv.includes('--watch')

const config = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  minify: true,
  format: 'iife',
  globalName: 'AlgoliaWebflow',
  outfile: 'dist/algolia-webflow.min.js',
  platform: 'browser',
  target: ['es2020'],
}

if (isWatch) {
  context(config).then((ctx) => ctx.watch())
} else {
  build(config).catch(() => process.exit(1))
}
