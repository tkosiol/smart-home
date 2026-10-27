import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import type { HouseholdRequest } from '../households/index.js';
import type { UsersRepository } from '../identity/index.js';
import type { LiveHub } from './live-hub.js';
import { LiveController } from './live.controller.js';

const fakeResponse = () => {
  const response = Object.assign(new EventEmitter(), {
    status: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    flushHeaders: vi.fn(),
    write: vi.fn(() => true),
    end: vi.fn(),
  });
  return response;
};

const request = {
  user: { id: 'u1', sessionId: 's1' },
  membership: { householdId: 'h1', role: 'viewer' },
} as unknown as HouseholdRequest;

describe('LiveController', () => {
  it('registers nothing when the client leaves while the user is being read', async () => {
    let found: (value: { isPlatformAdmin: boolean }) => void = () => undefined;
    const users = {
      findById: () =>
        new Promise((resolve) => {
          found = resolve;
        }),
    };
    const hub = { add: vi.fn(() => vi.fn()) };
    const controller = new LiveController(
      hub as unknown as LiveHub,
      users as unknown as UsersRepository,
    );
    const response = fakeResponse();
    const done = controller.events(request, response as unknown as Response);
    response.emit('close');
    found({ isPlatformAdmin: false });
    await done;
    expect(hub.add).not.toHaveBeenCalled();
    expect(response.write).not.toHaveBeenCalled();
  });

  it('removes the client when the response closes later', async () => {
    const remove = vi.fn();
    const hub = { add: vi.fn(() => remove) };
    const users = { findById: () => Promise.resolve({ isPlatformAdmin: false }) };
    const controller = new LiveController(
      hub as unknown as LiveHub,
      users as unknown as UsersRepository,
    );
    const response = fakeResponse();
    await controller.events(request, response as unknown as Response);
    expect(hub.add).toHaveBeenCalledTimes(1);
    response.emit('close');
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
