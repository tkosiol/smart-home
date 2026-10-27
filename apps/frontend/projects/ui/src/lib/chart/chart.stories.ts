import type { Meta, StoryObj } from '@storybook/angular';
import { expect, waitFor } from 'storybook/test';
import { expectNoHorizontalOverflow, withPhoneFrame } from '../testing/story-helpers';
import { UiChart, type UiChartPoint } from './chart';

const meta: Meta<UiChart> = {
  title: 'Inhalt/Diagramm',
  component: UiChart,
  args: {
    timeZone: 'Europe/Berlin',
    unit: '%',
    kind: 'area',
    markers: [],
    band: null,
    domain: null,
  },
};
export default meta;
type Story = StoryObj<UiChart>;

const NOW = Date.UTC(2026, 9, 27, 12, 32); // 14:32 in Berlin
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const BAND = { below: 25, label: 'zu trocken', valueLabel: '25 %' };

function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hourly soil moisture that dries out and is watered now and then. */
function soil(hours: number): { points: UiChartPoint[]; waterings: string[] } {
  const random = rng(3);
  const points: UiChartPoint[] = [];
  const waterings: string[] = [];
  let value = 34;
  for (let i = hours - 1; i >= 0; i--) {
    const t = NOW - i * HOUR;
    const hour = (new Date(t).getUTCHours() + 2) % 24;
    value -= (hour >= 8 && hour < 20 ? 0.27 : 0.14) * (0.9 + random() * 0.2);
    if (value < 23 && (hour === 8 || hour === 18)) {
      value = 55 + random() * 7;
      waterings.push(new Date(t).toISOString());
    }
    points.push({ t: new Date(t).toISOString(), value: Math.round(value * 10) / 10 });
  }
  return { points, waterings };
}

function temperature(days: number): UiChartPoint[] {
  const random = rng(11);
  return Array.from({ length: days }, (_, index) => {
    const t = NOW - (days - 1 - index) * DAY;
    const mean = 21.5 + 1.2 * Math.sin(index / 2.2) + random() * 0.3;
    return {
      t: new Date(t).toISOString(),
      value: Math.round(mean * 10) / 10,
      min: Math.round((mean - 1.8 - random() * 0.4) * 10) / 10,
      max: Math.round((mean + 2 + random() * 0.4) * 10) / 10,
    };
  });
}

/** Whole percent steps: 87 % for the first stretch, then 86, 85, 84. */
function battery(hours: number): UiChartPoint[] {
  return Array.from({ length: hours }, (_, index) => ({
    t: new Date(NOW - (hours - 1 - index) * HOUR).toISOString(),
    value: 87 - Math.floor((3.6 * index) / hours),
  }));
}

const fifteenMinutes = (hours: number): UiChartPoint[] => {
  const random = rng(5);
  return Array.from({ length: hours * 4 }, (_, index) => ({
    t: new Date(NOW - (hours * 4 - 1 - index) * 15 * 60_000).toISOString(),
    value: Math.round((38 - index * 0.04 + (random() - 0.5)) * 10) / 10,
  }));
};

/** The drawn SVG: ECharts loads lazily, so the stories wait for it. */
async function drawn(canvasElement: HTMLElement): Promise<SVGSVGElement> {
  await waitFor(() => expect(canvasElement.querySelector('ui-chart svg text')).not.toBeNull(), {
    timeout: 5000,
  });
  return canvasElement.querySelector('ui-chart svg')!;
}

/** Passes when the labels hold one of the spellings (the story runs in German and English). */
async function expectOne(labels: string[], spellings: string[]): Promise<void> {
  await expect(
    spellings.some((text) => labels.includes(text)),
    `one of ${spellings}`,
  ).toBe(true);
}

const labelsOf = (svg: SVGElement) =>
  [...svg.querySelectorAll('text')].map((node) =>
    (node.textContent ?? '').replace(/\u00a0/g, ' ').trim(),
  );

// On a card (the "Verlauf" card's surface): labels and dots carry halos in the card colour.
const template = `<div class="story-card" style="padding: 16px;
    background: var(--mat-sys-surface-container-low); border-radius: var(--smart-shape-card)">
  <ui-chart [points]="points" [kind]="kind" [range]="range"
    [resolutionMinutes]="resolutionMinutes" [timeZone]="timeZone" [unit]="unit" [domain]="domain"
    [band]="band" [markers]="markers" [from]="from" [to]="to" [label]="label" [description]="description" />
</div>`;

const week = soil(7 * 24);

export const Bodenfeuchte7Tage: Story = {
  args: {
    points: week.points,
    range: '7d',
    resolutionMinutes: 60,
    domain: { min: 0, max: 80 },
    band: BAND,
    markers: week.waterings,
    label: 'Bodenfeuchte, 7 Tage',
    description: 'Bodenfeuchte der letzten 7 Tage: Schwelle „zu trocken“ bei 25 %.',
  },
  render: (args) => ({ props: args, template }),
  play: async ({ canvasElement }) => {
    const svg = await drawn(canvasElement);
    const group = canvasElement.querySelector('ui-chart')!;
    await expect(group).toHaveAttribute('role', 'group');
    await waitFor(() =>
      expect(group.getAttribute('aria-roledescription')).toMatch(/^(Diagramm|Chart)$/),
    );
    await expect(group).toHaveAttribute('aria-label', 'Bodenfeuchte, 7 Tage');
    const labels = labelsOf(svg);
    await expect(labels).toContain('zu trocken');
    await expect(labels).toContain('25 %');
    await expectOne(labels, ['Heute', 'Today']);
    await expect(labels).toContain('50 %');
    await expect(group.getBoundingClientRect().height).toBe(
      matchMedia('(min-width: 840px)').matches ? 240 : 200,
    );
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const Tastatur: Story = {
  ...Bodenfeuchte7Tage,
  render: (args) => ({
    props: {
      ...args,
      scrubbed: (index: number | null) => (document.body.dataset['scrubbed'] = String(index)),
    },
    template: template.replace('/>', '(scrubbed)="scrubbed($event)" />'),
  }),
  play: async ({ canvasElement, userEvent }) => {
    await drawn(canvasElement);
    const group = canvasElement.querySelector<HTMLElement>('ui-chart')!;
    group.focus();
    await userEvent.keyboard('{ArrowLeft}');
    await waitFor(() =>
      expect(document.body.dataset['scrubbed']).toBe(String(week.points.length - 2)),
    );
    await userEvent.keyboard('{Home}');
    await waitFor(() => expect(document.body.dataset['scrubbed']).toBe('0'));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(document.body.dataset['scrubbed']).toBe('null'));
  },
};

export const Stunden24: Story = {
  args: {
    points: fifteenMinutes(24),
    range: '24h',
    resolutionMinutes: 15,
    label: 'Bodenfeuchte, 24 Stunden',
    description: 'Bodenfeuchte der letzten 24 Stunden.',
  },
  render: (args) => ({ props: args, template }),
  play: async ({ canvasElement }) => {
    const labels = labelsOf(await drawn(canvasElement));
    // German or English (the second theme pass of the test runner)
    await expectOne(labels, ['18 Uhr', '6 PM']);
    await expectOne(labels, ['0 Uhr', '12 AM']);
  },
};

const month = soil(28 * 24);

export const Wochen4: Story = {
  args: {
    points: month.points,
    range: '28d',
    resolutionMinutes: 60,
    domain: { min: 0, max: 80 },
    band: BAND,
    markers: month.waterings,
    label: 'Bodenfeuchte, 4 Wochen',
    description: 'Bodenfeuchte der letzten 4 Wochen.',
  },
  render: (args) => ({ props: args, template }),
  play: async ({ canvasElement }) => {
    const labels = labelsOf(await drawn(canvasElement));
    await expectOne(labels, ['Heute', 'Today']);
    await expectOne(labels, ['19. Okt.', 'Oct 19']);
  },
};

export const RibbonTemperatur: Story = {
  args: {
    points: temperature(28),
    kind: 'ribbon',
    unit: '°C',
    range: '28d',
    resolutionMinutes: 1440,
    label: 'Temperatur, 4 Wochen',
    description: 'Tagesmittel der Temperatur mit Spanne von Tief bis Hoch.',
  },
  render: (args) => ({ props: args, template }),
  play: async ({ canvasElement }) => {
    const svg = await drawn(canvasElement);
    await expect(svg.querySelectorAll('path').length).toBeGreaterThan(2);
  },
};

export const StufenBatterie: Story = {
  args: {
    points: battery(7 * 24),
    kind: 'step',
    range: '7d',
    resolutionMinutes: 60,
    label: 'Batterie, 7 Tage',
    description: 'Batterie der letzten 7 Tage, langsam fallend.',
  },
  render: (args) => ({ props: args, template }),
  play: async ({ canvasElement }) => {
    await drawn(canvasElement);
  },
};

export const Leer: Story = {
  args: {
    points: [],
    range: '7d',
    resolutionMinutes: 60,
    label: 'Bodenfeuchte, 7 Tage',
    description: 'Keine Messwerte im Zeitraum.',
  },
  render: (args) => ({ props: args, template }),
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(canvasElement.querySelector('.empty')?.textContent).toMatch(
        /Keine Verlaufsdaten|No history data/,
      ),
    );
  },
};

const withGap = soil(7 * 24).points.filter((_, index) => index < 70 || index > 110);

export const Luecke: Story = {
  args: {
    points: withGap,
    range: '7d',
    resolutionMinutes: 60,
    domain: { min: 0, max: 80 },
    band: BAND,
    label: 'Bodenfeuchte, 7 Tage, mit Lücke',
    description: 'Bodenfeuchte der letzten 7 Tage; zwischen Sonntag und Dienstag fehlen Messwerte.',
  },
  render: (args) => ({ props: args, template }),
  play: async ({ canvasElement }) => {
    await drawn(canvasElement);
  },
};

/** Readings far apart: no line reaches any of them, so each is drawn as a small dot. */
const lonely: UiChartPoint[] = [60, 50, 40, 30].map((hoursAgo, index) => ({
  t: new Date(NOW - hoursAgo * HOUR).toISOString(),
  value: 30 + index * 5,
}));

export const EinzelnePunkte: Story = {
  args: {
    points: lonely,
    range: '7d',
    resolutionMinutes: 60,
    from: new Date(NOW - 7 * DAY).toISOString(),
    to: new Date(NOW).toISOString(),
    domain: { min: 0, max: 80 },
    label: 'Bodenfeuchte, 7 Tage, einzelne Messwerte',
    description: 'Bodenfeuchte der letzten 7 Tage; vier einzelne Messwerte ohne Linie dazwischen.',
  },
  render: (args) => ({ props: args, template }),
  play: async ({ canvasElement }) => {
    const svg = await drawn(canvasElement);
    // a 6 px dot (the unit circle scaled by 3) per reading; the line series draws no symbols
    await waitFor(() => {
      const dots = [...svg.querySelectorAll('path[transform]')].filter(
        (path) =>
          path.getAttribute('fill') !== 'none' &&
          /^matrix\(3,0,0,3,/.test(path.getAttribute('transform') ?? ''),
      );
      return expect(dots).toHaveLength(lonely.length);
    });
  },
};

export const Schmal320: Story = {
  ...Bodenfeuchte7Tage,
  decorators: [withPhoneFrame],
  play: async ({ canvasElement }) => {
    const svg = await drawn(canvasElement);
    // narrow: the weekday instead of "Today"
    await expect(labelsOf(svg)).not.toContain('Heute');
    await expect(labelsOf(svg)).not.toContain('Today');
    await expectNoHorizontalOverflow(canvasElement.querySelector('.story-narrow')!);
  },
};
