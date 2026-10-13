import { type ExecutionContext } from '@nestjs/common';
import { PlatformAdminGuard } from './platform-admin.guard.js';
import type { User } from './identity.schema.js';
import type { UsersRepository } from './users.repository.js';

const contextFor = (request: object): ExecutionContext =>
  ({ switchToHttp: () => ({ getRequest: () => request }) }) as unknown as ExecutionContext;

const guardFor = (user: Pick<User, 'isPlatformAdmin'> | undefined): PlatformAdminGuard =>
  new PlatformAdminGuard({ findById: () => Promise.resolve(user) } as unknown as UsersRepository);

const caller = { user: { id: 'u1', sessionId: 's1' } };

describe('PlatformAdminGuard', () => {
  it('lets a platform admin through', async () => {
    await expect(guardFor({ isPlatformAdmin: true }).canActivate(contextFor(caller))).resolves.toBe(
      true,
    );
  });

  it('answers 403 auth.forbidden for a normal user', async () => {
    await expect(
      guardFor({ isPlatformAdmin: false }).canActivate(contextFor(caller)),
    ).rejects.toMatchObject({ status: 403, code: 'auth.forbidden' });
  });

  it('answers 401 without a session or for an unknown user', async () => {
    await expect(
      guardFor({ isPlatformAdmin: true }).canActivate(contextFor({})),
    ).rejects.toMatchObject({ status: 401 });
    await expect(guardFor(undefined).canActivate(contextFor(caller))).rejects.toMatchObject({
      status: 401,
    });
  });
});
