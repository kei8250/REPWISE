'use client';

import { useState, useSyncExternalStore } from 'react';
import { FlaskConical, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

const REVIEW_HOST = 'repwise-phase1a-review.keikei8250.chatgpt.site';
const subscribeToReviewLocation = () => () => undefined;

function isReviewConflictTest() {
  return (
    window.location.hostname === REVIEW_HOST &&
    new URLSearchParams(window.location.search).has('repwise-conflict-test')
  );
}

export function ReviewConflictControl({ workoutId }: { workoutId: string }) {
  const enabled = useSyncExternalStore(
    subscribeToReviewLocation,
    isReviewConflictTest,
    () => false,
  );
  const [loading, setLoading] = useState(false);
  const [serverVersion, setServerVersion] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!enabled) return null;

  return (
    <div className="rounded-2xl border border-dashed bg-muted/40 p-3 text-xs">
      <p className="font-black">検証環境専用：競合テスト</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading || serverVersion !== null}
          onClick={() => {
            setLoading(true);
            setError(null);
            void fetch('/api/v2/review/advance-version', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ workoutId }),
            })
              .then(async (response) => {
                const body = (await response.json()) as {
                  error?: string;
                  serverVersion?: number;
                };
                if (!response.ok || typeof body.serverVersion !== 'number') {
                  throw new Error(body.error ?? '競合テストを開始できません');
                }
                setServerVersion(body.serverVersion);
              })
              .catch((cause) =>
                setError(
                  cause instanceof Error
                    ? cause.message
                    : '競合テストを開始できません',
                ),
              )
              .finally(() => setLoading(false));
          }}
        >
          {loading ? (
            <LoaderCircle className="animate-spin" />
          ) : (
            <FlaskConical />
          )}
          サーバーversionを先に進める
        </Button>
        {serverVersion !== null && (
          <span className="font-bold text-amber-800">
            サーバー側をv{serverVersion}へ更新しました
          </span>
        )}
      </div>
      {error && <p className="mt-2 font-bold text-destructive">{error}</p>}
    </div>
  );
}
