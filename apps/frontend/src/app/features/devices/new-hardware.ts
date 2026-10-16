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
import {
  deviceCreateSchema,
  deviceKind,
  primaryCapability,
  type DeviceKind,
  type Hardware,
} from '@smart/contracts';
import {
  UiButton,
  UiCard,
  UiDevicePod,
  UiGrid,
  UiFormatContext,
  UiRelativeTimePipe,
  UiStack,
} from '@smart/ui';
import type { IconName } from '@smart/ui/shell';
import { UiTextField } from '@smart/ui/forms';
import { ApiError } from '../../core/api';
import { HouseholdContext, injectHouseholdErrorHandler, LoadedList } from '../../core/household';
import { RefreshGuard, refreshWhileVisible } from '../../core/refresh';
import { ICONS, readingValue, type ReadingValue } from './device-pod';
import { DevicesApi } from './devices.api';

/** One found hardware with the preview pod of its main reading. */
interface Found {
  readonly item: Hardware;
  readonly kind: DeviceKind;
  readonly icon: IconName;
  readonly reading: ReadingValue;
}

/**
 * "Neu erkannt" (owners): hardware a gateway reported that is not a device yet, as a card in
 * secondary-container (spec 3.6) with a pod per hardware showing its main reading. The name is
 * prefilled with the hardware's own and can be changed before the hardware is added.
 */
@Component({
  selector: 'app-new-hardware',
  imports: [
    TranslocoPipe,
    UiButton,
    UiCard,
    UiDevicePod,
    UiGrid,
    UiRelativeTimePipe,
    UiStack,
    UiTextField,
  ],
  template: `
    @if (found().length > 0) {
      <ui-card
        variant="accent"
        [level]="2"
        [heading]="'devices.discovered.title' | transloco"
        [description]="'devices.discovered.description' | transloco"
      >
        <ui-grid min="md" gap="lg">
          @for (found of found(); track found.item.id) {
            @let item = found.item;
            <form (submit)="add($event, item)" novalidate>
              <ui-stack gap="sm">
                <ui-device-pod
                  fill
                  [kind]="found.kind"
                  [icon]="found.icon"
                  [value]="
                    found.reading.valueKey
                      ? (found.reading.valueKey | transloco)
                      : found.reading.value
                  "
                  [unit]="found.reading.unit"
                  [label]="item.friendlyName"
                />
                <p>{{ item.vendor }} {{ item.model }}</p>
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
          }
        </ui-grid>
      </ui-card>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NewHardware {
  private readonly api = inject(DevicesApi);
  private readonly household = inject(HouseholdContext);
  private readonly locale = inject(UiFormatContext).locale;
  private readonly handleError = injectHouseholdErrorHandler();

  /** A hardware was added as a device: the device list should be loaded again. */
  readonly added = output();

  private readonly currentId = computed(() => this.household.current()?.id);
  private readonly refresh = new RefreshGuard();
  protected readonly hardware = new LoadedList<Hardware>(
    (id) => this.api.unassignedHardware(id),
    this.refresh.quietNetworkFailure((error) => this.handleError(error)),
  );
  protected readonly found = computed<readonly Found[]>(() =>
    this.hardware.items().map((item) => {
      const kind = deviceKind(item.capabilities);
      const main = primaryCapability(item.capabilities);
      return {
        item,
        kind,
        icon: ICONS[kind],
        reading: readingValue(main, main ? item.lastState[main.key] : undefined, this.locale()),
      };
    }),
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
