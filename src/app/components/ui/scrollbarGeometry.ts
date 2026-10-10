export function scrollbarGeometry(
  height: number,
  visible: number,
  history: number,
  offset: number,
) {
  const thumb = Math.min(height, Math.max(24, (height * visible) / Math.max(1, visible + history)));
  const travel = Math.max(0, height - thumb);
  const top = history > 0 ? travel * (1 - Math.min(history, Math.max(0, offset)) / history) : 0;
  return { thumb, travel, top };
}
export function scrollbarOffset(top: number, travel: number, history: number) {
  return travel > 0 ? Math.round((1 - Math.min(travel, Math.max(0, top)) / travel) * history) : 0;
}
