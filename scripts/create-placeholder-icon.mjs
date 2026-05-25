import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const resources = join(__dirname, '..', 'resources')
if (!existsSync(resources)) mkdirSync(resources, { recursive: true })

// 512x512 solid blue PNG (minimal valid PNG - pre-generated base64 chunk)
// In production replace with your 512x512 brand asset
const png512 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)
writeFileSync(join(resources, 'icon.png'), png512)
console.log('Created resources/icon.png (placeholder 1x1 — replace with 512x512 for release)')
