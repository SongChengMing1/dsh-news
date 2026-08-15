#!/usr/bin/env node
/**
 * Verify the built client bundle satisfies the web shell's module-loader
 * contract: `window.__ModuleLoader__.load({ id, factory })` with the package
 * name as id, a factory taking `require`, and `module.exports` returned.
 * Run after `pnpm build` (CI: "Verify bundle format" step).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const bundle = readFileSync(join(root, 'lib/client.js'), 'utf8')

const problems = []
const expect = (cond, msg) => { if (!cond) problems.push(msg) }

// Strip the trailing sourceMappingURL comment before structural checks.
const code = bundle.replace(/\n\/\/# sourceMappingURL=.*$/, '')

expect(bundle.startsWith('window.__ModuleLoader__.load({'), 'bundle must start with window.__ModuleLoader__.load({')
expect(bundle.includes(`id: ${JSON.stringify(pkg.name)}`), `bundle id must be ${pkg.name}`)
expect(bundle.includes('factory: (require) => {'), 'bundle must expose a factory(require)')
expect(code.trimEnd().endsWith('});'), 'bundle must close the load({...}) call')
expect(bundle.includes('return module.exports;'), 'factory must return module.exports')
expect(bundle.includes('exports.apply = apply;'), 'bundle must export apply')
expect(bundle.includes('exports.inject = inject;'), 'bundle must export inject')

if (problems.length > 0) {
  console.error('client bundle verification failed:\n- ' + problems.join('\n- '))
  process.exit(1)
}
console.log(`client bundle ok (${(bundle.length / 1024).toFixed(1)} KiB)`)
