import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { UiSnackbar } from '@smart/ui/shell';
import { ApiError } from '../api';
import { HouseholdContext } from './household-context';
import { injectHouseholdErrorHandler } from './household-errors';

function setup() {
  const accessChanged = vi.fn(async () => undefined);
  const show = vi.fn(async () => undefined);
  TestBed.configureTestingModule({
    providers: [
      { provide: HouseholdContext, useValue: { accessChanged } },
      { provide: TranslocoService, useValue: { translate: (key: string) => key } },
      { provide: UiSnackbar, useValue: { show } },
    ],
  });
  const handle = TestBed.runInInjectionContext(() => injectHouseholdErrorHandler());
  return { handle, accessChanged, show };
}

describe('injectHouseholdErrorHandler', () => {
  it.each([
    ['household.notFound', 404],
    ['household.forbidden', 403],
  ] as const)('reloads the access on %s instead of showing a message', (code, status) => {
    const { handle, accessChanged, show } = setup();
    handle(new ApiError(code, status));
    expect(accessChanged).toHaveBeenCalledOnce();
    expect(show).not.toHaveBeenCalled();
  });

  it.each([
    new ApiError('auth.forbidden', 403),
    new ApiError('auth.badOrigin', 403),
    new Error('x'),
  ])('shows every other failure as a message: %s', (error) => {
    const { handle, accessChanged, show } = setup();
    handle(error);
    expect(show).toHaveBeenCalledOnce();
    expect(accessChanged).not.toHaveBeenCalled();
  });
});
