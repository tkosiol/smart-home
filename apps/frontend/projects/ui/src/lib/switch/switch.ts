import { ChangeDetectionStrategy, Component, booleanAttribute, input, model } from '@angular/core';
import { MatSlideToggle } from '@angular/material/slide-toggle';

/** On/off switch with a visible label; bind with `[(checked)]`. */
@Component({
  selector: 'ui-switch',
  imports: [MatSlideToggle],
  templateUrl: './switch.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UiSwitch {
  readonly label = input.required<string>();
  readonly checked = model(false);
  readonly disabled = input(false, { transform: booleanAttribute });
}
