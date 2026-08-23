// The TREK host-version range a plugin declares in its manifest's `trek` field.
//
// TREK gates installs AND activation on this range, so what the registry accepts has to be
// exactly what the server accepts. These two helpers mirror TREK's own host-compat module
// (server/src/nest/plugins/install/host-compat.ts) — keep them in step.

import semver from 'semver'

/**
 * Whether `r` is a range a plugin may declare.
 *
 * `semver.validRange()` alone is not enough: ">=4.0.0 <3.0.0" is a VALID range that no
 * version can ever satisfy, so a plugin declaring it would be uninstallable on every
 * instance with nothing to tell its author why. `minVersion()` returns null for exactly
 * that case — and throws outright on junk like "latest" — so it is the real test.
 */
export function satisfiableRange(r) {
  if (typeof r !== 'string' || !r.trim()) return false
  if (semver.validRange(r) === null) return false
  try {
    return semver.minVersion(r) !== null
  } catch {
    return false
  }
}

/**
 * The lowest TREK a range admits — what an entry publishes as `minTrekVersion`.
 *
 * Read off the range with semver rather than by finding the first version-shaped substring
 * in it: for "<4.0.0" that substring is 4.0.0, which is the range's UPPER bound, and
 * publishing it as the minimum states the exact inverse of what the plugin supports.
 */
export function trekFloor(r) {
  return satisfiableRange(r) ? semver.minVersion(r).version : null
}

/**
 * Whether a host running TREK `host` satisfies `r` — the same answer TREK's own gate gives.
 *
 * Prereleases are COERCED to their target release (4.0.0-pre.2 counts as 4.0.0), exactly as
 * host-compat.ts does, and for the same two reasons: plain satisfies() would fail every
 * plugin the moment TREK shipped an rc, while includePrerelease would let a plugin that
 * disclaims TREK 4 load on 4.0.0-rc.1, which already carries TREK 4's breaking changes.
 */
export function hostSatisfies(r, host) {
  const release = semver.coerce(host)?.version ?? null
  if (release === null) return true // unversioned build — TREK never blocks one
  if (!satisfiableRange(r)) return false
  return semver.satisfies(release, r)
}

/**
 * The highest TREK a range admits, as `{ version, inclusive }` — or null when the range has
 * no ceiling at all (`*`, `">=3.4.0"`).
 *
 * Read off the comparators rather than by string-matching a `<x.y.z` in the range, so that
 * `"1.x || >=2.5.0 <5.0.0"` answers 5.0.0 and a pinned `"=4.2.0"` answers 4.2.0. Within an
 * AND-set the binding cap is the LOWEST bound; across OR-sets it is the HIGHEST. One
 * uncapped branch leaves the whole range uncapped.
 */
export function trekCeiling(r) {
  if (!satisfiableRange(r)) return null
  let highest = null
  for (const set of new semver.Range(r).set) {
    let cap = null
    for (const c of set) {
      if (c.value === '') continue // the ANY comparator of `*` — no bound
      const bound =
        c.operator === '<' ? { version: c.semver.version, inclusive: false }
        : c.operator === '<=' || c.operator === '' || c.operator === '=' ? { version: c.semver.version, inclusive: true }
        : null
      if (!bound) continue
      if (!cap || semver.lt(bound.version, cap.version) || (semver.eq(bound.version, cap.version) && !bound.inclusive)) cap = bound
    }
    if (!cap) return null
    if (!highest || semver.gt(cap.version, highest.version) || (semver.eq(cap.version, highest.version) && cap.inclusive)) highest = cap
  }
  return highest
}
