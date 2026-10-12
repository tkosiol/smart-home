import { TestBed } from '@angular/core/testing';
import { NAVIGATOR_ONLINE, OnlineStatus } from './online-status';

describe('OnlineStatus', () => {
  function setup(initial: boolean) {
    const state = { online: initial };
    TestBed.configureTestingModule({
      providers: [{ provide: NAVIGATOR_ONLINE, useValue: () => state.online }],
    });
    return { state, status: TestBed.inject(OnlineStatus) };
  }

  it('starts with the navigator state', () => {
    expect(setup(false).status.online()).toBe(false);
  });

  it('follows the offline and online events', () => {
    const { state, status } = setup(true);
    expect(status.online()).toBe(true);

    state.online = false;
    window.dispatchEvent(new Event('offline'));
    expect(status.online()).toBe(false);

    state.online = true;
    window.dispatchEvent(new Event('online'));
    expect(status.online()).toBe(true);
  });
});
