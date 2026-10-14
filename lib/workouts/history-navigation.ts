import { isLocalDate, localDateKey } from './history';

export function monthBounds(month: string) {
  if (!isLocalDate(`${month}-01`))
    throw new Error('月の指定が正しくありません');
  const start = new Date(`${month}-01T12:00:00`);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  return { from: `${month}-01`, to: localDateKey(end) };
}

export function adjacentMonth(month: string, offset: number) {
  monthBounds(month);
  const date = new Date(`${month}-01T12:00:00`);
  return localDateKey(
    new Date(date.getFullYear(), date.getMonth() + offset, 1),
  ).slice(0, 7);
}
