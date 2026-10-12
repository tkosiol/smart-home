import { ChangeDetectionStrategy, Component } from '@angular/core';

/** A list of `ui-list-item`s (M3 list); built without Material to keep roles and links simple. */
@Component({
  selector: 'ui-list',
  template: '<ng-content />',
  styleUrl: './list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'list' },
})
export class UiList {}
