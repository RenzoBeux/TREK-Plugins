// Warn plugin authors before a major TREK release strands their plugin.
//
// A manifest's `trek` range is load-bearing: TREK refuses to install a plugin whose range
// excludes the running version and refuses to ACTIVATE one it has since outgrown, with no
// admin override. So every major bump silently switches off every plugin whose ceiling sits
// below it — unless the authors re-release first. This script finds those plugins from the
// registry alone and opens one issue per repo asking for a widened range and a fresh test.
//
// Usage:  node scripts/notify-major-upgrade.mjs <currentTrek> <newTrek> [options]
//   e.g.  node scripts/notify-major-upgrade.mjs 3.4.1 4.0.0 --eta "the coming week"
//         node scripts/notify-major-upgrade.mjs 3.4.1 4.0.0 --eta "the coming week" --open
//
// Options:
//   --ceiling <X.Y.Z>  range ceiling to ask for (default: the major after <newTrek>)
//   --eta <text>       when <newTrek> ships, e.g. "the coming week" (default: unstated)
//   --image <name>     docker image authors test against (default: mauriceboe/trek)
//   --test-tag <tag>   tag of that image (default: <newTrek>)
//   --only <id,...>    restrict to these plugin ids
//   --only-blocked     skip plugins that survive <newTrek> but stop before the ceiling
//   --out <dir>        write every rendered issue to <dir>/<owner>__<repo>.md
//   --print            print every rendered issue to stdout
//   --label <name>     label to apply (repeatable; the label must already exist there)
//   --allow-duplicate  open an issue even where a previous run's issue already exists
//   --open             actually create the issues (default: dry run — nothing is posted)
//
// Dry run is the default and touches nothing. --open shells out to `gh`, so it posts under
// whatever account `gh auth status` reports.

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { mkdtempSync } from 'node:fs'
import path from 'node:path'
import semver from 'semver'
import { hostSatisfies, trekCeiling, trekFloor, satisfiableRange } from './lib/trek-range.mjs'

// --- args ---------------------------------------------------------------------------

const argv = process.argv.slice(2)
const flags = { label: [] }
const positional = []
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (!a.startsWith('--')) { positional.push(a); continue }
  const key = a.slice(2)
  switch (key) {
    case 'only-blocked': case 'open': case 'print': case 'allow-duplicate':
      flags[key] = true; break
    case 'label':
      flags.label.push(argv[++i]); break
    case 'ceiling': case 'eta': case 'image': case 'test-tag': case 'only': case 'out':
      flags[key] = argv[++i]; break
    default:
      die(`unknown option --${key}`)
  }
}

function die(msg) {
  console.error(`error: ${msg}\n\nusage: node scripts/notify-major-upgrade.mjs <currentTrek> <newTrek> [options]\n       (see the header of this file for the full option list)`)
  process.exit(2)
}

const [currentTrek, newTrek] = positional
if (!currentTrek || !newTrek) die('both <currentTrek> and <newTrek> are required')
for (const [label, v] of [['currentTrek', currentTrek], ['newTrek', newTrek]]) {
  if (!semver.valid(v)) die(`${label} "${v}" is not a semver version (e.g. 3.4.1)`)
}
if (semver.gte(currentTrek, newTrek)) die(`newTrek (${newTrek}) must be greater than currentTrek (${currentTrek})`)

// The range we ask authors for. Defaulting to the next major says the true thing — "this
// works on the whole of the new major line, and I make no promise past it" — which is what
// makes the NEXT run of this script meaningful.
const ceiling = flags.ceiling ?? `${semver.major(newTrek) + 1}.0.0`
if (!semver.valid(ceiling)) die(`--ceiling "${ceiling}" is not a semver version`)
if (semver.lte(ceiling, newTrek)) die(`--ceiling (${ceiling}) must be greater than newTrek (${newTrek})`)

const image = flags.image ?? 'mauriceboe/trek'
const testTag = flags['test-tag'] ?? newTrek
const onlyIds = flags.only ? new Set(flags.only.split(',').map((s) => s.trim()).filter(Boolean)) : null
const marker = `<!-- trek-plugins/major-upgrade:v${semver.major(newTrek)} -->`
const title = `Action needed: TREK ${semver.major(newTrek)} — re-release with a widened \`trek\` range`

// --- classify -----------------------------------------------------------------------

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const entries = readdirSync(path.join(ROOT, 'registry', 'plugins'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(path.join(ROOT, 'registry', 'plugins', f), 'utf8')))
  .filter((e) => !onlyIds || onlyIds.has(e.id))

/** The entry's newest published version — by semver, not by array order. */
function latestVersion(entry) {
  return [...(entry.versions ?? [])]
    .filter((v) => semver.valid(v.version))
    .sort((a, b) => semver.rcompare(a.version, b.version))[0] ?? null
}

/**
 * Where this plugin stands against the upgrade.
 *
 *   blocked    — TREK <newTrek> refuses it outright (install AND activation).
 *   undeclared — no range at all, which TREK reports as TREK_VERSION_UNKNOWN.
 *   narrow     — survives <newTrek> but its ceiling lands before <ceiling>, so the next
 *                minor or major repeats this whole exercise.
 *   ok         — covers the new line to the ceiling (or declares no ceiling at all).
 */
function classify(range) {
  if (!satisfiableRange(range)) return 'undeclared'
  if (!hostSatisfies(range, newTrek)) return 'blocked'
  const cap = trekCeiling(range)
  return cap && semver.lt(cap.version, ceiling) ? 'narrow' : 'ok'
}

const rows = []
for (const entry of entries) {
  const latest = latestVersion(entry)
  if (!latest) { console.warn(`skipped ${entry.id}: no valid published version`); continue }
  rows.push({
    id: entry.id,
    name: entry.name,
    repo: entry.repo,
    version: latest.version,
    range: latest.trek ?? null,
    status: classify(latest.trek),
  })
}
rows.sort((a, b) => a.id.localeCompare(b.id))

const affected = rows.filter((r) => r.status !== 'ok' && !(flags['only-blocked'] && r.status === 'narrow'))

// One issue per repo: a repo publishing two plugins gets one issue listing both.
const byRepo = new Map()
for (const r of affected) {
  if (!byRepo.has(r.repo)) byRepo.set(r.repo, [])
  byRepo.get(r.repo).push(r)
}

// --- issue text ----------------------------------------------------------------------

const VERDICT = {
  blocked: `**refused on TREK ${newTrek}**`,
  narrow: `works on ${newTrek}, stops before ${ceiling}`,
  undeclared: '**no range declared**',
}

function suggestedRange(pluginRows) {
  // Keep each author's own floor — widening the ceiling is the ask, lowering the floor is
  // a claim about old TREKs we have no business making on their behalf. Several plugins in
  // one repo collapse to the lowest floor among them, which is the only range that suits
  // them all; the per-plugin table above still shows what each one declares today.
  const floors = pluginRows.map((r) => (r.range ? trekFloor(r.range) : null)).filter(Boolean)
  const floor = floors.length ? floors.sort(semver.compare)[0] : currentTrek
  return `>=${floor} <${ceiling}`
}

function renderIssue(repo, pluginRows) {
  const undeclared = pluginRows.some((r) => r.status === 'undeclared')
  const worst = undeclared || pluginRows.some((r) => r.status === 'blocked') ? 'blocked' : 'narrow'
  const table = pluginRows
    .map((r) => `| \`${r.id}\` | ${r.version} | ${r.range ? `\`${r.range}\`` : '— none —'} | ${VERDICT[r.status]} |`)
    .join('\n')
  const eta = flags.eta ? `TREK ${newTrek} ships in ${flags.eta}` : `TREK ${newTrek} is on its way`
  const capText = pluginRows
    .map((r) => (r.range ? trekCeiling(r.range) : null))
    .filter(Boolean)
    .map((c) => c.version)
    .sort(semver.compare)[0] ?? ceiling
  const refusal = undeclared
    ? '`TREK_VERSION_UNKNOWN` (a version that declares no range is treated as supporting none)'
    : '`TREK_VERSION_INCOMPATIBLE`'
  const consequence = worst === 'blocked'
    ? `- a new install is refused with ${refusal};
- an **already-installed** plugin stays on disk but **refuses to activate** once the operator
  upgrades — it sits in the admin list switched off, showing the reason.

For this check TREK coerces prereleases to their target release (\`${newTrek}-rc.1\` compares as
\`${newTrek}\`), so this already bites on the release candidates — not only on the day the stable
image lands.`
    : `- your range admits ${newTrek} itself, so nothing breaks the day it ships;
- but it stops at ${capText}, and that release — whenever it lands — switches the plugin off on
  every instance that takes it, with nothing an admin can wave through.

Widening the ceiling now means not repeating this mid-cycle.`

  return `${marker}
Hi 👋 — maintainer note from the [TREK-Plugins registry](https://github.com/liketrek/TREK-Plugins).
This same issue is being opened on every plugin repo in the registry; there is nothing wrong
with your plugin's code.

**Your latest registry entr${pluginRows.length > 1 ? 'ies' : 'y'}**

| plugin | version | declared \`trek\` | on TREK ${newTrek} |
|---|---|---|---|
${table}

## What's happening

${eta}. TREK ${currentTrek} is what most instances run today.

Since TREK 3.4.0 the manifest's \`trek\` field is **load-bearing, not advisory** — enforced at
install *and* at activation, with **no admin override**:

${consequence}

## What we'd like you to do

1. **Test your plugin on TREK ${semver.major(newTrek)}.**

   \`\`\`bash
   docker pull ${image}:${testTag}
   \`\`\`

   Worth a pass over: your server hooks and jobs, any widget/page UI (including the mobile
   layout), and your declared permissions and egress hosts.

2. **Widen the range in \`trek-plugin.json\`**, keeping your existing floor:

   \`\`\`json
   "trek": "${suggestedRange(pluginRows)}"
   \`\`\`

   Please keep an **explicit ceiling** — an open-ended \`">=${trekFloor(pluginRows[0].range) ?? currentTrek}"\` or \`"*"\` claims
   every TREK ever released *and every one still to come*, which is why
   \`trek-plugin-sdk validate\` warns about it.

3. **Cut a new release and open the registry PR.** Bump \`version\` in the manifest, then:

   \`\`\`bash
   npm i -D trek-plugin-sdk@latest
   npx trek-plugin-sdk publish --repo ${repo} --tag v<new-version>
   \`\`\`

   That packs the artifact, creates the tagged GitHub release, runs the registry CI checks
   locally (preflight), and opens the PR. The entry's \`trek\` must equal the manifest's
   verbatim — \`publish\`/\`entry\` copy it across for you, so don't hand-edit it.

## If your plugin genuinely doesn't work on TREK ${semver.major(newTrek)}

Then don't widen — the range is your own statement about where the plugin runs, and a false
one is worse than a narrow one. Shipping a new major that requires TREK ${semver.major(newTrek)} doesn't strand
your ${semver.major(currentTrek)}.x users either: "install latest" resolves to the newest version *that host* can
run, and TREK refuses an update that would drag a working install out of compatibility.

## If you do nothing

${worst === 'blocked'
  ? `Nothing breaks for users still on ${semver.major(currentTrek)}.x. But the moment they upgrade to TREK ${newTrek} your
plugin switches itself off, and new installs on ${semver.major(newTrek)}.x are refused outright.`
  : `Nothing breaks on ${newTrek}. But TREK ${capText} switches the plugin off on every instance that
takes it, and new installs there are refused outright — so this issue comes back then.`}

Questions or problems on the release candidates → reply here, or open an issue on
[liketrek/TREK](https://github.com/liketrek/TREK/issues).
`
}

// --- report --------------------------------------------------------------------------

const width = Math.max(...rows.map((r) => r.id.length), 6)
console.log(`TREK ${currentTrek} → ${newTrek} (asking for a \`<${ceiling}\` ceiling)\n`)
for (const r of rows) {
  const mark = { blocked: '✗', undeclared: '✗', narrow: '!', ok: '✓' }[r.status]
  console.log(`${mark} ${r.id.padEnd(width)}  ${(r.range ?? '(none)').padEnd(18)} ${r.version.padEnd(8)} ${r.status.padEnd(10)} ${r.repo}`)
}
const counts = rows.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {})
console.log(`\n${rows.length} plugins: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}`)
console.log(`${byRepo.size} repo(s) to notify${flags['only-blocked'] ? ' (--only-blocked)' : ''}\n`)

if (flags.out) mkdirSync(flags.out, { recursive: true })
const issues = [...byRepo].map(([repo, pluginRows]) => ({ repo, body: renderIssue(repo, pluginRows) }))
for (const { repo, body } of issues) {
  if (flags.out) writeFileSync(path.join(flags.out, `${repo.replace('/', '__')}.md`), `# ${title}\n\n${body}`)
  if (flags.print) console.log(`\n${'='.repeat(78)}\n${repo}: ${title}\n${'='.repeat(78)}\n${body}`)
}
if (flags.out) console.log(`wrote ${issues.length} issue file(s) to ${flags.out}/`)

if (!issues.length) { console.log('nothing to do.'); process.exit(0) }

if (!flags.open) {
  console.log('dry run — nothing posted. Re-run with --open to create these issues, or --print / --out <dir> to read them first.')
  process.exit(0)
}

// --- post ----------------------------------------------------------------------------

const gh = (args) => execFileSync('gh', args, { encoding: 'utf8' })
try { gh(['auth', 'status']) } catch { die('`gh` is not installed or not authenticated (run `gh auth login`)') }

const scratch = mkdtempSync(path.join(tmpdir(), 'trek-notify-'))
let opened = 0, skipped = 0, failed = 0
for (const { repo, body } of issues) {
  try {
    if (!flags['allow-duplicate']) {
      // Match on the marker, not the title: a maintainer who renamed the issue still has one.
      const existing = JSON.parse(gh(['issue', 'list', '--repo', repo, '--state', 'all', '--limit', '200', '--json', 'number,url,body']))
      const dup = existing.find((i) => (i.body ?? '').includes(marker))
      if (dup) { console.log(`- ${repo}: already notified (${dup.url})`); skipped++; continue }
    }
    const bodyFile = path.join(scratch, `${repo.replace('/', '__')}.md`)
    writeFileSync(bodyFile, body)
    const out = gh(['issue', 'create', '--repo', repo, '--title', title, '--body-file', bodyFile,
      ...flags.label.flatMap((l) => ['--label', l])]).trim()
    console.log(`+ ${repo}: ${out.split('\n').pop()}`)
    opened++
  } catch (err) {
    // One repo with issues disabled, or a label that doesn't exist there, must not abort the run.
    console.error(`! ${repo}: ${(err.stderr || err.message).toString().trim().split('\n').pop()}`)
    failed++
  }
}
console.log(`\nopened ${opened}, skipped ${skipped}, failed ${failed}`)
process.exit(failed ? 1 : 0)
