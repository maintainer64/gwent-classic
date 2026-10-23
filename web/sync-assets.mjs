import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const web = dirname(fileURLToPath(import.meta.url)),
  root = join(web, '..'),
  out = join(web, 'public')
mkdirSync(out, { recursive: true })
for (const name of ['img', 'svg', 'sfx']) {
  const source = join(root, name)
  if (!existsSync(source)) throw Error(`Missing game assets: ${name}`)
  rmSync(join(out, name), { recursive: true, force: true })
  cpSync(source, join(out, name), { recursive: true, force: true })
}
const fontLicenses = join(out, 'licenses', 'fonts')
mkdirSync(fontLicenses, { recursive: true })
for (const name of ['PT-Sans-OFL.txt', 'Roboto-Slab-LICENSE.txt']) {
  cpSync(join(web, 'src', 'ui', 'fonts', name), join(fontLicenses, name))
}
writeFileSync(
  join(out, 'mark.svg'),
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#16252b"/><text x="32" y="46" text-anchor="middle" font-size="48" fill="#d7b57b">♧</text></svg>',
)
