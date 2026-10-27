import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EXPANDED } from '../adaptive-shell/adaptive-shell';
import { MEDIA_QUERIES } from '../theme/media-queries';
import { FakeMediaQueries } from '../theme/testing/fake-media-queries';
import { UiFigure } from './figure';

@Component({
  imports: [UiFigure],
  template: `<ui-figure [caption]="caption()" [message]="message()">
    @if (message()) {
      <button type="button">Erneut versuchen</button>
    } @else {
      <div class="content">Diagramm</div>
    }
  </ui-figure>`,
})
class Host {
  readonly caption = signal<string | undefined>('Tief 20 % · Hoch 55 %');
  readonly message = signal<string | undefined>(undefined);
}

function render(media = new FakeMediaQueries()) {
  TestBed.configureTestingModule({ providers: [{ provide: MEDIA_QUERIES, useValue: media }] });
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  return fixture;
}

const element = (fixture: { nativeElement: HTMLElement }, selector: string) =>
  fixture.nativeElement.querySelector<HTMLElement>(selector);

describe('UiFigure', () => {
  it('shows its content as a figure with the caption below it', () => {
    const fixture = render();
    expect(element(fixture, 'figure .body .content')?.textContent).toBe('Diagramm');
    expect(element(fixture, 'figure figcaption')?.textContent).toBe('Tief 20 % · Hoch 55 %');
    expect(element(fixture, '.message')).toBeNull();
    expect(element(fixture, '.body--message')).toBeNull();
  });

  it('leaves the caption out when there is none', () => {
    const fixture = render();
    fixture.componentInstance.caption.set(undefined);
    fixture.detectChanges();
    expect(element(fixture, 'figcaption')).toBeNull();
  });

  it('shows a message where the chart would be, the content (an action) beneath it', () => {
    const fixture = render();
    fixture.componentInstance.message.set('Der Verlauf konnte nicht geladen werden.');
    fixture.detectChanges();
    const body = element(fixture, '.body--message')!;
    expect(body.querySelector('.message')?.textContent).toBe(
      'Der Verlauf konnte nicht geladen werden.',
    );
    expect(body.querySelector('.message + button')?.textContent).toBe('Erneut versuchen');
    fixture.componentInstance.message.set(undefined);
    fixture.detectChanges();
    expect(element(fixture, '.message')).toBeNull();
    expect(element(fixture, '.content')).not.toBeNull();
  });

  it('follows the Expanded window class like the chart', () => {
    const media = new FakeMediaQueries();
    const fixture = render(media);
    const host = element(fixture, 'ui-figure')!;
    expect(host.hasAttribute('data-large')).toBe(false);
    media.emit(EXPANDED, true);
    fixture.detectChanges();
    expect(host.hasAttribute('data-large')).toBe(true);
  });
});
