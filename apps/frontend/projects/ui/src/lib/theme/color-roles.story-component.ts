import { ChangeDetectionStrategy, Component } from '@angular/core';
import { COLOR_ROLES, STATUS_NAMES } from '@smart/theme';

/** Storybook-only overview of every color role; not part of the public API. */
@Component({
  selector: 'ui-color-roles',
  templateUrl: './color-roles.story-component.html',
  styleUrl: './color-roles.story-component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ColorRolesStoryComponent {
  readonly roles = COLOR_ROLES;
  readonly statuses = STATUS_NAMES;
}
