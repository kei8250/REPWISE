# Phase 1B-2a completed workout changes

## Editing and deletion contract

- Completed workout edits use the existing snapshot sync endpoint with an
  `edit` mutation. The snapshot carries the version seen when editing began.
- Deletion is a soft delete: a `delete` mutation sets `workout.deleted_at` and
  increments the workout version without deleting exercises or sets.
- A `restore` mutation clears `deleted_at` and increments the version. It only
  applies to an already soft-deleted, completed workout.
- Exact `mutation_id` replays are answered from `processed_mutation` before
  version or deleted-state checks, so edit, delete, and restore are idempotent.
- Normal workout reads and history queries continue to require
  `deleted_at IS NULL`. The sync handler alone can load a deleted record in
  order to validate and apply restore.

## Local draft separation

The existing IndexedDB `workoutDrafts` store uses distinct discriminator
values: `active`, `completed`, `completed_edit`, and `deleted`. An unfinished
completed-workout edit can therefore survive reload without being offered as
an active workout. Edit, delete, and restore mutations remain in the same FIFO
`workoutMutationQueue` and use its existing conflict protection.

## Future recalculation hook

Phase 1B-2a intentionally does not calculate PR, estimated 1RM, volume trends,
progression, targets, analytics, or AI outputs. The durable processed mutation
row already records `entity_id`, operation (`edit`, `delete`, or `restore`),
base version, result snapshot, and processing time. A later phase can add an
outbox/invalidation statement to the same D1 batch, keyed by mutation ID and
result version, then rebuild derived data asynchronously without changing this
write contract or inventing placeholder calculations now.

No physical purge or trash screen is introduced in this phase. A future trash
view may use an owner-scoped deleted-workout query; permanent deletion must be
a separate, explicitly confirmed operation with a retention policy.
