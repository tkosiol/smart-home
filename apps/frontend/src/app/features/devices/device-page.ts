import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { deviceRenameSchema, hasRole, isLowBattery, type Device } from '@smart/contracts';
import { UiButton, UiEmptyState, UiPage, UiRelativeTimePipe, UiSection, UiStack } from '@smart/ui';
import { UiTextField } from '@smart/ui/forms';
import { ApiError } from '../../core/api';
import { HouseholdContext, injectHouseholdErrorHandler } from '../../core/household';
import { DeviceReading } from './device-reading';
import { isNetworkFailure, refreshWhileVisible } from '../../core/refresh';
import { batteryPercent, readingsOf } from './device-values';
import { DevicesApi } from './devices.api';

/**
 * One device: all its readings with units (no settings), when it last reported, a hint while it is
 * offline or its battery is low; members can rename it. The values are fetched again every minute.
 */
@Component({
  selector: 'app-device-page',
  imports: [
    TranslocoPipe,
    DeviceReading,
    UiButton,
    UiEmptyState,
    UiPage,
    UiRelativeTimePipe,
    UiSection,
    UiStack,
    UiTextField,
  ],
  template: `
    <ui-page [heading]="device()?.name ?? ('devices.title' | transloco)">
      <ui-stack gap="xl">
        <ui-stack direction="row" gap="sm">
          <ui-button variant="text" icon="arrow_back" route="/geraete">{{
            'devices.detail.back' | transloco
          }}</ui-button>
        </ui-stack>
        @if (notFound()) {
          <ui-empty-state
            icon="devices"
            [heading]="'devices.detail.notFound.heading' | transloco"
            [description]="'devices.detail.notFound.description' | transloco"
          />
        }
        @if (device(); as device) {
          <ui-stack gap="sm">
            @if (lowBattery()) {
              <p>{{ 'devices.card.lowBattery' | transloco }}</p>
            }
            @if (device.availability === 'offline') {
              <p>{{ 'devices.card.offline' | transloco }}</p>
            }
          </ui-stack>
          <ui-section [heading]="'devices.detail.readings' | transloco">
            <ui-stack gap="sm">
              @for (capability of readings(); track capability.key) {
                <p>
                  <app-device-reading
                    [capability]="capability"
                    [value]="device.state[capability.key]"
                  />
                </p>
              } @empty {
                <p>{{ 'devices.detail.noReadings' | transloco }}</p>
              }
              <p>
                @if (device.lastSeenAt) {
                  {{
                    'devices.card.lastSeen'
                      | transloco: { time: device.lastSeenAt | uiRelativeTime }
                  }}
                } @else {
                  {{ 'devices.card.neverSeen' | transloco }}
                }
              </p>
            </ui-stack>
          </ui-section>
          <ui-section [heading]="'devices.detail.hardware' | transloco">
            <p>{{ device.hardware.vendor }} {{ device.hardware.model }}</p>
            @if (device.hardware.description) {
              <p>{{ device.hardware.description }}</p>
            }
          </ui-section>
          @if (canRename()) {
            <ui-section [heading]="'devices.detail.rename.title' | transloco">
              <form (submit)="rename($event)" novalidate>
                <ui-stack gap="lg">
                  <ui-text-field
                    name="name"
                    autocomplete="off"
                    required
                    [label]="'devices.detail.rename.name' | transloco"
                    [error]="nameInvalid() ? ('devices.nameError' | transloco) : null"
                    [(value)]="name"
                  />
                  <ui-stack direction="row" gap="sm">
                    <ui-button type="submit" [disabled]="busy()">{{
                      'devices.detail.rename.submit' | transloco
                    }}</ui-button>
                  </ui-stack>
                </ui-stack>
              </form>
            </ui-section>
          }
        }
      </ui-stack>
    </ui-page>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DevicePage {
  private readonly api = inject(DevicesApi);
  private readonly household = inject(HouseholdContext);
  private readonly handleError = injectHouseholdErrorHandler();
  private readonly deviceId = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';

  private readonly currentId = computed(() => this.household.current()?.id);
  protected readonly device = signal<Device | null>(null);
  /** The server does not know this device in this household. */
  protected readonly notFound = signal(false);
  protected readonly readings = computed(() => {
    const device = this.device();
    return device ? readingsOf(device) : [];
  });
  protected readonly lowBattery = computed(() => {
    const device = this.device();
    return device !== null && isLowBattery(batteryPercent(device));
  });
  protected readonly canRename = computed(() => {
    const role = this.household.current()?.role;
    return role !== undefined && hasRole(role, 'member');
  });

  // The typed name is kept across the minute's refresh: only the first load of a household's
  // device (and a successful rename) sets it.
  protected readonly name = linkedSignal<string | undefined, string>({
    source: this.currentId,
    computation: () => '',
  });
  protected readonly nameInvalid = linkedSignal<readonly unknown[], boolean>({
    source: () => [this.currentId(), this.name()],
    computation: () => false,
  });
  protected readonly busy = signal(false);

  private requests = 0;
  private refreshing = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.requests++);
    effect(() => {
      const id = this.currentId();
      untracked(() => {
        this.device.set(null);
        this.notFound.set(false);
        void this.load(id);
      });
    });
    refreshWhileVisible(() => {
      this.refreshing = true;
      void this.load(this.currentId()).finally(() => (this.refreshing = false));
    });
  }

  private async load(householdId: string | undefined): Promise<void> {
    const request = ++this.requests;
    if (!householdId) return;
    try {
      const device = await this.api.get(householdId, this.deviceId);
      if (request !== this.requests) return;
      const first = this.device() === null;
      this.device.set(device);
      this.notFound.set(false);
      if (first) this.name.set(device.name);
    } catch (error) {
      if (request !== this.requests) return;
      if (error instanceof ApiError && error.status === 404) {
        // The household path answers 404 for an unknown device too: the page says so itself.
        this.device.set(null);
        this.notFound.set(true);
      } else if (!(this.refreshing && isNetworkFailure(error))) {
        this.handleError(error);
      }
    }
  }

  protected async rename(event: Event): Promise<void> {
    event.preventDefault();
    const householdId = this.currentId();
    if (!householdId || this.busy()) return;
    const parsed = deviceRenameSchema.safeParse({ name: this.name() });
    if (!parsed.success) {
      this.nameInvalid.set(true);
      return;
    }
    this.busy.set(true);
    try {
      const device = await this.api.rename(householdId, this.deviceId, parsed.data);
      if (this.currentId() !== householdId) return;
      this.device.set(device);
      this.name.set(device.name);
    } catch (error) {
      this.handleError(error);
    } finally {
      this.busy.set(false);
    }
  }
}
