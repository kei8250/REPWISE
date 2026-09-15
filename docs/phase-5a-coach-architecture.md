# Phase 5A — Coach architecture boundary

`getCoachContext(db, now)` is a server-only, on-demand service, not a public
context endpoint. Existing screens do not import/call it. It shares the three
existing Analytics reads, calculates Analytics once with the existing engines,
and reads at most one active server workout. There is no cross-request cache.
The owner scope remains the existing owner-private `default` scope. Before any
future shared/multi-owner coach route, authenticated owner isolation is required.

## Facts, interpretation, proposals, actions

1. Existing Analytics/progression/PR/stagnation/accepted-target services own facts.
2. Provider-independent CoachContext is a bounded projection of those facts.
3. A future provider may explain, summarize, suggest or answer. It may not
   recalculate or contradict facts. User-controlled names/text are untrusted data,
   never system instructions. Raw notes and unrelated personal data are omitted.
4. ProposedAction is only a proposal with `executable: false` and mandatory user
   approval. It carries evidence and, for workout proposals, a base version.
5. A separate future action layer must validate user approval, current ownership,
   source versions and values, then use normal mutations/idempotency/claim/FIFO.
   Provider output must never be passed directly to sync or D1. No action layer,
   provider, LLM call, credential, prompt, chat route or UI exists in Phase 5A.

Policy metadata alone cannot guarantee LLM behavior. Phase 5B must implement
provider-output schema validation, fact/source consistency checks, request size
limits, prompt-injection defenses and privacy controls before connecting an LLM.

## Bounded context and data availability

Context defaults to 30-day Analytics; evaluations still use Analytics' existing
all-valid-history basis. Recent performance is at most 5 completed workouts,
12 exercises/workout, 8 valid completed working sets/exercise. Warmup, incomplete,
invalid actuals and deleted history are excluded with Analytics' own validator.
Recent workout detail is explicitly partial: not an exhaustive workout record.
Workouts without valid working actuals remain in frequency but not recent
performance. Exercise context is at most 12, each trend at most 6, PRs at most 3,
insights at most 8, evidence values at most 8; display text is at most 120 chars.
UTF-8 serialized payload budget is 64 KiB, with truncation metadata. Evaluations
are preserved, never recomputed from truncated data. Weight/e1RM are grams.

Each performance/trend/PR/evaluation source retains workout ID, date, version,
exercise-master ID and workout-exercise ID. Aggregate insights reference their
period rather than pretending a single workout is the complete source. Missing
history/trends, insufficient evaluations and stale target references are explicit.
Accepted target is included only if accepted, unused, valid, and its source
version matches current valid history. Stale target is review-only.

Active data is a partial *server snapshot*, not confirmed local UI state. It has
separate target and actual fields, and no progression evaluation. The service
cannot see unsynced IndexedDB/conflicted drafts. A future UI must disclose this
or supply separately labelled local context with user consent; never overwrite or
rebase drafts. Active read failure is `unavailable`, not `none`. Core Analytics
failure propagates; no dummy/empty facts replace a failed read.

History edits, delete and restore are reflected on the next request; derived
context is not persisted. No DB migration or public Context API is introduced.
