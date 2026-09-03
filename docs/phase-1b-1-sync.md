# Phase 1B-1 sync contract

## Version and conflict rules

- A newly created workout uses `baseVersion = 0` and is stored as server version 1.
- Every `replace` or `complete` mutation records the server version the local
  queue expects immediately before that mutation.
- The server checks an already processed `mutation_id` before checking the
  version. An exact replay therefore returns the original successful result,
  even when the workout has advanced since the first response.
- An unprocessed mutation is applied only when `baseVersion` equals the current
  server version. A lower value is a stale conflict; a higher value is an
  inconsistent client state. Neither case changes the workout.
- A stale conflict remains in IndexedDB with the local snapshot and stops FIFO
  processing. Phase 1B-1c does not merge or discard either side.

The mutation payload remains a complete workout snapshot. Keeping the base
version and the immutable local payload together leaves room for a future
field- or set-level merge without changing the Phase 1B-1 queue contract.

## `processed_mutation` retention

Phase 1B-1c keeps processed mutations indefinitely. The current personal-use
volume is small, and retaining the rows preserves the strongest idempotency
guarantee for a device that is offline for an unexpectedly long time.

Deleting a processed row shortens the idempotency window. A very old `create`
would then return an entity conflict instead of its original success result;
an old `replace` or `complete` would be rejected by version checking, but the
exact replay response could no longer be reproduced.

Before adding cleanup, define a maximum client queue lifetime and keep full
processed results for longer than that lifetime. A safe later policy is:

1. retain full results for at least 180 days after `processed_at`;
2. only prune after the client queue has a documented maximum age;
3. optionally retain a smaller tombstone containing `mutation_id`, owner,
   fingerprint, entity, operation, base version, and final version for a longer
   period; and
4. never delete recent rows solely because the related workout completed.

No cleanup job is introduced in Phase 1B-1c.
