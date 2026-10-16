import { type ExecutionContext, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { HouseholdRole } from '@smart/contracts';
import { ApiError } from '../../platform/http/index.js';
import { HouseholdGuard } from './household.guard.js';
import type { Membership } from './households.schema.js';
import type { MembershipsRepository } from './memberships.repository.js';
import { RequireRole } from './require-role.decorator.js';

const HOUSEHOLD = '3b241101-e2bb-4255-8caf-4136c566a962';
const USER = '0d1f5c0e-5b0e-4f3e-9d0c-6c1d2e3f4a5b';

class Routes {
  @RequireRole('member')
  members(): void {}

  undeclared(): void {}
}

@RequireRole('owner')
class OwnerRoutes {
  inherited(): void {}

  @RequireRole('viewer')
  overridden(): void {}
}

const membership = (role: HouseholdRole): Membership => ({
  householdId: HOUSEHOLD,
  userId: USER,
  role,
  overviewLayout: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
});

function setup(found?: Membership, householdId = HOUSEHOLD) {
  const find = vi.fn<MembershipsRepository['find']>(() => Promise.resolve(found));
  const guard = new HouseholdGuard(new Reflector(), { find } as unknown as MembershipsRepository);
  const request: Record<string, unknown> = {
    params: { householdId },
    user: { id: USER, sessionId: 's' },
  };
  const context = (controller: new () => object, handler: () => void): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => controller,
      switchToHttp: () => ({ getRequest: () => request }),
    }) as unknown as ExecutionContext;
  return { guard, find, request, context };
}

const handlerOf = <T extends object>(controller: new () => T, name: keyof T & string) =>
  Reflect.get(controller.prototype, name) as () => void;

async function failure(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

describe('HouseholdGuard', () => {
  it('throws a programming error for a route without @RequireRole (fail closed)', async () => {
    const { guard, find, context } = setup(membership('owner'));
    const error = await failure(
      guard.canActivate(context(Routes, handlerOf(Routes, 'undeclared'))),
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ApiError);
    expect(find).not.toHaveBeenCalled();
  });

  it('lets a member with the required role pass and attaches the membership', async () => {
    const found = membership('member');
    const { guard, find, request, context } = setup(found);
    await expect(guard.canActivate(context(Routes, handlerOf(Routes, 'members')))).resolves.toBe(
      true,
    );
    expect(find).toHaveBeenCalledWith(HOUSEHOLD, USER);
    expect(request['membership']).toBe(found);
  });

  it('lets a higher role pass', async () => {
    const { guard, context } = setup(membership('owner'));
    await expect(guard.canActivate(context(Routes, handlerOf(Routes, 'members')))).resolves.toBe(
      true,
    );
  });

  it('answers a too low role with 403 household.forbidden', async () => {
    const { guard, request, context } = setup(membership('viewer'));
    const error = await failure(guard.canActivate(context(Routes, handlerOf(Routes, 'members'))));
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).getStatus()).toBe(HttpStatus.FORBIDDEN);
    expect((error as ApiError).code).toBe('household.forbidden');
    expect(request['membership']).toBeUndefined();
  });

  it('answers a non-member with 404 household.notFound', async () => {
    const { guard, context } = setup(undefined);
    const error = await failure(guard.canActivate(context(Routes, handlerOf(Routes, 'members'))));
    expect((error as ApiError).getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect((error as ApiError).code).toBe('household.notFound');
  });

  it('answers a malformed id with 404 without asking the database', async () => {
    const { guard, find, context } = setup(membership('owner'), 'not-a-uuid');
    const error = await failure(guard.canActivate(context(Routes, handlerOf(Routes, 'members'))));
    expect((error as ApiError).getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect((error as ApiError).code).toBe('household.notFound');
    expect(find).not.toHaveBeenCalled();
  });

  it('reads the class level role and lets a method override it', async () => {
    const inherited = setup(membership('member'));
    const error = await failure(
      inherited.guard.canActivate(
        inherited.context(OwnerRoutes, handlerOf(OwnerRoutes, 'inherited')),
      ),
    );
    expect((error as ApiError).code).toBe('household.forbidden');

    const overridden = setup(membership('viewer'));
    await expect(
      overridden.guard.canActivate(
        overridden.context(OwnerRoutes, handlerOf(OwnerRoutes, 'overridden')),
      ),
    ).resolves.toBe(true);
  });

  it('refuses a request without a signed-in user', async () => {
    const { guard, request, context } = setup(membership('owner'));
    delete request['user'];
    const error = await failure(guard.canActivate(context(Routes, handlerOf(Routes, 'members'))));
    expect((error as ApiError).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
  });
});
