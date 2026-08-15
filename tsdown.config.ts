import { defineConfig } from 'tsdown'

/**
 * dsh-news build: two bundles from one source tree.
 *
 * - `lib/index.js`  — Host half (node). Plain ESM; `@deepseek-ai/*` peers stay
 *   external (the host provides them at runtime).
 * - `lib/client.js` — Browser half (web). Compiled to the CJS factory shape
 *   the web shell's `window.__ModuleLoader__.load({ id, factory })` contract
 *   expects: `id` is the package name and `factory(require)` must return
 *   `module.exports`. React and the `@deepseek-ai/dsh-client-*` modules stay
 *   external — the loader resolves them from the shell instance.
 *
 * Both entries share `lib/` and each carries its own format/packaging, so the
 * two configs are declared as an array (tsdown builds them in one run).
 */
const CLIENT_ID = '@wilond/dsh-news'

const external = [
  /^@deepseek-ai\//,
  /^@wilond\//,
  'react',
  'react-dom',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'react-dom/client',
]

export default defineConfig([
  {
    name: 'host',
    entry: { index: 'src/index.ts' },
    format: 'esm',
    platform: 'node',
    outDir: 'lib',
    clean: false,
    sourcemap: true,
    dts: true,
    deps: {
      neverBundle: external,
    },
    outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  },
  {
    name: 'client',
    entry: { client: 'src/client.ts' },
    format: 'cjs',
    platform: 'browser',
    outDir: 'lib',
    clean: false,
    sourcemap: true,
    dts: true,
    target: 'es2020',
    deps: {
      neverBundle: external,
    },
    outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
    banner: [
      `window.__ModuleLoader__.load({`,
      `\tid: ${JSON.stringify(CLIENT_ID)},`,
      `\tfactory: (require) => {`,
      `\t\tvar module = { exports: {} };`,
      `\t\tvar exports = module.exports;`,
    ].join('\n'),
    footer: ['\t\treturn module.exports;', '\t}', '});'].join('\n'),
  },
])
