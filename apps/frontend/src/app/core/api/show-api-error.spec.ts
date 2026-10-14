import { TestBed } from '@angular/core/testing';
import { UiSnackbar } from '@smart/ui';
import { TranslocoService } from '@jsverse/transloco';
import { API_ERROR_CODES } from '@smart/contracts';
import { ApiError } from './api-error';
import { injectShowApiError } from './show-api-error';

function setup() {
  const show = vi.fn().mockResolvedValue('dismissed');
  const translate = vi.fn((key: string) => `T:${key}`);
  TestBed.configureTestingModule({
    providers: [
      { provide: UiSnackbar, useValue: { show } },
      { provide: TranslocoService, useValue: { translate } },
    ],
  });
  const showApiError = TestBed.runInInjectionContext(() => injectShowApiError());
  return { show, translate, showApiError };
}

describe('showApiError', () => {
  it('shows the translated text of the error code, assertively', () => {
    const { show, translate, showApiError } = setup();
    showApiError(new ApiError('auth.tooManyAttempts', 429, { minutes: 5 }));
    expect(translate).toHaveBeenCalledWith('app.errors.auth.tooManyAttempts', { minutes: 5 });
    expect(show).toHaveBeenCalledWith('T:app.errors.auth.tooManyAttempts', {
      politeness: 'assertive',
    });
  });

  it('shows the internal text for anything that is not an ApiError', () => {
    const { show, showApiError } = setup();
    showApiError(new Error('boom'));
    expect(show).toHaveBeenCalledWith('T:app.errors.internal', { politeness: 'assertive' });
  });

  it('has a text key for every code', () => {
    const { translate, showApiError } = setup();
    for (const code of API_ERROR_CODES) showApiError(new ApiError(code, 400));
    expect(translate.mock.calls.map(([key]) => key)).toEqual(
      API_ERROR_CODES.map((code) => `app.errors.${code}`),
    );
  });
});
