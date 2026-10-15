import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { OverviewLayout } from '@smart/contracts';
import {
  UI_SHEET_DATA,
  UiButton,
  UiSheet,
  UiSheetActions,
  UiSheetRef,
  UiStatusEntry,
} from '@smart/ui';
import { UiReorderList, UiReorderRow, UiSwitch } from '@smart/ui/forms';
import type { IconName } from '@smart/ui/shell';
import { provideDashboardTexts } from './dashboard-texts';

/** One block of the sheet: what the registry says about it and what the user has chosen. */
export interface CustomizeBlock {
  readonly id: string;
  readonly labelKey: string;
  readonly descriptionKey: string;
  readonly icon: IconName;
  readonly visible: boolean;
}

export interface CustomizeData {
  /** In the order of the current layout. */
  readonly blocks: readonly CustomizeBlock[];
}

/** "Fertig" hands back the new layout, "Zurücksetzen" asks to delete the stored one. */
export type CustomizeResult =
  { readonly kind: 'save'; readonly layout: OverviewLayout } | { readonly kind: 'reset' };

/** A row of the reorder list: the block plus the texts that name its handle and its move. */
interface Row extends CustomizeBlock {
  readonly name: string;
  readonly label: string;
}

/**
 * The content of "Übersicht anpassen" (spec 3.5): the blocks with a drag handle and a switch.
 * Nothing is saved while the user edits; only "Fertig" hands the layout back, closing the sheet any
 * other way discards the changes. The sheet lives outside the page's injector, so it provides the
 * dashboard texts itself.
 */
@Component({
  selector: 'app-customize-sheet',
  imports: [
    TranslocoPipe,
    UiButton,
    UiReorderList,
    UiReorderRow,
    UiSheet,
    UiSheetActions,
    UiStatusEntry,
    UiSwitch,
  ],
  providers: [provideDashboardTexts()],
  template: `
    <ui-sheet
      [heading]="'app.overview.customize' | transloco"
      [description]="'dashboard.customize.description' | transloco"
    >
      <ui-reorder-list [items]="rows" (reordered)="order.set($event)">
        <ng-template [uiReorderRow]="rows" let-row>
          <ui-status-entry
            [icon]="row.icon"
            kindTone="primary-container"
            [title]="row.name"
            [subtitle]="row.descriptionKey | transloco"
          >
            <ui-switch
              [label]="'dashboard.customize.show' | transloco: { name: row.name }"
              [checked]="visible()[row.id] ?? false"
              (checkedChange)="setVisible(row.id, $event)"
            />
          </ui-status-entry>
        </ng-template>
      </ui-reorder-list>
      <div uiSheetActions>
        <ui-button variant="text" (pressed)="reset()">{{
          'dashboard.customize.reset' | transloco
        }}</ui-button>
        <ui-button (pressed)="done()">{{ 'dashboard.customize.done' | transloco }}</ui-button>
      </div>
    </ui-sheet>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomizeSheet {
  private readonly data = inject<CustomizeData>(UI_SHEET_DATA);
  private readonly ref = inject<UiSheetRef<CustomizeResult>>(UiSheetRef);

  /** The rows never change while the sheet is open: the list keeps the order the user sets. */
  protected readonly rows: readonly Row[];
  protected readonly order = signal<readonly string[]>(this.data.blocks.map((block) => block.id));
  protected readonly visible = signal<Readonly<Record<string, boolean>>>(
    Object.fromEntries(this.data.blocks.map((block) => [block.id, block.visible])),
  );

  constructor() {
    // Root texts only: they are there whenever the sheet opens.
    const transloco = inject(TranslocoService);
    this.rows = this.data.blocks.map((block) => {
      const name = transloco.translate(block.labelKey);
      return {
        ...block,
        name,
        label: transloco.translate('app.overview.move', { name }),
      };
    });
  }

  protected setVisible(id: string, visible: boolean): void {
    this.visible.update((current) => ({ ...current, [id]: visible }));
  }

  protected done(): void {
    const visible = this.visible();
    this.ref.close({
      kind: 'save',
      layout: { blocks: this.order().map((id) => ({ id, visible: visible[id] ?? false })) },
    });
  }

  protected reset(): void {
    this.ref.close({ kind: 'reset' });
  }
}
