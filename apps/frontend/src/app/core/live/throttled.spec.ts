import { throttled } from './throttled';

describe('throttled', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs at once when quiet', () => {
    const run = vi.fn();
    throttled(1000, run).trigger();
    expect(run).toHaveBeenCalledOnce();
  });

  it('runs once more at the end of the window however often it was triggered', () => {
    const run = vi.fn();
    const t = throttled(1000, run);
    t.trigger();
    t.trigger();
    t.trigger();
    expect(run).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(999);
    expect(run).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(5000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('runs at once again after a quiet window', () => {
    const run = vi.fn();
    const t = throttled(1000, run);
    t.trigger();
    vi.advanceTimersByTime(1000);
    t.trigger();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('drops what is due on dispose', () => {
    const run = vi.fn();
    const t = throttled(1000, run);
    t.trigger();
    t.trigger();
    t.dispose();
    vi.advanceTimersByTime(5000);
    expect(run).toHaveBeenCalledOnce();
  });
});
