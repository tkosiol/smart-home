import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

/** The name of a capability: known keys in the page language, any other key as it is. */
@Component({
  selector: 'app-capability-label',
  imports: [TranslocoPipe],
  template: `@switch (key()) {
    @case ('soil_moisture') {
      <ng-container>{{ 'devices.capability.soil_moisture' | transloco }}</ng-container>
    }
    @case ('temperature') {
      <ng-container>{{ 'devices.capability.temperature' | transloco }}</ng-container>
    }
    @case ('humidity') {
      <ng-container>{{ 'devices.capability.humidity' | transloco }}</ng-container>
    }
    @case ('battery') {
      <ng-container>{{ 'devices.capability.battery' | transloco }}</ng-container>
    }
    @case ('dry') {
      <ng-container>{{ 'devices.capability.dry' | transloco }}</ng-container>
    }
    @case ('linkquality') {
      <ng-container>{{ 'devices.capability.linkquality' | transloco }}</ng-container>
    }
    @case ('state') {
      <ng-container>{{ 'devices.capability.state' | transloco }}</ng-container>
    }
    @case ('brightness') {
      <ng-container>{{ 'devices.capability.brightness' | transloco }}</ng-container>
    }
    @case ('color_temp') {
      <ng-container>{{ 'devices.capability.color_temp' | transloco }}</ng-container>
    }
    @default {
      <ng-container>{{ key() }}</ng-container>
    }
  }`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CapabilityLabel {
  readonly key = input.required<string>();
}
