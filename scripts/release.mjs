#!/usr/bin/env node
/**
 * Release helper: bump version, run the full gate, build, and print the
 * exact publish / GitHub commands (publishing needs your npm token; GitHub
 * needs a token or the gh CLI).
 *
 * Usage:
 *   node scripts/release.mjs [major|minor|patch]   (default: patch)
 *
 * Steps it performs:
 *   1. pnpm typecheck && pnpm test && pnpm build + bundle verify
 *   2. bump package.json version (no commit — you decide the commit shape)
 *   3. print the remaining manual commands
 */
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const pkgPath = join(root, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))

const step = process.argv[2] ?? 'patch'
if (!['major', 'minor', 'patch'].includes(step)) {
  console.error('usage: node scripts/release.mjs [major|minor|patch]')
  process.exit(1)
}

const run = (cmd) => {
  console.log(`\n$ ${cmd}`)
  execSync(cmd, { cwd: root, stdio: 'inherit' })
}

console.log('== release gate ==')
run('pnpm typecheck')
run('pnpm test')
run('pnpm build')
run('node scripts/verify-bundle.mjs')

// Bump version.
const [major, minor, patch] = pkg.version.split('.').map(Number)
const next = step === 'major' ? `${major + 1}.0.0` : step === 'minor' ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`
pkg.version = next
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
console.log(`\n== version bumped to ${next} ==`)

const tag = `v${next}`
console.log(`
== remaining manual steps (need your npm / GitHub credentials) ==

git add package.json pnpm-lock.yaml
git commit -m "chore: release ${next}"
git tag ${tag}

# publish (npm token required; run once per version)
npm publish --access public

# push + GitHub release (gh CLI or token required)
git push origin main --tags
gh release create ${tag} --title "dsh-news ${next}" --notes "See CHANGELOG / README."
`)
