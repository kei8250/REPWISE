import type { AnalyticsRange, AnalyticsSnapshot } from './model';
import { getAnalytics } from '@/lib/workouts/api-client';

export const ANALYTICS_DETAIL_TTL_MS = 30_000;

type Dependencies = {
  fetch: (range: AnalyticsRange) => Promise<AnalyticsSnapshot>;
  now: () => number;
};

export function createAnalyticsDetailCache(dependencies: Dependencies) {
  const cached = new Map<
    AnalyticsRange,
    { value: AnalyticsSnapshot; savedAt: number }
  >();
  const inFlight = new Map<AnalyticsRange, Promise<AnalyticsSnapshot>>();

  async function load(range: AnalyticsRange, force = false) {
    const hit = cached.get(range);
    if (
      !force &&
      hit &&
      dependencies.now() - hit.savedAt < ANALYTICS_DETAIL_TTL_MS
    ) {
      return structuredClone(hit.value);
    }

    let request = inFlight.get(range);
    if (!request) {
      request = dependencies.fetch(range).then((value) => {
        cached.set(range, {
          value: structuredClone(value),
          savedAt: dependencies.now(),
        });
        return value;
      });
      inFlight.set(range, request);
      void request
        .finally(() => {
          if (inFlight.get(range) === request) inFlight.delete(range);
        })
        .catch(() => undefined);
    }
    return structuredClone(await request);
  }

  function invalidate(range?: AnalyticsRange) {
    if (range) cached.delete(range);
    else cached.clear();
  }

  return { load, invalidate };
}

const cache = createAnalyticsDetailCache({
  fetch: getAnalytics,
  now: Date.now,
});

export const loadAnalyticsDetail = cache.load;
export const invalidateAnalyticsDetail = cache.invalidate;
