import { loadBasisHelp, type LoadBasis } from '@/lib/workouts/reps';

export function LoadBasisSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value?: LoadBasis;
  onChange: (value: LoadBasis) => void;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-bold">
        重量の入力基準
      </label>
      <select
        id={id}
        value={value ?? 'per_rep'}
        onChange={(event) =>
          onChange(
            event.target.value === 'paired_total' ? 'paired_total' : 'per_rep',
          )
        }
        className="min-h-11 w-full rounded-lg border bg-background px-3 text-base"
      >
        <option value="per_rep">片側1回で扱う重量（片手種目は片手分）</option>
        <option value="paired_total">左右の重量の合計（片側は半分）</option>
      </select>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {loadBasisHelp(value)}
      </p>
    </div>
  );
}
