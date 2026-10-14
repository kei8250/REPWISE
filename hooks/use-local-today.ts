'use client';

import { useSyncExternalStore } from 'react';
import { localDateKey } from '@/lib/workouts/history';

const subscribe = () => () => {};
const getSnapshot = () => localDateKey(new Date());
const getServerSnapshot = () => '';

// Use the browser's date after hydration, rather than the server's timezone.
export function useLocalToday() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
