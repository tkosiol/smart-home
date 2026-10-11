import { Component, inject } from '@angular/core';
import type { Meta, StoryObj } from '@storybook/angular';
import { expect } from 'storybook/test';
import { UiDateTimePipe } from './date-time.pipe';
import { UiFormatContext } from './format-context';
import { UiRelativeTimePipe } from './relative-time.pipe';

@Component({
  selector: 'ui-time-demo',
  imports: [UiDateTimePipe, UiRelativeTimePipe],
  template: ` <dl>
    <dt>Mittel</dt>
    <dd data-testid="medium">{{ at | uiDateTime }}</dd>
    <dt>Kurz</dt>
    <dd>{{ at | uiDateTime: 'short' }}</dd>
    <dt>Datum</dt>
    <dd>{{ at | uiDateTime: 'date' }}</dd>
    <dt>Uhrzeit</dt>
    <dd>{{ at | uiDateTime: 'time' }}</dd>
    <dt>Relativ</dt>
    <dd>{{ recent | uiRelativeTime }}</dd>
  </dl>`,
})
class TimeDemo {
  protected readonly at = '2026-10-25T01:30:00Z';
  protected readonly recent = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  constructor() {
    const context = inject(UiFormatContext);
    context.locale.set('de');
    context.timeZone.set('Europe/Berlin');
  }
}

const meta: Meta<TimeDemo> = { title: 'Inhalt/Zeitangaben', component: TimeDemo };
export default meta;

export const Berlin: StoryObj<TimeDemo> = {
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId('medium')).toHaveTextContent('25.10.2026, 02:30');
    await expect(canvas.getByText('vor 5 Minuten')).toBeVisible();
  },
};
