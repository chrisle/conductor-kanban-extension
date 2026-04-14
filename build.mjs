import { build, context } from 'esbuild'
import { cpSync, mkdirSync } from 'fs'

const watch = process.argv.includes('--watch')

const options = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  outfile: 'dist/index.js',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  sourcemap: true,
  loader: { '.md': 'text' },
  external: [
    'react',
    'react-dom',
    'lucide-react',
    '@conductor/extension-sdk',
    '@conductor/extension-api',
  ],
}

mkdirSync('dist', { recursive: true })
cpSync('manifest.json', 'dist/manifest.json')

if (watch) {
  const ctx = await context(options)
  await ctx.watch()
  console.log('Watching for changes...')
} else {
  await build(options)
  console.log('Built dist/index.js')
}
