import { Component, inject } from '@angular/core';
import type { Meta, StoryObj } from '@storybook/angular';
import { expect } from 'storybook/test';
import { waitForTranslations } from '../testing/storybook-environment';
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
    context.timeZone.set('Europe/Berlin');
  }
}

const meta: Meta<TimeDemo> = { title: 'Inhalt/Zeitangaben', component: TimeDemo };
export default meta;

/** The toolbar's language drives the formatting; the second test-runner pass runs in English. */
const EXPECTED = {
  de: { medium: '25.10.2026, 02:30', relative: 'vor 5 Minuten' },
  en: { medium: 'Oct 25, 2026, 2:30 AM', relative: '5 minutes ago' },
} as const;

export const Berlin: StoryObj<TimeDemo> = {
  play: async ({ canvas }) => {
    await waitForTranslations();
    const expected = EXPECTED[document.documentElement.lang === 'en' ? 'en' : 'de'];
    await expect(canvas.getByTestId('medium')).toHaveTextContent(expected.medium);
    await expect(canvas.getByText(expected.relative)).toBeVisible();
  },
};
