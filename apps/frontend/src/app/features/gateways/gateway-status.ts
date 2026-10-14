import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { GatewayStatus } from '@smart/contracts';

/** "Label: Online" for one status of a gateway; the text carries the state, not only a colour. */
@Component({
  selector: 'app-gateway-status',
  imports: [TranslocoPipe],
  template: `{{ label() }}:
    {{
      status() === 'online'
        ? ('gateways.status.online' | transloco)
        : status() === 'offline'
          ? ('gateways.status.offline' | transloco)
          : ('gateways.status.unknown' | transloco)
    }}`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GatewayStatusText {
  readonly label = input.required<string>();
  readonly status = input.required<GatewayStatus>();
}
