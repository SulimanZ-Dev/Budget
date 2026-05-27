/* Build/package order is mandatory:
 * 1) clean previous artifacts
 * 2) compile fresh app bundles
 * 3) validate output is newer than source files
 * 4) write a build fingerprint for release verification
 * 5) run electron-builder packaging
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execSync } = require('child_process')

const root = path.resolve(__dirname, '..')
const srcDir = path.join(root, 'src')
const outDir = path.join(root, 'out')
const releaseDir = path.join(root, 'release')

function walk(dir, predicate, files = []) {
  if (!fs.existsSync(dir)) return files
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(abs, predicate, files)
    } else if (predicate(abs)) {
      files.push(abs)
    }
  }
  return files
}

function latestMtimeMs(paths) {
  return paths.reduce((max, file) => Math.max(max, fs.statSync(file).mtimeMs), 0)
}

function hashDir(dir) {
  const hash = crypto.createHash('sha256')
  const files = walk(dir, (f) => f.endsWith('.js') || f.endsWith('.html') || f.endsWith('.css')).sort()
  for (const file of files) {
    hash.update(path.relative(dir, file))
    hash.update(fs.readFileSync(file))
  }
  return hash.digest('hex')
}

if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true, force: true })
if (fs.existsSync(releaseDir)) fs.rmSync(releaseDir, { recursive: true, force: true })

execSync('npm run build', { cwd: root, stdio: 'inherit' })

const srcFiles = walk(srcDir, (f) => /\.(ts|tsx|css|html)$/.test(f))
const outFiles = walk(outDir, (f) => /\.(js|css|html)$/.test(f))

if (!outFiles.length) {
  throw new Error('Build output missing: out/ contains no packaged assets.')
}

const srcLatest = latestMtimeMs(srcFiles)
const outLatest = latestMtimeMs(outFiles)
if (outLatest < srcLatest) {
  throw new Error('Build output appears stale: out/ is older than src/.')
}

if (!fs.existsSync(releaseDir)) fs.mkdirSync(releaseDir, { recursive: true })
const buildHash = hashDir(outDir)
fs.writeFileSync(
  path.join(releaseDir, 'build-fingerprint.json'),
  JSON.stringify({ builtAt: new Date().toISOString(), hash: buildHash }, null, 2)
)
console.log(`Verified fresh build. fingerprint=${buildHash}`)
