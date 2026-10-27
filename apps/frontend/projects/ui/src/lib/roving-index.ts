/**
 * The index the arrow keys, Home or End move to in a row of `count` items (chips, segments),
 * wrapping around; `undefined` for any other key, which stays with the page. Left and Right swap
 * in right-to-left writing; with `vertical`, Up and Down move as well (a radio group).
 */
export function nextIndex(
  key: string,
  index: number,
  count: number,
  rtl: boolean,
  vertical = false,
): number | undefined {
  const step = (delta: number) => (index + delta + count) % count;
  switch (key) {
    case 'ArrowRight':
      return step(rtl ? -1 : 1);
    case 'ArrowLeft':
      return step(rtl ? 1 : -1);
    case 'ArrowDown':
      return vertical ? step(1) : undefined;
    case 'ArrowUp':
      return vertical ? step(-1) : undefined;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return undefined;
  }
}
