import { ChangeDetectionStrategy, Component, booleanAttribute, input, model } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { HouseholdRole } from '@smart/contracts';
import { UiSelect } from '@smart/ui/forms';

/** Choice of a household role with the translated role names. */
@Component({
  selector: 'app-role-select',
  imports: [TranslocoPipe, UiSelect],
  template: `
    <ui-select
      [label]="label()"
      [disabled]="disabled()"
      [options]="[
        { value: 'viewer', label: 'households.roles.viewer' | transloco },
        { value: 'member', label: 'households.roles.member' | transloco },
        { value: 'owner', label: 'households.roles.owner' | transloco },
      ]"
      [value]="value()"
      (valueChange)="choose($event)"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RoleSelect {
  readonly label = input.required<string>();
  readonly value = model<HouseholdRole>();
  readonly disabled = input(false, { transform: booleanAttribute });

  protected choose(role: HouseholdRole | undefined): void {
    if (role) this.value.set(role);
  }
}
