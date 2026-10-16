import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { UiButton } from '../button/button';
import { UiStatusEntry } from '../status-hero/status-entry';
import { UiSwitch } from '../switch/switch';
import { UiBottomSheet } from './bottom-sheet';
import { UiSheet, UiSheetActions } from './sheet';
import { UI_SHEET_DATA, UiSheetRef } from './sheet-ref';

/** What the opener hands to the content, and what the content hands back. */
export interface SheetStoryData {
  readonly blocks: readonly { readonly id: string; readonly name: string }[];
}

/**
 * Storybook only: the content of a sheet as a feature would write it, with the frame, two
 * rows and the actions "Zurücksetzen" and "Fertig".
 */
@Component({
  selector: 'ui-sheet-story-content',
  imports: [UiSheet, UiSheetActions, UiButton, UiStatusEntry, UiSwitch],
  templateUrl: './sheet-content.story-component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SheetStoryContent {
  protected readonly data = inject<SheetStoryData>(UI_SHEET_DATA);
  protected readonly ref = inject<UiSheetRef<'saved' | 'reset'>>(UiSheetRef);
}

/** Storybook only: a button that opens the content through `UiBottomSheet` and shows the result. */
@Component({
  selector: 'ui-sheet-story-opener',
  imports: [UiButton],
  templateUrl: './sheet-opener.story-component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SheetStoryOpener {
  private readonly sheet = inject(UiBottomSheet);
  protected readonly result = signal('');

  protected async open(): Promise<void> {
    const data: SheetStoryData = {
      blocks: [
        { id: 'status', name: 'Status' },
        { id: 'devices', name: 'Geräte' },
      ],
    };
    const result = await this.sheet.open<SheetStoryContent, SheetStoryData, 'saved' | 'reset'>(
      SheetStoryContent,
      data,
    );
    this.result.set(result ?? 'verworfen');
  }
}
