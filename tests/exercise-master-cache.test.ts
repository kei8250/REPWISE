import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import {
  createExerciseMasterCache,
  EXERCISE_MASTER_TTL_MS,
} from '@/lib/workouts/exercise-master-cache';
import {
  getExerciseMasterCacheRecord,
  updateExerciseMasterCache,
  invalidateExerciseMasterCacheRecord,
} from '@/lib/workouts/local-drafts';
import type { ExerciseMaster } from '@/lib/workouts/types';

const bench: ExerciseMaster = {
  id: 'bench',
  name: 'ベンチプレス',
  normalizedName: 'ベンチプレス',
  bodyPart: '胸',
  measurementType: 'weight_reps',
  defaultRepMin: 8,
  defaultRepMax: 12,
  defaultWorkingSets: 3,
  defaultIncrementGrams: 2500,
  defaultRestSeconds: 90,
};
const added = { ...bench, id: 'custom', name: '計測専用種目' };

function setup() {
  const db = `master-cache-${crypto.randomUUID()}`;
  let clock = Date.now();
  const fetch = vi.fn(async () => [bench]);
  const dependencies = {
    read: () => getExerciseMasterCacheRecord(db),
    write: (items: ExerciseMaster[], revision: number, started: string) =>
      updateExerciseMasterCache(items, revision, started, db),
    invalidate: (changed?: ExerciseMaster) =>
      invalidateExerciseMasterCacheRecord(changed, db),
    fetch,
    now: () => clock,
  };
  return {
    cache: createExerciseMasterCache(dependencies),
    dependencies,
    fetch,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('exercise master TTL cache (isolated from workout synchronization)', () => {
  it('cold load fetches once; repeated opens within TTL do not issue GET', async () => {
    const { cache, fetch } = setup();
    for (let i = 0; i < 5; i++) expect(await cache.load()).toEqual([bench]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('fresh IndexedDB cache survives a new document/service instance', async () => {
    const { cache, dependencies, fetch } = setup();
    await cache.load();
    expect(await createExerciseMasterCache(dependencies).load()).toEqual([
      bench,
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('shows stale cache before the background GET finishes', async () => {
    const { cache, fetch, advance } = setup();
    await cache.load();
    advance(EXERCISE_MASTER_TTL_MS);
    let resolve!: (items: ExerciseMaster[]) => void;
    fetch.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const onCached = vi.fn();
    const pending = cache.load(onCached);
    await vi.waitFor(() => expect(onCached).toHaveBeenCalledWith([bench]));
    await vi.waitFor(() => expect(resolve).toBeDefined());
    resolve([bench, added]);
    expect(await pending).toEqual([bench, added]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('shares a concurrent GET and returns independent arrays', async () => {
    const { cache, fetch } = setup();
    let resolve!: (items: ExerciseMaster[]) => void;
    fetch.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const requests = [cache.load(), cache.load(), cache.load()];
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    resolve([bench]);
    const values = await Promise.all(requests);
    values[0][0].name = 'changed by consumer';
    expect(values[1][0].name).toBe(bench.name);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('offline refresh keeps the stale catalog and never extends its TTL', async () => {
    const { cache, dependencies, fetch, advance } = setup();
    await cache.load();
    const before = await dependencies.read();
    advance(EXERCISE_MASTER_TTL_MS + 1);
    fetch.mockRejectedValueOnce(new Error('offline'));
    expect(await cache.load()).toEqual([bench]);
    expect(await dependencies.read()).toEqual(before);
    await cache.load();
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('surfaces network failure when no catalog exists', async () => {
    const { cache, fetch } = setup();
    fetch.mockRejectedValueOnce(new Error('offline'));
    await expect(cache.load()).rejects.toThrow('offline');
    expect(await cache.load()).toEqual([bench]);
  });
  it('an empty successful catalog is a fresh cache, not a cache miss', async () => {
    const { cache, fetch } = setup();
    fetch.mockResolvedValue([]);
    expect(await cache.load()).toEqual([]);
    expect(await cache.load()).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('successful create/change invalidates fresh cache and retains changed item', async () => {
    const { cache, dependencies, fetch } = setup();
    await cache.load();
    await cache.invalidate(added);
    expect((await dependencies.read())?.exercises).toEqual([bench, added]);
    fetch.mockResolvedValue([bench, added]);
    expect(await cache.load()).toEqual([bench, added]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('in-flight stale GET cannot overwrite a newly created item', async () => {
    const { cache, dependencies, fetch, advance } = setup();
    await cache.load();
    advance(EXERCISE_MASTER_TTL_MS);
    let resolve!: (items: ExerciseMaster[]) => void;
    fetch.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const pending = cache.load();
    await vi.waitFor(() => expect(resolve).toBeDefined());
    await cache.invalidate(added);
    resolve([bench]);
    expect(await pending).toEqual([bench, added]);
    expect((await dependencies.read())?.exercises).toEqual([bench, added]);
  });
  it('another tab invalidation rejects the older GET atomically', async () => {
    const { dependencies } = setup();
    const started = new Date().toISOString();
    await dependencies.invalidate(added);
    expect(await dependencies.write([bench], 0, started)).toBe(false);
    expect((await dependencies.read())?.exercises).toEqual([added]);
  });
  it('does not replace newer refresh results with an older response', async () => {
    const { dependencies } = setup();
    await dependencies.write(
      [bench, added],
      0,
      new Date(Date.now() + 100).toISOString(),
    );
    expect(
      await dependencies.write(
        [bench],
        0,
        new Date(Date.now() - 100).toISOString(),
      ),
    ).toBe(false);
  });
  it('IndexedDB failure does not prevent online master loading', async () => {
    const { dependencies } = setup();
    const cache = createExerciseMasterCache({
      ...dependencies,
      read: async () => {
        throw new Error('IDB unavailable');
      },
      write: async () => {
        throw new Error('IDB unavailable');
      },
    });
    expect(await cache.load()).toEqual([bench]);
  });
});
