import { ApiError } from '../api';
import { RefreshGuard } from './refresh-while-visible';

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
