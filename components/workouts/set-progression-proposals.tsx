import { Button } from '@/components/ui/button';
import type { SetProgressionDecision } from '@/lib/progression/engine';
import { setRoleLabel, repsLabel } from '@/lib/workouts/reps';

export function SetProgressionProposals({
  items,
  onAdopt,
}: {
  items?: SetProgressionDecision[];
  onAdopt?: () => void;
}) {
  if (!items?.length) return null;
  return (
    <div className="mt-3 space-y-2 rounded-xl border p-3">
      <p className="text-sm font-bold">セット別の次回提案（未確定）</p>
      <ul className="space-y-2 text-xs leading-relaxed">
        {items.map((set) => (
          <li key={set.position}>
            <p className="font-bold">
              SET {set.position + 1} · {setRoleLabel(set.role)}：
            {set.currentLoadGrams / 1000}kg × {repsLabel(set)}
            </p>
            <p>
              → {set.targetLoadGrams / 1000}kg · {set.targetRepMin}〜
              {set.targetRepMax}回
            </p>
            <p className="text-muted-foreground">
              {set.increase
                ? `上限${set.targetRepMax}回を達成したため、このセットだけ増量`
                : `同じ重量で上限${set.targetRepMax}回を目指す`}
              。フォームは前回と今回のメモで確認してください。
            </p>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        有効な完了セットのみを判定し、未実施・未完了は含めません。種目の増量幅と各セットの保存済み回数範囲を使用します。全セットを一律の重量にはしません。
      </p>
      {onAdopt && (
        <Button
          type="button"
          variant="outline"
          className="min-h-11 w-full whitespace-normal"
          onClick={onAdopt}
        >
          セット別提案を今回の目標へ採用
        </Button>
      )}
    </div>
  );
}
