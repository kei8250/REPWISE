import { createExerciseMaster, listExerciseMasters, updateExerciseMaster } from './api-client';
import {
  getExerciseMasterCacheRecord,
  invalidateExerciseMasterCacheRecord,
  updateExerciseMasterCache,
  type ExerciseMasterCacheRecord,
} from './local-drafts';
import type { CreateExerciseMasterInput, ExerciseMaster } from './types';
import type { UpdateExerciseMasterInput } from './types';

export const EXERCISE_MASTER_TTL_MS = 15 * 60 * 1000;

type Dependencies = {
  read: () => Promise<ExerciseMasterCacheRecord | null>;
  write: (
    items: ExerciseMaster[],
    revision: number,
    startedAt: string,
  ) => Promise<boolean>;
  invalidate: (changed?: ExerciseMaster) => Promise<void>;
  fetch: () => Promise<ExerciseMaster[]>;
  now: () => number;
};

export function createExerciseMasterCache(deps: Dependencies) {
  let inFlight: Promise<ExerciseMaster[]> | null = null;
  let generation = 0;
  let forceRefresh = false;

  async function load(onCached?: (items: ExerciseMaster[]) => void) {
    const cached = await deps.read().catch(() => null);
    if (cached) onCached?.(structuredClone(cached.exercises));
    const age = deps.now() - Date.parse(cached?.updatedAt ?? '');
    if (!forceRefresh && cached && age >= 0 && age < EXERCISE_MASTER_TTL_MS) {
      return structuredClone(cached.exercises);
    }
    if (!inFlight) {
      const startedAt = new Date(deps.now()).toISOString();
      const requestGeneration = generation;
      const request = (async () => {
        const items = await deps.fetch();
        // Invalidation during an in-flight GET must not resurrect stale items.
        if (generation !== requestGeneration)
          return (await deps.read())?.exercises ?? [];
        const accepted = await deps
          .write(items, cached?.revision ?? 0, startedAt)
          .catch(() => null);
        if (accepted === null) {
          forceRefresh = true;
          return items;
        }
        if (!accepted) return (await deps.read())?.exercises ?? [];
        forceRefresh = false;
        return items;
      })();
      inFlight = request;
      // Do not abort on picker close: the result still warms IndexedDB.
      void request
        .finally(() => {
          if (inFlight === request) inFlight = null;
        })
        .catch(() => undefined);
    }
    try {
      return structuredClone(await inFlight);
    } catch (error) {
      // A stale catalog remains selectable offline; the server still validates
      // exercise existence on save. Fail visibly only with no cached catalog.
      if (cached) return structuredClone(cached.exercises);
      throw error;
    }
  }

  async function invalidate(changed?: ExerciseMaster) {
    generation++;
    forceRefresh = true;
    await deps.invalidate(changed);
  }
  return { load, invalidate };
}

const cache = createExerciseMasterCache({
  read: getExerciseMasterCacheRecord,
  write: updateExerciseMasterCache,
  invalidate: invalidateExerciseMasterCacheRecord,
  fetch: listExerciseMasters,
  now: Date.now,
});

export const loadExerciseMasters = cache.load;
// Future edit/archive paths must call this after successful server mutation.
export const invalidateExerciseMasters = cache.invalidate;

export async function createCachedExerciseMaster(
  input: CreateExerciseMasterInput,
) {
  const created = await createExerciseMaster(input);
  // Server creation already succeeded: cache trouble must not suggest retrying
  // the POST. forceRefresh stays set even if IndexedDB is unavailable.
  await invalidateExerciseMasters(created).catch(() => undefined);
  return created;
}

export async function updateCachedExerciseMaster(id: string, input: UpdateExerciseMasterInput) {
  const updated = await updateExerciseMaster(id, input);
  await invalidateExerciseMasters(updated).catch(() => undefined);
  return updated;
}
