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
import { deviceRenameSchema, hasRole, type Device } from '@smart/contracts';
import {
  UiBanner,
  UiButton,
  UiCard,
  UiDeviceHero,
  UiDevicePod,
  UiEmptyState,
  UiFormatContext,
  UiGrid,
  UiPage,
  UiProgressBand,
  UiRelativeTimePipe,
  UiSection,
  UiStack,
  UiStatusChip,
  UiValueDisplay,
} from '@smart/ui';
import { UiTextField } from '@smart/ui/forms';
import { ApiError } from '../../core/api';
import { HouseholdContext, injectHouseholdErrorHandler } from '../../core/household';
import { injectLive } from '../../core/live';
import { RefreshGuard, isNetworkFailure } from '../../core/refresh';
import { heroOf, kindKey, sidePodsOf } from './device-hero';
import { capabilityLabelKey, isBatteryLow } from './device-values';
import { DevicesApi } from './devices.api';
import { HistoryCard } from './history-card';
import { historyCapabilities } from './history-model';
import { ThresholdsCard } from './thresholds-card';

/**
 * One device (spec 3.3): the hero with its main value, status and target range,
 * the next readings as pods, when it last reported, a banner while it is offline or its battery is
 * low, its history (next to the values from the Expanded window class) and the thresholds; members
 * can rename it and change the thresholds. The values follow live events.
 */
@Component({
  selector: 'app-device-page',
  imports: [
    TranslocoPipe,
    HistoryCard,
    ThresholdsCard,
    UiBanner,
    UiButton,
    UiCard,
    UiDeviceHero,
    UiDevicePod,
    UiEmptyState,
    UiGrid,
    UiPage,
    UiProgressBand,
    UiRelativeTimePipe,
    UiSection,
    UiStack,
    UiStatusChip,
    UiTextField,
    UiValueDisplay,
  ],
  template: `
    <ui-page
      [heading]="device()?.name ?? ('devices.title' | transloco)"
      [description]="kind() ? (kind()! | transloco) : undefined"
      backRoute="/geraete"
      [backLabel]="'devices.detail.back' | transloco"
    >
      <ui-stack gap="xl">
        @if (notFound()) {
          <ui-empty-state
            icon="devices"
            [heading]="'devices.detail.notFound.heading' | transloco"
            [description]="'devices.detail.notFound.description' | transloco"
          />
        }
        @if (device(); as device) {
          @if (device.availability === 'offline' || lowBattery()) {
            <ui-stack gap="sm">
              @if (device.availability === 'offline') {
                <ui-banner tone="offline">{{ 'devices.card.offline' | transloco }}</ui-banner>
              }
              @if (lowBattery()) {
                <ui-banner tone="warning" icon="battery_alert">{{
                  'devices.card.lowBattery' | transloco
                }}</ui-banner>
              }
            </ui-stack>
          }
          <ui-grid min="split" gap="xl">
            <ui-section [heading]="'devices.detail.readings' | transloco">
              <ui-stack gap="sm">
                @if (hero(); as hero) {
                  <ui-device-hero
                    [kind]="hero.kind"
                    [label]="
                      heroLabelKey() ? (heroLabelKey()! | transloco) : (hero.capabilityKey ?? '')
                    "
                    [note]="
                      device.lastSeenAt
                        ? ('devices.detail.updated'
                          | transloco: { time: device.lastSeenAt | uiRelativeTime })
                        : ('devices.card.neverSeen' | transloco)
                    "
                  >
                    @if (hero.chip; as chip) {
                      <ui-status-chip [text]="chip.key | transloco" [tone]="chip.tone" />
                    }
                    <span
                      [attr.role]="hero.missing ? 'img' : null"
                      [attr.aria-label]="hero.missing ? ('devices.reading.none' | transloco) : null"
                    >
                      <ui-value-display
                        size="hero"
                        [value]="hero.valueKey ? (hero.valueKey | transloco) : hero.value"
                        [unit]="hero.unit"
                      />
                    </span>
                    @if (hero.meter; as meter) {
                      <ui-progress-band
                        [value]="meter.value"
                        [band]="meter.band"
                        [label]="'app.devices.capability.soil_moisture' | transloco"
                        [valueText]="meter.textKey | transloco: meter.textParams"
                      />
                    }
                  </ui-device-hero>
                } @else {
                  <p>{{ 'devices.detail.noReadings' | transloco }}</p>
                }
                @if (sidePods().length > 0) {
                  <ui-grid min="xs" gap="sm">
                    @for (pod of sidePods(); track pod.key) {
                      <ui-device-pod
                        fill
                        kind="climate"
                        [icon]="pod.icon"
                        [value]="pod.valueKey ? (pod.valueKey | transloco) : pod.value"
                        [unit]="pod.unit"
                        [label]="pod.labelKey ? (pod.labelKey | transloco) : pod.key"
                      />
                    }
                  </ui-grid>
                }
              </ui-stack>
            </ui-section>
            @if (hasHistory()) {
              <app-history-card [device]="device" />
            }
          </ui-grid>
          <app-thresholds-card
            [device]="device"
            [canEdit]="canRename()"
            (saved)="updated($event)"
          />
          <ui-card variant="low" [level]="2" [heading]="'devices.detail.hardware' | transloco">
            <p>{{ device.hardware.vendor }} {{ device.hardware.model }}</p>
            @if (device.hardware.description) {
              <p>{{ device.hardware.description }}</p>
            }
          </ui-card>
          @if (canRename()) {
            <ui-card
              variant="low"
              [level]="2"
              [heading]="'devices.detail.rename.title' | transloco"
            >
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
            </ui-card>
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
  private readonly locale = inject(UiFormatContext).locale;
  protected readonly kind = computed(() => {
    const device = this.device();
    return device ? kindKey(device.kind) : null;
  });
  /** The main value; none for a device that has not reported a reading and has no readings. */
  protected readonly hero = computed(() => {
    const device = this.device();
    const hero = device ? heroOf(device, this.locale()) : null;
    return hero?.capabilityKey === undefined ? null : hero;
  });
  /** The name of the main value; null for a capability the app has no name for (shown as its key). */
  protected readonly heroLabelKey = computed(() => {
    const key = this.hero()?.capabilityKey;
    return key === undefined ? null : capabilityLabelKey(key);
  });
  protected readonly sidePods = computed(() => {
    const device = this.device();
    return device ? sidePodsOf(device, this.locale()) : [];
  });
  protected readonly lowBattery = computed(() => {
    const device = this.device();
    return device !== null && isBatteryLow(device);
  });
  protected readonly hasHistory = computed(() => {
    const device = this.device();
    return device !== null && historyCapabilities(device).length > 0;
  });
  protected readonly canRename = computed(() => {
    const role = this.household.current()?.role;
    return role !== undefined && hasRole(role, 'member');
  });

  // The typed name is kept across live updates and reloads: only the first load of a household's
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
  private readonly refresh = new RefreshGuard();

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
    injectLive({
      'device.state': (device) => this.updated(device),
      resync: () => void this.refresh.run(() => this.load(this.currentId())),
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
      } else if (!(this.refresh.refreshing() && isNetworkFailure(error))) {
        this.handleError(error);
      }
    }
  }

  protected updated(device: Device): void {
    if (device.id !== this.deviceId) return;
    // A refresh that was asked before this change may still be on its way with the old values.
    this.requests++;
    this.device.set(device);
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
      const device = await this.api.update(householdId, this.deviceId, parsed.data);
      if (this.currentId() !== householdId) return;
      this.requests++;
      this.device.set(device);
      this.name.set(device.name);
    } catch (error) {
      this.handleError(error);
    } finally {
      this.busy.set(false);
    }
  }
}
