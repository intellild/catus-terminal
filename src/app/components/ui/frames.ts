// Lynx UI Presence uses BTS lynx.requestAnimationFrame, whose callbacks stall in
// the current Lynxtron runtime. Its delayFrames module is replaced by this
// adapter; the application's existing MTS RAF drives one step per actual frame.
const callbacks = new Set<() => void>();

export function delayFrames(frames: number, callback: () => void): void {
  let remaining = frames;
  const tick = () => {
    if (--remaining <= 0) callback();
    else callbacks.add(tick);
  };
  callbacks.add(tick);
}

export function dispatchUIFrames(): void {
  'background only';
  const current = Array.from(callbacks);
  callbacks.clear();
  for (const callback of current) callback();
}
