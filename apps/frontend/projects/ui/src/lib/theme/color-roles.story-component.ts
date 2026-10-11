import { ChangeDetectionStrategy, Component } from '@angular/core';
import { COLOR_GROUPS } from './color-roles.groups';

/** Storybook-only overview of every color role; not part of the public API. */
@Component({
  selector: 'ui-color-roles',
  templateUrl: './color-roles.story-component.html',
  styleUrl: './color-roles.story-component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ColorRolesStoryComponent {
  readonly groups = COLOR_GROUPS;
}
