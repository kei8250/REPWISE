export function GoalProgressBar({
  label,
  value,
  percent,
}: {
  label: string;
  value: number;
  percent: number | null;
}) {
  return (
    <div className="mt-2">
      <div className="relative">
        <progress
          aria-label={label}
          aria-valuetext={
            percent === null ? '換算データなし' : `${percent}%（RM換算）`
          }
          value={value}
          max={100}
          className="block h-3 w-full overflow-hidden rounded-full border border-slate-300 bg-slate-200 accent-emerald-800 [&::-webkit-progress-bar]:bg-slate-200 [&::-webkit-progress-value]:bg-emerald-800 [&::-moz-progress-bar]:bg-emerald-800"
        />
        <span
          aria-hidden="true"
          className="absolute right-0 top-0 h-3 border-r-2 border-slate-600"
        />
      </div>
      <div
        aria-hidden="true"
        className="mt-1 flex justify-between text-[11px] text-muted-foreground"
      >
        <span>0%</span>
        <span>目標 100%</span>
      </div>
    </div>
  );
}
