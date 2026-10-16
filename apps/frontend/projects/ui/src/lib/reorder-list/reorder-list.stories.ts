import { signal } from '@angular/core';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { applicationConfig, moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { expect, userEvent, waitFor } from 'storybook/test';
import type { IconName } from '../icon/icon-codepoints';
import { UiStatusEntry, type UiStatusEntryTone } from '../status-hero/status-entry';
import { UiSwitch } from '../switch/switch';
import { expectNoHorizontalOverflow, withPhoneFrame } from '../testing/story-helpers';
import { waitForTranslations } from '../testing/storybook-environment';
import { expectThemeMatrix } from '../testing/theme-matrix';
import { ThemeMatrixStoryComponent, UiMatrixCell } from '../testing/theme-matrix.story-component';
import { UiReorderList, UiReorderRow, type UiReorderItem } from './reorder-list';

/** A block of the overview (spec 3.5): the reorder item plus what its row shows. */
interface Block extends UiReorderItem {
  readonly icon: IconName;
  readonly tone: UiStatusEntryTone;
  readonly name: string;
  readonly description: string;
  readonly visible: boolean;
}

const blocks: readonly Block[] = [
  {
    id: 'status',
    label: 'Status verschieben',
    icon: 'info',
    tone: 'primary-container',
    name: 'Status',
    description: 'Was gerade Aufmerksamkeit braucht',
    visible: true,
  },
  {
    id: 'rooms',
    label: 'Räume verschieben',
    icon: 'meeting_room',
    tone: 'secondary-container',
    name: 'Räume',
    description: 'Alle Räume mit ihren Geräten',
    visible: true,
  },
  {
    id: 'devices',
    label: 'Geräte verschieben',
    icon: 'devices',
    tone: 'surface',
    name: 'Geräte',
    description: 'Alle Geräte als Pods',
    visible: false,
  },
  {
    id: 'gateway',
    label: 'Gateway verschieben',
    icon: 'router',
    tone: 'surface',
    name: 'Gateway',
    description: 'Verbindung und letzte Meldung',
    visible: false,
  },
];

const meta: Meta<UiReorderList<Block>> = {
  title: 'Bedienung/Sortierliste',
  component: UiReorderList,
  decorators: [
    applicationConfig({
      providers: [{ provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } }],
    }),
    moduleMetadata({ imports: [UiReorderRow, UiStatusEntry, UiSwitch] }),
  ],
};
export default meta;

/** Each row: handle, then a static `ui-status-entry` with a switch projected at its end. */
const list = `
  <ui-reorder-list [items]="blocks()" (reordered)="orders.update((o) => [...o, $event])">
    <ng-template [uiReorderRow]="blocks()" let-block>
      <ui-status-entry [icon]="block.icon" [kindTone]="block.tone" [title]="block.name" [subtitle]="block.description" style="flex: 1">
        <ui-switch [label]="block.name + ' anzeigen'" [checked]="block.visible" />
      </ui-status-entry>
    </ng-template>
  </ui-reorder-list>`;

const props = () => ({ blocks: signal(blocks), orders: signal<string[][]>([]) });

export const Bloecke: StoryObj<UiReorderList<Block>> = {
  render: () => ({ props: props(), template: `<div style="max-width: 420px">${list}</div>` }),
  play: async ({ canvas, canvasElement }) => {
    await waitForTranslations();
    await expect(canvas.getByRole('list')).toBeVisible();
    await expect(canvas.getAllByRole('listitem')).toHaveLength(4);
    const handles = canvas.getAllByRole('button', { name: /verschieben/ });
    await expect(handles).toHaveLength(4);
    for (const handle of handles) {
      const rect = handle.getBoundingClientRect();
      await expect(rect.width).toBeGreaterThanOrEqual(48);
      await expect(rect.height).toBeGreaterThanOrEqual(48);
    }
    await expect(canvas.getAllByRole('switch')).toHaveLength(4);
    // Keyboard: the focused handle moves its row with the arrow keys and keeps the focus.
    const names = () =>
      [...canvasElement.querySelectorAll('.title')].map((title) => title.textContent?.trim());
    await expect(names()).toEqual(['Status', 'Räume', 'Geräte', 'Gateway']);
    handles[0]!.focus();
    await userEvent.keyboard('{ArrowDown}');
    await waitFor(() => expect(names()).toEqual(['Räume', 'Status', 'Geräte', 'Gateway']));
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: 'Status verschieben' })).toHaveFocus(),
    );
    await userEvent.keyboard('{ArrowDown}');
    await waitFor(() => expect(names()).toEqual(['Räume', 'Geräte', 'Status', 'Gateway']));
    await userEvent.keyboard('{ArrowUp}{ArrowUp}');
    await waitFor(() => expect(names()).toEqual(['Status', 'Räume', 'Geräte', 'Gateway']));
  },
};

export const Schmal: StoryObj<UiReorderList<Block>> = {
  decorators: [withPhoneFrame],
  render: () => ({ props: props(), template: list }),
  play: async ({ canvasElement }) => {
    await waitForTranslations();
    await expectNoHorizontalOverflow(canvasElement.querySelector('.story-narrow')!);
  },
};

export const Kombinationen: StoryObj<UiReorderList<Block>> = {
  decorators: [moduleMetadata({ imports: [ThemeMatrixStoryComponent, UiMatrixCell] })],
  render: () => ({
    props: props(),
    template: `
      <ui-theme-matrix>
        <ng-template uiMatrixCell>
          <div style="padding: 8px; border-radius: var(--smart-shape-card); background: var(--mat-sys-surface-container-low)">${list}</div>
        </ng-template>
      </ui-theme-matrix>`,
  }),
  play: async ({ canvasElement }) => {
    await waitForTranslations();
    await expectThemeMatrix(canvasElement);
  },
};
