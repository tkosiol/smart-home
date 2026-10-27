import {
  EnvironmentInjector,
  createEnvironmentInjector,
  runInInjectionContext,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ApiError } from '../api';
import { REFRESH_MS, RefreshGuard, refreshWhileVisible } from './refresh-while-visible';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => (resolve = res));
  return { promise, resolve };
}

describe('RefreshGuard', () => {
  it('runs a task and is refreshing until it ends', async () => {
    const guard = new RefreshGuard();
    const slow = deferred();
    expect(guard.refreshing()).toBe(false);
    const run = guard.run(() => slow.promise);
    expect(guard.refreshing()).toBe(true);
    slow.resolve();
    await run;
    expect(guard.refreshing()).toBe(false);
  });

  it('skips a task while another one runs, and is refreshing until that one ends', async () => {
    const guard = new RefreshGuard();
    const slow = deferred();
    const first = vi.fn(() => slow.promise);
    const second = vi.fn(async () => undefined);
    const run = guard.run(first);
    await guard.run(second);
    expect(second).not.toHaveBeenCalled();
    expect(guard.refreshing()).toBe(true);
    slow.resolve();
    await run;
    expect(guard.refreshing()).toBe(false);
    await guard.run(second);
    expect(second).toHaveBeenCalledOnce();
  });

  it('ends the refresh when the task fails', async () => {
    const guard = new RefreshGuard();
    await expect(guard.run(() => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(guard.refreshing()).toBe(false);
  });

  it('keeps quiet about a network failure of a refresh only', async () => {
    const guard = new RefreshGuard();
    const handle = vi.fn();
    const quiet = guard.quietNetworkFailure(handle);
    const offline = new ApiError('internal', 0);
    quiet(offline);
    expect(handle).toHaveBeenCalledWith(offline);
    handle.mockClear();
    const slow = deferred();
    const run = guard.run(() => slow.promise);
    quiet(offline);
    expect(handle).not.toHaveBeenCalled();
    const server = new ApiError('internal', 500);
    quiet(server);
    expect(handle).toHaveBeenCalledWith(server);
    slow.resolve();
    await run;
  });
});

describe('refreshWhileVisible', () => {
  const visibility = (state: DocumentVisibilityState) =>
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state);
  let destroy: (() => void) | undefined;

  function start(guard: RefreshGuard, reload: () => Promise<unknown>, intervalMs?: number): void {
    const injector = createEnvironmentInjector([], TestBed.inject(EnvironmentInjector));
    runInInjectionContext(injector, () => refreshWhileVisible(guard, reload, intervalMs));
    let done = false;
    destroy = () => {
      if (!done) injector.destroy();
      done = true;
    };
  }

  beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }));
  afterEach(() => {
    destroy?.();
    destroy = undefined;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reloads every minute while the tab is visible', async () => {
    const reload = vi.fn(async () => undefined);
    start(new RefreshGuard(), reload);
    await vi.advanceTimersByTimeAsync(REFRESH_MS - 1);
    expect(reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('reloads at the interval it is given', async () => {
    const reload = vi.fn(async () => undefined);
    start(new RefreshGuard(), reload, 5 * REFRESH_MS);
    await vi.advanceTimersByTimeAsync(5 * REFRESH_MS - 1);
    expect(reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('does not reload while the tab is hidden', async () => {
    visibility('hidden');
    const reload = vi.fn(async () => undefined);
    start(new RefreshGuard(), reload);
    await vi.advanceTimersByTimeAsync(3 * REFRESH_MS);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(reload).not.toHaveBeenCalled();
  });

  it('asks once when the tick and the tab coming back meet a slow load', async () => {
    const slow = deferred();
    const reload = vi.fn(() => slow.promise);
    const guard = new RefreshGuard();
    start(guard, reload);
    await vi.advanceTimersByTimeAsync(REFRESH_MS);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(REFRESH_MS);
    expect(reload).toHaveBeenCalledOnce();
    expect(guard.refreshing()).toBe(true);
    slow.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(guard.refreshing()).toBe(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('stops with the injection context', async () => {
    const reload = vi.fn(async () => undefined);
    start(new RefreshGuard(), reload);
    destroy?.();
    await vi.advanceTimersByTimeAsync(2 * REFRESH_MS);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(reload).not.toHaveBeenCalled();
  });
});
