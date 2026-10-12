import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiPage } from '@smart/ui';

/** Placeholder until the page is built. */
@Component({
  selector: 'app-rooms-page',
  imports: [TranslocoPipe, UiPage],
  template: `<ui-page [heading]="'rooms.title' | transloco" />`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RoomsPage {}
