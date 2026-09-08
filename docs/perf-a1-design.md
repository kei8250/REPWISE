# Performance A1 — verification environment only

Scope: fonts, exercise master cache, and static delivery safety. No API, D1,
workout queue, routing, Home/Active loading, or Phase 3 changes.

## Static assets

The installed Vinext build already emits `dist/client/_headers` with immutable
cache headers for `/_next/static/*`. The v17 Sites HTTP responses nevertheless
use `public, max-age=0, must-revalidate`. Do not add a speculative Worker route,
Service Worker, or cache user responses to override the hosting layer.
Long-lived caching remains deferred unless verified on the actual Sites origin.

`retained-assets/v17` holds the entire existing static dependency graph. The
normal build script validates SHA-256 and merges it into the new client output.
Different bytes at the same URL fail the build. Vinext prohibits `public/_next`,
so retention happens after the framework build instead of under `public`.
The packaging helper includes this output. Neither these frozen assets nor the
current HTML/API acquire a new caching policy. There is no automatic pruning.
Before the next deployment, archive that deployment's current hashed dependency
graph as well; this v17 snapshot is not automatic retention for future versions.
Do not assume that retaining assets fixes the old font URLs inside old HTML.

## Fonts

The cached Google Fonts CSS contained a previous checkout's Windows absolute
path. Vinext rewrites only the current cache directory prefix and injected the
unmatched paths into SSR style output. Noto Sans JP now uses checked-in,
unmodified WOFF2 files and relative CSS URLs, processed by Vite's ordinary
external CSS/hashed asset pipeline. All 124 Unicode ranges and the adjusted
fallback face remain (125 faces total); no Japanese subset is removed.
The font license is in `public/licenses/NotoSansJP-OFL.txt`.
The vendor script is a one-time extraction aid, not a build dependency.

## Exercise master

The existing IndexedDB `exerciseMasterCache` store remains in database version 3.
The `all` record retains `exercises` and `updatedAt`, adding optional `revision`
(legacy records default to zero). Freshness lasts 15 minutes from GET start.
Fresh cache, including an empty successful catalog, causes no mandatory GET.
Stale cache is delivered immediately; a shared in-document GET refreshes it in
the background and survives picker close. Errors do not extend freshness.
Same-document requests are shared; separate tabs may each refresh a stale cache.

Successful custom creation invalidates and upserts the returned master. Future
edit/archive paths must call `invalidateExerciseMasters` after server success.
Generation and atomic IDB revision checks reject refresh responses started before
invalidation. No workout transaction/store/mutation format is changed. Existing
server exercise-existence validation remains authoritative.

## Measurement interpretation

HTTPS probes compare response sizes, headers, conditional requests, and TTFB;
they use the verification owner's ephemeral authorization, not browser cookies.
Browser timings include automation overhead and observe rendered controls; they
are not INP, hydration, LCP, or a physical iPhone benchmark. The user's iPhone SE2
Chrome/Wi-Fi must be checked separately before declaring a device-level win.
