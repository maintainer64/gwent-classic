// Vite empties web/dist on every build, which would drop the original game
// files (legacy scripts, card art, sounds). Copy them from the repository
// root after each build so web/dist is always runnable on its own.
// The Docker build keeps them in web/public/ instead and copies art in the
// final stage, so missing entries are skipped, not fatal.
import { cpSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const webDir = dirname(fileURLToPath(import.meta.url))
const root = join(webDir, '..')
const dist = join(webDir, 'dist')
const entries = [
  'style.css', 'common.js', 'cards.js', 'decks.js',
  'abilities.js', 'factions.js', 'gwent.js', 'img', 'svg', 'sfx',
]
let copied = 0
for (const name of entries) {
  const from = join(root, name)
  if (!existsSync(from)) continue
  cpSync(from, join(dist, name), { recursive: true })
  copied++
}
console.log(`copy-legacy: ${copied}/${entries.length} entries -> dist`)
