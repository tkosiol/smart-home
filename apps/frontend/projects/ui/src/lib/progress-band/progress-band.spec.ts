import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UiProgressBand, type UiProgressBandRange } from './progress-band';

@Component({
  imports: [UiProgressBand],
  template: `<ui-progress-band
    label="Bodenfeuchte"
    [value]="value()"
    [min]="min()"
    [max]="max()"
    [band]="band()"
    [valueText]="valueText()"
  />`,
})
class Host {
  readonly value = signal(18);
  readonly min = signal(0);
  readonly max = signal(100);
  readonly band = signal<UiProgressBandRange | null>({ from: 0, to: 25, tone: 'dry' });
  readonly valueText = signal('18 Prozent, zu trocken');
}

function render() {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  return fixture;
}

function meter(fixture: { nativeElement: HTMLElement }): HTMLElement {
  return fixture.nativeElement.querySelector('ui-progress-band')!;
}

describe('UiProgressBand', () => {
  it('is a named meter with its range, value and value text', () => {
    const element = meter(render());
    expect(element.getAttribute('role')).toBe('meter');
    expect(element.getAttribute('aria-label')).toBe('Bodenfeuchte');
    expect(element.getAttribute('aria-valuemin')).toBe('0');
    expect(element.getAttribute('aria-valuemax')).toBe('100');
    expect(element.getAttribute('aria-valuenow')).toBe('18');
    expect(element.getAttribute('aria-valuetext')).toBe('18 Prozent, zu trocken');
  });

  it('fills the share of the range the value covers', () => {
    const fixture = render();
    const fill = meter(fixture).querySelector('.fill') as HTMLElement;
    expect(fill.style.width).toBe('18%');
    fixture.componentInstance.min.set(10);
    fixture.componentInstance.max.set(30);
    fixture.detectChanges();
    expect(fill.style.width).toBe('40%');
  });

  it('keeps the value inside the range', () => {
    const fixture = render();
    fixture.componentInstance.value.set(140);
    fixture.detectChanges();
    expect(meter(fixture).getAttribute('aria-valuenow')).toBe('100');
    expect((meter(fixture).querySelector('.fill') as HTMLElement).style.width).toBe('100%');
    fixture.componentInstance.value.set(-5);
    fixture.detectChanges();
    expect(meter(fixture).getAttribute('aria-valuenow')).toBe('0');
    expect((meter(fixture).querySelector('.fill') as HTMLElement).style.width).toBe('0%');
  });

  it('marks the band in its tone and colours the fill like the band while the value is inside', () => {
    const fixture = render();
    const band = meter(fixture).querySelector('.band') as HTMLElement;
    expect(band.getAttribute('data-tone')).toBe('dry-container');
    expect(band.style.insetInlineStart).toBe('0%');
    expect(band.style.width).toBe('25%');
    expect(meter(fixture).querySelector('.fill')?.getAttribute('data-tone')).toBe('dry');
    fixture.componentInstance.value.set(46);
    fixture.detectChanges();
    expect(meter(fixture).querySelector('.fill')?.getAttribute('data-tone')).toBe('primary');
  });

  it('places an upper band at its start', () => {
    const fixture = render();
    fixture.componentInstance.band.set({ from: 60, to: 100, tone: 'wet' });
    fixture.componentInstance.value.set(70);
    fixture.detectChanges();
    const band = meter(fixture).querySelector('.band') as HTMLElement;
    expect(band.style.insetInlineStart).toBe('60%');
    expect(band.style.width).toBe('40%');
    expect(meter(fixture).querySelector('.fill')?.getAttribute('data-tone')).toBe('wet');
  });

  it('renders no band without one', () => {
    const fixture = render();
    fixture.componentInstance.band.set(null);
    fixture.detectChanges();
    expect(meter(fixture).querySelector('.band')).toBeNull();
    expect(meter(fixture).querySelector('.fill')?.getAttribute('data-tone')).toBe('primary');
  });
});
