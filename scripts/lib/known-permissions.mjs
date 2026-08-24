// GENERATED — do not edit by hand.
// Source: shared/src/plugin-permissions.ts (PLUGIN_PERMISSIONS, 63 ids) in
// https://github.com/liketrek/TREK — the flat permission id list a plugin
// manifest's `permissions[]` is checked against at install time.
// Regenerate: node scripts/gen-known-permissions.mjs
//
// HTTP_OUTBOUND_PREFIX and HOST_RE are ported from
// server/src/nest/plugins/install/manifest.ts:138 (HOST_RE) — the regex that
// gates a scoped `http:outbound:<host>` permission. HOST_RE MUST stay
// behaviourally identical: CI is the gate that decides whether an entry is
// publishable, and TREK is the gate that decides whether it installs. If CI
// accepts a scoped permission TREK would refuse (or vice versa), an entry
// merges here that either bricks the install or blocks a legitimate one.
export const KNOWN_PERMISSIONS = new Set([
  'db:own',
  'db:read:trips',
  'db:read:users',
  'db:read:costs',
  'db:read:packing',
  'db:write:packing',
  'db:read:files',
  'db:read:files:content',
  'db:write:files',
  'db:read:collab',
  'db:write:collab',
  'db:write:members',
  'db:create:trips',
  'db:read:journal',
  'db:read:atlas',
  'rates:read',
  'db:read:vacay',
  'db:read:daynotes',
  'db:read:collections',
  'db:write:collections',
  'db:write:atlas',
  'db:write:vacay',
  'db:write:journal',
  'db:read:categories',
  'db:read:tags',
  'db:write:tags',
  'db:read:todos',
  'db:write:todos',
  'weather:read',
  'db:write:daynotes',
  'db:write:costs',
  'db:write:places',
  'db:write:days',
  'db:write:itinerary',
  'db:write:trips',
  'db:write:reservations',
  'db:write:accommodations',
  'db:meta',
  'ws:broadcast:trip',
  'ws:broadcast:user',
  'hook:photo-provider',
  'hook:calendar-source',
  'hook:place-detail-provider',
  'hook:trip-warning-provider',
  'hook:table-contributor',
  'hook:map-marker-provider',
  'hook:map-layer-provider',
  'hook:route-provider',
  'hook:day-schedule-provider',
  'hook:day-tint-provider',
  'hook:pdf-section-provider',
  'hook:atlas-layer-provider',
  'hook:journal-entry-provider',
  'hook:trip-card-provider',
  'hook:notification-channel',
  'hook:user-data',
  'events:subscribe',
  'jobs:run',
  'http:outbound',
  'notify:send',
  'ai:invoke',
  'oauth:client',
  'geolocation:read',
]);

export const HTTP_OUTBOUND_PREFIX = 'http:outbound:';

// Verbatim from server/src/nest/plugins/install/manifest.ts:138.
export const HOST_RE = /^(\*\.[a-z0-9-]+(\.[a-z0-9-]+)+|[a-z0-9-]+(\.[a-z0-9-]+)*)$/i;
