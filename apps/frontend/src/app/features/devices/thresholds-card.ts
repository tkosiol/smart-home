import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { Device, Thresholds } from '@smart/contracts';
import {
  UiButton,
  UiCard,
  UiFormatContext,
  UiGrid,
  UiList,
  UiListItem,
  UiStack,
  UiStatusChip,
} from '@smart/ui';
import { UiTextField } from '@smart/ui/forms';
import { ApiError } from '../../core/api';
import { HouseholdContext, injectHouseholdErrorHandler } from '../../core/household';
import { DevicesApi } from './devices.api';
import {
  customKeys,
  rejectedErrors,
  resetPatch,
  thresholdPatch,
  thresholdRows,
  type ThresholdKey,
} from './thresholds-model';

/**
 * The "Grenzwerte" of a device (spec 4.3): only the values that fit its capabilities, each marked
 * "Standard" or "Angepasst". Owners and members can change them (a text field per value; an empty
 * field means the standard) or set the changed ones back to the standard; a viewer only reads them.
 * A refusal by the server (400) shows at the fields that were sent.
 */
@Component({
  selector: 'app-thresholds-card',
  imports: [
    TranslocoPipe,
    UiButton,
    UiCard,
    UiGrid,
    UiList,
    UiListItem,
    UiStack,
    UiStatusChip,
    UiTextField,
  ],
  template: `
    <ui-card
      variant="low"
      [level]="2"
      [heading]="'devices.thresholds.title' | transloco"
      [description]="
        (canEdit() ? 'devices.thresholds.description' : 'devices.thresholds.descriptionReadOnly')
          | transloco
      "
    >
      @if (canEdit()) {
        <form (submit)="save($event)" novalidate>
          <ui-stack gap="lg">
            <ui-grid min="md" gap="lg">
              @for (row of rows(); track row.key) {
                <ui-stack gap="xs">
                  <ui-text-field
                    [name]="row.key"
                    autocomplete="off"
                    inputmode="decimal"
                    [label]="(row.labelKey | transloco) + ' (' + (row.unitKey | transloco) + ')'"
                    [describedBy]="stateId(row.key)"
                    [error]="errors()[row.key] ? (errors()[row.key] ?? '' | transloco) : null"
                    [value]="texts()[row.key] ?? row.initial"
                    (valueChange)="type(row.key, $event)"
                  />
                  <ui-stack direction="row" gap="sm" wrap>
                    <ui-status-chip
                      [attr.id]="stateId(row.key)"
                      [tone]="row.custom ? 'primary' : 'surface'"
                      [text]="
                        row.state.key
                          | transloco
                            : {
                                standard:
                                  row.state.standardKey | transloco: row.state.standardParams,
                              }
                      "
                    />
                  </ui-stack>
                </ui-stack>
              }
            </ui-grid>
            <ui-stack direction="row" gap="sm" wrap>
              <ui-button type="submit" [disabled]="busy()">{{
                'devices.thresholds.save' | transloco
              }}</ui-button>
              @if (custom().length > 0) {
                <ui-button variant="text" [disabled]="busy()" (pressed)="reset()">{{
                  'devices.thresholds.reset' | transloco
                }}</ui-button>
              }
            </ui-stack>
          </ui-stack>
        </form>
      } @else {
        <ui-list>
          @for (row of rows(); track row.key) {
            <ui-list-item
              [headline]="row.labelKey | transloco"
              [supporting]="
                row.state.key
                  | transloco
                    : { standard: row.state.standardKey | transloco: row.state.standardParams }
              "
              [trailingText]="
                row.value === null
                  ? (row.offKey | transloco)
                  : (row.valueKey | transloco: { value: row.value })
              "
            />
          }
        </ui-list>
      }
    </ui-card>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThresholdsCard {
  readonly device = input.required<Device>();
  /** Owners and members; a viewer only reads. */
  readonly canEdit = input(false);
  /** The device as the server returned it after a change. */
  readonly saved = output<Device>();

  private readonly api = inject(DevicesApi);
  private readonly household = inject(HouseholdContext);
  private readonly handleError = injectHouseholdErrorHandler();

  private readonly locale = inject(UiFormatContext).locale;
  protected readonly rows = computed(() => thresholdRows(this.device(), this.locale()));
  protected readonly custom = computed(() => customKeys(this.rows()));

  /** The device and its own thresholds; a refresh that brings the same values leaves it unchanged. */
  private readonly identity = computed(
    () => `${this.device().id}|${JSON.stringify(this.device().thresholds)}`,
  );
  private readonly deviceId = computed(() => this.device().id);

  // What was typed is kept across the minute's refresh: it starts again only when the device's own
  // thresholds change (after a save, or when someone else changed them).
  protected readonly texts = linkedSignal<string, Partial<Record<ThresholdKey, string>>>({
    source: this.identity,
    computation: () => ({}),
  });
  protected readonly errors = linkedSignal<unknown, Partial<Record<ThresholdKey, string>>>({
    source: () => [this.deviceId(), this.texts()],
    computation: () => ({}),
  });
  protected readonly busy = signal(false);

  /** The id of the chip that says whether a value is the standard; the field points at it. */
  protected stateId(key: ThresholdKey): string {
    return `threshold-state-${key}`;
  }

  protected type(key: ThresholdKey, text: string): void {
    this.texts.update((texts) => ({ ...texts, [key]: text }));
  }

  protected save(event: Event): Promise<void> {
    event.preventDefault();
    const result = thresholdPatch(this.device(), this.rows(), this.texts());
    if (!result.ok) {
      this.errors.set(result.errors);
      return Promise.resolve();
    }
    // Nothing changed: nothing to send, and the fields show the values in force again (an emptied
    // field that already showed the standard would otherwise stay empty).
    if (Object.keys(result.patch).length === 0) {
      this.texts.set({});
      return Promise.resolve();
    }
    return this.send(result.patch);
  }

  protected reset(): Promise<void> {
    return this.send(resetPatch(this.custom()));
  }

  private async send(patch: Thresholds): Promise<void> {
    const householdId = this.household.current()?.id;
    if (!householdId || this.busy()) return;
    const deviceId = this.device().id;
    this.busy.set(true);
    try {
      const device = await this.api.update(householdId, deviceId, { thresholds: patch });
      if (this.household.current()?.id !== householdId) return;
      this.texts.set({});
      this.saved.emit(device);
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) this.errors.set(rejectedErrors(patch));
      else this.handleError(error);
    } finally {
      this.busy.set(false);
    }
  }
}
