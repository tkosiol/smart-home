import { Injectable, signal } from '@angular/core';

/**
 * Language and time zone for all formatting in @smart/ui. Stage 3c sets the language, stage 4 the
 * household time zone; until then the browser's time zone is used.
 */
@Injectable({ providedIn: 'root' })
export class UiFormatContext {
  readonly locale = signal('de');
  readonly timeZone = signal(Intl.DateTimeFormat().resolvedOptions().timeZone);
}
