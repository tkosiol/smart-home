/** Runs `run` now when quiet, else once at the end of the window; `dispose` drops what is due. */
export function throttled(windowMs: number, run: () => void): { trigger(): void; dispose(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending = false;
  const fire = () => {
    timer = setTimeout(() => {
      timer = undefined;
      if (pending) {
        pending = false;
        fire();
      }
    }, windowMs);
    run();
  };
  return {
    trigger() {
      if (timer === undefined) fire();
      else pending = true;
    },
    dispose() {
      clearTimeout(timer);
      timer = undefined;
      pending = false;
    },
  };
}
