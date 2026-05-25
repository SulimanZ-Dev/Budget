/**
 * Generates a simple 512x512 PNG placeholder icon.
 * Run: node scripts/generate-icon.js
 * For production, replace resources/icon.png with your brand asset.
 */
const fs = require('fs')
const path = require('path')

// Minimal valid 1x1 blue PNG expanded via note - user should replace with real 512px asset
// We write a simple SVG that tools can convert; for build, copy a bundled placeholder.

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#2563eb"/>
  <text x="256" y="290" font-family="Segoe UI, sans-serif" font-size="180" font-weight="700" fill="white" text-anchor="middle">B</text>
</svg>`

const resources = path.join(__dirname, '..', 'resources')
if (!fs.existsSync(resources)) fs.mkdirSync(resources, { recursive: true })
fs.writeFileSync(path.join(resources, 'icon.svg'), svg)
console.log('Wrote resources/icon.svg — convert to icon.png (512x512) and icon.ico for production builds.')
