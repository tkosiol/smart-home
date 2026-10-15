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
import { UiButton, UiCard, UiStack } from '@smart/ui';
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
  imports: [TranslocoPipe, UiButton, UiCard, UiStack, UiTextField],
  template: `
    <ui-card
      variant="filled"
      [heading]="'devices.thresholds.title' | transloco"
      [description]="'devices.thresholds.description' | transloco"
    >
      <form (submit)="save($event)" novalidate>
        <ui-stack gap="lg">
          @for (row of rows(); track row.key) {
            <ui-stack gap="sm">
              @if (canEdit()) {
                <ui-text-field
                  [name]="row.key"
                  autocomplete="off"
                  inputmode="decimal"
                  [label]="(row.labelKey | transloco) + ' (' + (row.unitKey | transloco) + ')'"
                  [hint]="'devices.thresholds.emptyHint' | transloco"
                  [error]="errors()[row.key] ? (errors()[row.key] ?? '' | transloco) : null"
                  [value]="texts()[row.key] ?? row.initial"
                  (valueChange)="type(row.key, $event)"
                />
              } @else {
                <p>
                  {{ row.labelKey | transloco }}:
                  @if (row.value === null) {
                    {{ 'devices.thresholds.off' | transloco }}
                  } @else {
                    {{ row.valueKey | transloco: { value: row.value } }}
                  }
                </p>
              }
              <p>
                @if (row.custom) {
                  {{
                    'devices.thresholds.state.custom'
                      | transloco
                        : {
                            standard:
                              row.standard === null
                                ? ('devices.thresholds.off' | transloco)
                                : (row.valueKey | transloco: { value: row.standard }),
                          }
                  }}
                } @else {
                  {{ 'devices.thresholds.state.standard' | transloco }}
                }
              </p>
            </ui-stack>
          }
          @if (canEdit()) {
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
          }
        </ui-stack>
      </form>
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

  protected readonly rows = computed(() => thresholdRows(this.device()));
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
    // Nothing changed: nothing to send.
    if (Object.keys(result.patch).length === 0) return Promise.resolve();
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
      this.saved.emit(device);
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) this.errors.set(rejectedErrors(patch));
      else this.handleError(error);
    } finally {
      this.busy.set(false);
    }
  }
}
