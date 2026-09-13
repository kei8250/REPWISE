import { getD1 } from '@/db';
import { getAnalyticsSnapshot } from '@/lib/analytics/server-store';
import { ANALYTICS_RANGES, type AnalyticsRange } from '@/lib/analytics/model';
import { apiError } from '@/lib/workouts/api-route';

function isAnalyticsRange(value: string): value is AnalyticsRange {
  return (ANALYTICS_RANGES as readonly string[]).includes(value);
}

export async function GET(request: Request) {
  try {
    const value = new URL(request.url).searchParams.get('range') ?? '30d';
    if (!isAnalyticsRange(value)) {
      return Response.json(
        { error: '期間は7d、30d、90d、allのいずれかを指定してください' },
        { status: 400 },
      );
    }
    return Response.json(await getAnalyticsSnapshot(getD1(), value), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return apiError(error);
  }
}
