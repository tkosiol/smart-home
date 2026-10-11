import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UiClock } from './clock';
import { UiDateTimePipe } from './date-time.pipe';
import { UiFormatContext } from './format-context';
import { UiRelativeTimePipe } from './relative-time.pipe';

@Component({
  imports: [UiDateTimePipe, UiRelativeTimePipe],
  template: `<span id="abs">{{ at | uiDateTime }}</span
    ><span id="rel">{{ at | uiRelativeTime }}</span>`,
})
class Host {
  readonly at = '2026-10-11T12:00:00Z';
}

function setup() {
  const now = signal(Date.parse('2026-10-11T12:05:00Z'));
  TestBed.configureTestingModule({ providers: [{ provide: UiClock, useValue: { now } }] });
  const context = TestBed.inject(UiFormatContext);
  context.locale.set('de');
  context.timeZone.set('Europe/Berlin');
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const text = (id: string) =>
    (fixture.nativeElement.querySelector(`#${id}`) as HTMLElement).textContent;
  return { fixture, now, context, text };
}

describe('time pipes', () => {
  it('format in the context time zone and locale', () => {
    const { text } = setup();
    expect(text('abs')).toBe('11.10.2026, 14:00');
    expect(text('rel')).toBe('vor 5 Minuten');
  });

  it('follow changes of time zone and locale', () => {
    const { fixture, context, text } = setup();
    context.timeZone.set('Pacific/Chatham');
    context.locale.set('en');
    fixture.detectChanges();
    expect(text('abs')).toMatch(/^Oct 12, 2026, 1:45\sAM$/);
    expect(text('rel')).toBe('5 minutes ago');
  });

  it('update the relative time as the clock ticks', () => {
    const { fixture, now, text } = setup();
    now.set(Date.parse('2026-10-11T15:00:00Z'));
    fixture.detectChanges();
    expect(text('rel')).toBe('vor 3 Stunden');
  });
});
