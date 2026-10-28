import { Coalescer } from './coalescer.js';

describe('Coalescer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs at once when the key is quiet', () => {
    const coalescer = new Coalescer(1000, vi.fn());
    const run = vi.fn(() => Promise.resolve());
    coalescer.schedule('a', run);
    expect(run).toHaveBeenCalledTimes(1);
    coalescer.dispose();
  });

  it('runs the latest of several calls once at the end of the window', async () => {
    const coalescer = new Coalescer(1000, vi.fn());
    const first = vi.fn(() => Promise.resolve());
    const second = vi.fn(() => Promise.resolve());
    const third = vi.fn(() => Promise.resolve());
    coalescer.schedule('a', first);
    coalescer.schedule('a', second);
    coalescer.schedule('a', third);
    await vi.advanceTimersByTimeAsync(999);
    expect(second).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(third).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(third).toHaveBeenCalledTimes(1);
    coalescer.dispose();
  });

  it('keeps keys apart and runs again immediately once a window passed quietly', async () => {
    const coalescer = new Coalescer(1000, vi.fn());
    const a = vi.fn(() => Promise.resolve());
    const b = vi.fn(() => Promise.resolve());
    coalescer.schedule('a', a);
    coalescer.schedule('b', b);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    coalescer.schedule('a', a);
    expect(a).toHaveBeenCalledTimes(2);
    coalescer.dispose();
  });

  it('reports a failing run and keeps the window going', async () => {
    const onError = vi.fn();
    const coalescer = new Coalescer(1000, onError);
    const boom = new Error('boom');
    coalescer.schedule('a', () => Promise.reject(boom));
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledWith(boom);
    const later = vi.fn(() => Promise.resolve());
    coalescer.schedule('a', later);
    expect(later).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(later).toHaveBeenCalledTimes(1);
    coalescer.dispose();
  });

  it('reports a synchronous throw as well', async () => {
    const onError = vi.fn();
    const coalescer = new Coalescer(1000, onError);
    const boom = new Error('boom');
    coalescer.schedule('a', () => {
      throw boom;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledWith(boom);
    coalescer.dispose();
  });

  it('starts the trailing run only after the in-flight run settled', async () => {
    const coalescer = new Coalescer(100, vi.fn());
    let settle: () => void = () => undefined;
    const first = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    );
    const second = vi.fn(() => Promise.resolve());
    const third = vi.fn(() => Promise.resolve());
    coalescer.schedule('a', first);
    coalescer.schedule('a', second);
    coalescer.schedule('a', third);
    await vi.advanceTimersByTimeAsync(500);
    expect(second).not.toHaveBeenCalled();
    expect(third).not.toHaveBeenCalled();
    settle();
    await vi.advanceTimersByTimeAsync(0);
    expect(second).not.toHaveBeenCalled();
    expect(third).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(third).toHaveBeenCalledTimes(1);
    coalescer.dispose();
  });

  it('drops what is pending on dispose', async () => {
    const coalescer = new Coalescer(1000, vi.fn());
    const later = vi.fn(() => Promise.resolve());
    coalescer.schedule('a', () => Promise.resolve());
    coalescer.schedule('a', later);
    coalescer.dispose();
    await vi.advanceTimersByTimeAsync(5000);
    expect(later).not.toHaveBeenCalled();
  });
});
