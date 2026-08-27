// Regenerates scripts/lib/known-permissions.mjs — the allowlist the entry gate
// validates a plugin manifest's `permissions[]` against.
//
// Fetches the canonical PLUGIN_PERMISSIONS array straight from TREK's shared
// package (the single source of truth both server and client build against),
// so the vendored snapshot here can't drift silently. This is a rare
// maintenance step — regenerate it when TREK adds/removes a permission id.
//
// Does NOT run in CI or in the selftest: it hits the network and trusts
// whatever main currently has. Run it by hand when the permission list changes:
//
//   node scripts/gen-known-permissions.mjs
//
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

const SOURCE_URL = 'https://raw.githubusercontent.com/liketrek/TREK/main/shared/src/plugin-permissions.ts'
// Sanity floor: the real list has 63 entries as of this writing. Anything far
// short of that means the fetch got a redirect/error page, an empty file, or
// the source moved — fail loudly rather than vendor a truncated allowlist.
const MIN_PERMISSIONS = 60

const res = await fetch(SOURCE_URL)
if (!res.ok) {
  console.error(`fetch failed: ${SOURCE_URL} (${res.status})`)
  process.exit(1)
}
const text = await res.text()

// Extract the quoted string literals inside the PLUGIN_PERMISSIONS array block only —
// not the whole file (PLUGIN_HOOK_PERMISSION below it also has quoted strings).
const arrayMatch = text.match(/PLUGIN_PERMISSIONS[^=]*=\s*\[([\s\S]*?)\]/)
if (!arrayMatch) {
  console.error(`could not find a PLUGIN_PERMISSIONS array in ${SOURCE_URL}`)
  process.exit(1)
}
const ids = [...arrayMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1])

if (ids.length < MIN_PERMISSIONS) {
  console.error(`only found ${ids.length} permission ids (expected at least ${MIN_PERMISSIONS}) — refusing to vendor a possibly-truncated list`)
  process.exit(1)
}

const source = `// GENERATED — do not edit by hand.
// Source: shared/src/plugin-permissions.ts (PLUGIN_PERMISSIONS, ${ids.length} ids) in
// https://github.com/liketrek/TREK — the flat permission id list a plugin
// manifest's \`permissions[]\` is checked against at install time.
// Regenerate: node scripts/gen-known-permissions.mjs
//
// HTTP_OUTBOUND_PREFIX and HOST_RE are ported from
// server/src/nest/plugins/install/manifest.ts:138 (HOST_RE) — the regex that
// gates a scoped \`http:outbound:<host>\` permission. HOST_RE MUST stay
// behaviourally identical: CI is the gate that decides whether an entry is
// publishable, and TREK is the gate that decides whether it installs. If CI
// accepts a scoped permission TREK would refuse (or vice versa), an entry
// merges here that either bricks the install or blocks a legitimate one.
export const KNOWN_PERMISSIONS = new Set([
${ids.map((id) => '  ' + JSON.stringify(id) + ',').join('\n')}
]);

export const HTTP_OUTBOUND_PREFIX = 'http:outbound:';

// Verbatim from server/src/nest/plugins/install/manifest.ts:138.
export const HOST_RE = /^(\\*\\.[a-z0-9-]+(\\.[a-z0-9-]+)+|[a-z0-9-]+(\\.[a-z0-9-]+)*)$/i;
`

writeFileSync(join(here, 'lib', 'known-permissions.mjs'), source)
console.log(`wrote ${ids.length} permission ids from ${SOURCE_URL}`)
