import {
  buildHomeAnalyticsSummary,
  type HomeAnalyticsSummary,
} from './home-summary';
import { getAnalytics } from '@/lib/workouts/api-client';

export const HOME_ANALYTICS_TTL_MS = 30_000;

type Dependencies = {
  fetch: () => Promise<HomeAnalyticsSummary>;
  now: () => number;
};

export function createHomeAnalyticsCache(dependencies: Dependencies) {
  let cached: { value: HomeAnalyticsSummary; savedAt: number } | null = null;
  let inFlight: Promise<HomeAnalyticsSummary> | null = null;

  async function load(force = false) {
    if (
      !force &&
      cached &&
      dependencies.now() - cached.savedAt < HOME_ANALYTICS_TTL_MS
    ) {
      return structuredClone(cached.value);
    }
    if (!inFlight) {
      const request = dependencies.fetch().then((value) => {
        cached = { value: structuredClone(value), savedAt: dependencies.now() };
        return value;
      });
      inFlight = request;
      void request
        .finally(() => {
          if (inFlight === request) inFlight = null;
        })
        .catch(() => undefined);
    }
    return structuredClone(await inFlight);
  }

  function invalidate() {
    cached = null;
  }

  return { load, invalidate };
}

const cache = createHomeAnalyticsCache({
  fetch: async () => buildHomeAnalyticsSummary(await getAnalytics('30d')),
  now: Date.now,
});

export const loadHomeAnalyticsSummary = cache.load;
export const invalidateHomeAnalyticsSummary = cache.invalidate;
