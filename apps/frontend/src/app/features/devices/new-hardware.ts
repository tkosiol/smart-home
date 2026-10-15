import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  output,
  signal,
  untracked,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { deviceCreateSchema, type Hardware } from '@smart/contracts';
import { UiButton, UiCard, UiGrid, UiRelativeTimePipe, UiSection, UiStack } from '@smart/ui';
import { UiTextField } from '@smart/ui/forms';
import { ApiError } from '../../core/api';
import { HouseholdContext, injectHouseholdErrorHandler, LoadedList } from '../../core/household';
import { DeviceReading } from './device-reading';
import { RefreshGuard, refreshWhileVisible } from '../../core/refresh';
import { isReading } from './device-values';
import { DevicesApi } from './devices.api';

/**
 * "Neu erkannt" (owners): hardware a gateway reported that is not a device yet, with a preview of
 * what it reports. The name is prefilled with the hardware's own and can be changed before the
 * hardware is added.
 */
@Component({
  selector: 'app-new-hardware',
  imports: [
    TranslocoPipe,
    DeviceReading,
    UiButton,
    UiCard,
    UiGrid,
    UiRelativeTimePipe,
    UiSection,
    UiStack,
    UiTextField,
  ],
  template: `
    @if (hardware.items().length > 0) {
      <ui-section
        [heading]="'devices.discovered.title' | transloco"
        [description]="'devices.discovered.description' | transloco"
      >
        <ui-grid>
          @for (item of hardware.items(); track item.id) {
            <ui-card [heading]="item.friendlyName" [description]="item.vendor + ' ' + item.model">
              <form (submit)="add($event, item)" novalidate>
                <ui-stack gap="sm">
                  @for (capability of readings(item); track capability.key) {
                    <p>
                      <app-device-reading
                        [capability]="capability"
                        [value]="item.lastState[capability.key]"
                      />
                    </p>
                  }
                  <p>
                    @if (item.lastSeenAt) {
                      {{
                        'devices.card.lastSeen'
                          | transloco: { time: item.lastSeenAt | uiRelativeTime }
                      }}
                    } @else {
                      {{ 'devices.card.neverSeen' | transloco }}
                    }
                  </p>
                  <ui-text-field
                    name="name"
                    autocomplete="off"
                    required
                    [label]="'devices.discovered.name' | transloco"
                    [error]="invalid().has(item.id) ? ('devices.nameError' | transloco) : null"
                    [value]="nameOf(item)"
                    (valueChange)="rename(item.id, $event)"
                  />
                  <ui-stack direction="row" gap="sm">
                    <ui-button type="submit" [disabled]="busy()">{{
                      'devices.discovered.add' | transloco
                    }}</ui-button>
                  </ui-stack>
                </ui-stack>
              </form>
            </ui-card>
          }
        </ui-grid>
      </ui-section>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NewHardware {
  private readonly api = inject(DevicesApi);
  private readonly household = inject(HouseholdContext);
  private readonly handleError = injectHouseholdErrorHandler();

  /** A hardware was added as a device: the device list should be loaded again. */
  readonly added = output();

  private readonly currentId = computed(() => this.household.current()?.id);
  private readonly refresh = new RefreshGuard();
  protected readonly hardware = new LoadedList<Hardware>(
    (id) => this.api.unassignedHardware(id),
    this.refresh.quietNetworkFailure((error) => this.handleError(error)),
  );
  /** Names the owner typed, by hardware id; hardware without an entry shows its own name. */
  private readonly names = signal<Readonly<Record<string, string>>>({});
  protected readonly invalid = signal<ReadonlySet<string>>(new Set());
  protected readonly busy = signal(false);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.hardware.dispose());
    effect(() => {
      const id = this.currentId();
      untracked(() => {
        this.names.set({});
        this.invalid.set(new Set());
        void this.hardware.load(id);
      });
    });
    refreshWhileVisible(this.refresh, () => this.hardware.load(this.currentId(), true));
  }

  protected readings(item: Hardware) {
    return item.capabilities.filter(isReading);
  }

  protected nameOf(item: Hardware): string {
    return this.names()[item.id] ?? item.friendlyName;
  }

  protected rename(id: string, name: string): void {
    this.names.update((names) => ({ ...names, [id]: name }));
    this.invalid.update((invalid) => new Set([...invalid].filter((other) => other !== id)));
  }

  protected async add(event: Event, item: Hardware): Promise<void> {
    event.preventDefault();
    const householdId = this.currentId();
    if (!householdId || this.busy()) return;
    const parsed = deviceCreateSchema.safeParse({ hardwareId: item.id, name: this.nameOf(item) });
    if (!parsed.success) {
      this.invalid.update((invalid) => new Set([...invalid, item.id]));
      return;
    }
    this.busy.set(true);
    try {
      await this.api.add(householdId, parsed.data);
      if (this.currentId() !== householdId) return;
      await this.hardware.load(householdId, true);
      this.added.emit();
    } catch (error) {
      this.handleError(error);
      // Someone was faster: the hardware is a device already, so the list of new hardware is stale.
      if (error instanceof ApiError && error.code === 'device.hardwareBound') {
        void this.hardware.load(this.currentId(), true);
        this.added.emit();
      }
    } finally {
      this.busy.set(false);
    }
  }
}
