import { LoadedList } from './loaded-list';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('LoadedList', () => {
  it('starts empty and not loaded', () => {
    const list = new LoadedList<string>(async () => ['a'], vi.fn());
    expect(list.items()).toEqual([]);
    expect(list.loaded()).toBe(false);
  });

  it('shows the server answer for the household and marks the list loaded', async () => {
    const fetch = vi.fn(async (id: string) => [`${id}-1`, `${id}-2`]);
    const list = new LoadedList<string>(fetch, vi.fn());
    await list.load('h1');
    expect(fetch).toHaveBeenCalledWith('h1');
    expect(list.items()).toEqual(['h1-1', 'h1-2']);
    expect(list.loaded()).toBe(true);
  });

  it('empties the list without a household and asks nobody', async () => {
    const fetch = vi.fn(async () => ['a']);
    const list = new LoadedList<string>(fetch, vi.fn());
    await list.load('h1');
    await list.load(undefined);
    expect(fetch).toHaveBeenCalledOnce();
    expect(list.items()).toEqual([]);
    expect(list.loaded()).toBe(false);
  });

  it('empties the list while loading another household, but keeps the rows on request', async () => {
    const second = deferred<string[]>();
    const answers = [Promise.resolve(['old']), second.promise];
    const list = new LoadedList<string>(() => answers.shift()!, vi.fn());
    await list.load('h1');
    const reload = list.load('h1', true);
    expect(list.items()).toEqual(['old']);
    expect(list.loaded()).toBe(true);
    second.resolve(['new']);
    await reload;
    expect(list.items()).toEqual(['new']);

    const third = deferred<string[]>();
    answers.push(third.promise);
    const other = list.load('h2');
    expect(list.items()).toEqual([]);
    expect(list.loaded()).toBe(false);
    third.resolve(['other']);
    await other;
    expect(list.items()).toEqual(['other']);
  });

  it('ignores a slower answer to an older request', async () => {
    const slow = deferred<string[]>();
    const answers = [slow.promise, Promise.resolve(['fresh'])];
    const list = new LoadedList<string>(() => answers.shift()!, vi.fn());
    const first = list.load('h1');
    await list.load('h2');
    slow.resolve(['stale']);
    await first;
    expect(list.items()).toEqual(['fresh']);
  });

  it('ignores answers and errors after dispose', async () => {
    const answer = deferred<string[]>();
    const onError = vi.fn();
    const list = new LoadedList<string>(() => answer.promise, onError);
    const loading = list.load('h1');
    list.dispose();
    answer.resolve(['late']);
    await loading;
    expect(list.items()).toEqual([]);
    expect(list.loaded()).toBe(false);

    const failing = deferred<string[]>();
    const other = new LoadedList<string>(() => failing.promise, onError);
    const failed = other.load('h1');
    other.dispose();
    failing.reject(new Error('late'));
    await failed;
    expect(onError).not.toHaveBeenCalled();
  });

  it('hands a failure to the error handler and stays not loaded', async () => {
    const error = new Error('no');
    const onError = vi.fn();
    const list = new LoadedList<string>(async () => Promise.reject(error), onError);
    await list.load('h1');
    expect(onError).toHaveBeenCalledExactlyOnceWith(error);
    expect(list.loaded()).toBe(false);
  });

  describe('live changes', () => {
    interface Row {
      readonly id: string;
      readonly n: number;
    }
    const loaded = async (rows: Row[]) => {
      const list = new LoadedList<Row>(async () => rows, vi.fn());
      await list.load('h1');
      return list;
    };

    it('upsert replaces the entry with the same id in place, else appends', async () => {
      const list = await loaded([
        { id: 'a', n: 1 },
        { id: 'b', n: 2 },
      ]);
      list.upsert({ id: 'a', n: 10 });
      expect(list.items()).toEqual([
        { id: 'a', n: 10 },
        { id: 'b', n: 2 },
      ]);
      list.upsert({ id: 'c', n: 3 });
      expect(list.items().map((row) => row.id)).toEqual(['a', 'b', 'c']);
    });

    it('remove drops the entry with that id and ignores an unknown one', async () => {
      const list = await loaded([
        { id: 'a', n: 1 },
        { id: 'b', n: 2 },
      ]);
      list.remove('a');
      list.remove('zzz');
      expect(list.items()).toEqual([{ id: 'b', n: 2 }]);
    });

    it('upsert and remove do nothing until the list is loaded', () => {
      const list = new LoadedList<Row>(async () => [], vi.fn());
      list.upsert({ id: 'a', n: 1 });
      list.remove('a');
      expect(list.items()).toEqual([]);
      expect(list.loaded()).toBe(false);
    });

    it('does nothing while a load without `keep` has emptied the list', async () => {
      const slow = deferred<Row[]>();
      const list = await loaded([{ id: 'a', n: 1 }]);
      const fetch = vi.fn(() => slow.promise);
      const other = new LoadedList<Row>(fetch, vi.fn());
      void other.load('h1');
      other.upsert({ id: 'a', n: 1 });
      expect(other.items()).toEqual([]);
      slow.resolve([]);
      expect(list.items()).toHaveLength(1);
    });

    it('replace sets the list as loaded and ignores answers still on their way', async () => {
      const slow = deferred<Row[]>();
      const list = new LoadedList<Row>(() => slow.promise, vi.fn());
      const load = list.load('h1');
      list.replace([{ id: 'new', n: 1 }]);
      expect(list.loaded()).toBe(true);
      slow.resolve([{ id: 'old', n: 0 }]);
      await load;
      expect(list.items()).toEqual([{ id: 'new', n: 1 }]);
    });
  });
});
