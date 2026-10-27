import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { APPEARANCE_STORE } from '../theme/appearance-store';
import { MemoryAppearanceStore } from '../theme/memory-appearance-store';
import { provideTheme } from '../theme/provide-theme';
import { THEME_ENGINE_LOADER } from '../theme/theme-engine';
import { ThemeService } from '../theme/theme.service';
import { provideUiTranslocoTesting } from '../testing/i18n-testing';
import { UiChart, type UiChartBand, type UiChartPoint } from './chart';
import { FakeChart } from './chart-testing';
import { ECHARTS_LOADER, type ChartEngine } from './echarts-loader';

const HOUR = 3_600_000;
const END = Date.parse('2026-10-27T12:00:00.000Z');
const at = (hoursAgo: number) => new Date(END - hoursAgo * HOUR).toISOString();

@Component({
  imports: [UiChart],
  template: `<ui-chart
    [points]="points()"
    [range]="'24h'"
    [resolutionMinutes]="60"
    timeZone="Europe/Berlin"
    unit="%"
    [band]="band()"
    [from]="from()"
    [to]="to()"
    label="Bodenfeuchte, 24 Stunden"
    description="Bodenfeuchte der letzten 24 Stunden: von 30 auf 24 %."
    (scrubbed)="scrubbed.push($event)"
  />`,
})
class Host {
  readonly points = signal<readonly UiChartPoint[]>([
    { t: at(5), value: 30 },
    { t: at(4), value: 28 },
    { t: at(1), value: 20 }, // gap before this point
    { t: at(0), value: 24 },
  ]);
  readonly band = signal<UiChartBand | null>(null);
  readonly from = signal<string | null>(null);
  readonly to = signal<string | null>(null);
  readonly scrubbed: (number | null)[] = [];
}

async function setup() {
  const chart = new FakeChart();
  let loads = 0;
  const loader = async (): Promise<ChartEngine> => {
    loads++;
    return { init: () => chart };
  };
  TestBed.configureTestingModule({
    providers: [
      provideUiTranslocoTesting('de'),
      provideTheme(),
      { provide: APPEARANCE_STORE, useValue: new MemoryAppearanceStore() },
      { provide: THEME_ENGINE_LOADER, useValue: () => new Promise(() => undefined) },
      { provide: ECHARTS_LOADER, useValue: loader },
    ],
  });
  const fixture = TestBed.createComponent(Host);
  const element = fixture.nativeElement as HTMLElement;
  const flush = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 30)); // the frame that reads the colours
    fixture.detectChanges();
    await fixture.whenStable();
  };
  return {
    fixture,
    chart,
    loads: () => loads,
    flush,
    host: () => element.querySelector('ui-chart') as HTMLElement,
    scrubbed: fixture.componentInstance.scrubbed,
  };
}

const key = (name: string) =>
  new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });

describe('UiChart', () => {
  it('is a named group with a role description and a text alternative', async () => {
    const { host, flush } = await setup();
    await flush();
    const group = host();
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-roledescription')).toBe('Diagramm');
    expect(group.getAttribute('aria-label')).toBe('Bodenfeuchte, 24 Stunden');
    const description = document.getElementById(group.getAttribute('aria-describedby')!)!;
    expect(description.textContent).toContain('von 30 auf 24 %');
    expect(group.getAttribute('tabindex')).toBe('0');
  });

  it('loads ECharts only after the first render and draws once the colours are read', async () => {
    const { fixture, loads, chart, flush } = await setup();
    expect(loads()).toBe(0);
    fixture.detectChanges();
    await flush();
    expect(loads()).toBe(1);
    expect(chart.options.at(-1)!['animation']).toBe(false);
    expect((chart.options.at(-1)!['series'] as unknown[]).length).toBe(1);
  });

  it('ends the time axis at the asked window instead of the last point', async () => {
    const { fixture, chart, flush } = await setup();
    await flush();
    expect((chart.options.at(-1)!['xAxis'] as { max: number }).max).toBe(END);
    const to = new Date(END + 5 * HOUR).toISOString();
    fixture.componentInstance.from.set(new Date(END - 19 * HOUR).toISOString());
    fixture.componentInstance.to.set(to);
    await flush();
    const axis = chart.options.at(-1)!['xAxis'] as { min: number; max: number };
    expect(axis.max).toBe(Date.parse(to));
    expect(axis.min).toBe(END - 19 * HOUR);
  });

  it('draws again when the theme changes, with the other colour scheme', async () => {
    // the washes differ by scheme only on a colour that can take an opacity
    document.documentElement.style.setProperty('--mat-sys-primary', 'rgb(0, 104, 122)');
    const { fixture, chart, flush } = await setup();
    await flush();
    const before = chart.options.length;
    const light = JSON.stringify(chart.options.at(-1));
    TestBed.inject(ThemeService).setPersonal({ mode: 'dark', contrast: 'system' });
    await flush();
    expect(chart.options.length).toBeGreaterThan(before);
    expect(JSON.stringify(chart.options.at(-1))).not.toBe(light);
    document.documentElement.style.removeProperty('--mat-sys-primary');
    fixture.destroy();
  });

  it('shows an empty text and draws no series without points', async () => {
    const { fixture, host, chart, flush } = await setup();
    fixture.componentInstance.points.set([]);
    await flush();
    expect(host().querySelector('.empty')?.textContent).toContain('Keine');
    expect(chart.options.at(-1)).toEqual({ series: [] });
  });

  it('reports the point under the pointer once and null when it leaves', async () => {
    const { chart, flush, scrubbed } = await setup();
    await flush();
    const near = (hoursAgo: number) => ({ axesInfo: [{ value: END - hoursAgo * HOUR }] });
    chart.emit('updateAxisPointer', near(4.2));
    chart.emit('updateAxisPointer', near(4.1));
    chart.emit('updateAxisPointer', near(0.2));
    chart.emit('globalout');
    chart.emit('globalout');
    expect(scrubbed).toEqual([1, 3, null]);
  });

  it('moves with the arrow keys from the last point and shows the tip of the right row', async () => {
    const { host, chart, flush, scrubbed } = await setup();
    await flush();
    host().dispatchEvent(key('ArrowLeft'));
    expect(scrubbed).toEqual([2]);
    // point 2 follows the gap filler, so its data row is 3
    expect(chart.actions.at(-1)).toEqual({ type: 'showTip', seriesIndex: 0, dataIndex: 3 });
    host().dispatchEvent(key('ArrowLeft'));
    host().dispatchEvent(key('ArrowLeft'));
    host().dispatchEvent(key('ArrowLeft'));
    expect(scrubbed).toEqual([2, 1, 0, 0]);
    host().dispatchEvent(key('ArrowRight'));
    expect(scrubbed.at(-1)).toBe(1);
  });

  it('starts at the last point, so ArrowRight stays there', async () => {
    const { host, flush, scrubbed } = await setup();
    await flush();
    host().dispatchEvent(key('ArrowRight'));
    expect(scrubbed).toEqual([3]);
  });

  it('jumps with Home and End and ends with Escape', async () => {
    const { host, chart, flush, scrubbed } = await setup();
    await flush();
    host().dispatchEvent(key('Home'));
    host().dispatchEvent(key('End'));
    host().dispatchEvent(key('Escape'));
    expect(scrubbed).toEqual([0, 3, null]);
    expect(chart.actions.at(-1)).toEqual({ type: 'hideTip' });
  });

  it('keeps other keys and prevents the page scroll only for the handled ones', async () => {
    const { host, flush, scrubbed } = await setup();
    await flush();
    const tab = key('Tab');
    host().dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
    const arrow = key('ArrowRight');
    host().dispatchEvent(arrow);
    expect(arrow.defaultPrevented).toBe(true);
    expect(scrubbed).toEqual([3]);
  });

  it('ends the scrub when the focus leaves', async () => {
    const { host, flush, scrubbed } = await setup();
    await flush();
    host().dispatchEvent(key('Home'));
    host().dispatchEvent(new FocusEvent('blur'));
    expect(scrubbed).toEqual([0, null]);
  });

  it('reports null when new points drop an active scrub, and stays quiet without one', async () => {
    const { fixture, host, flush, scrubbed } = await setup();
    await flush();
    fixture.componentInstance.points.update((points) => [...points]);
    await flush();
    expect(scrubbed).toEqual([]);
    host().dispatchEvent(key('Home'));
    fixture.componentInstance.points.update((points) => [...points]);
    await flush();
    expect(scrubbed).toEqual([0, null]);
  });

  it('disposes the chart with the component, also when it loads late', async () => {
    const { fixture, chart, flush } = await setup();
    await flush();
    fixture.destroy();
    expect(chart.disposed).toBe(true);
  });
});
