import { TestBed } from '@angular/core/testing';
import { EXPANDED } from '../adaptive-shell/adaptive-shell';
import { MEDIA_QUERIES } from '../theme/media-queries';
import { FakeMediaQueries } from '../theme/testing/fake-media-queries';
import { UiSkeleton } from './skeleton';

function render(variant: 'text' | 'block' | 'circle' | 'chart', media = new FakeMediaQueries()) {
  TestBed.configureTestingModule({ providers: [{ provide: MEDIA_QUERIES, useValue: media }] });
  const fixture = TestBed.createComponent(UiSkeleton);
  fixture.componentRef.setInput('variant', variant);
  fixture.detectChanges();
  return { fixture, host: fixture.nativeElement as HTMLElement };
}

describe('UiSkeleton', () => {
  it('is hidden from assistive technology and renders the lines asked for', () => {
    const { fixture, host } = render('text');
    expect(host.getAttribute('aria-hidden')).toBe('true');
    fixture.componentRef.setInput('lines', 3);
    fixture.detectChanges();
    expect(host.querySelectorAll('.line')).toHaveLength(3);
  });

  it('stands in for a chart at its height, the large one from the Expanded window class', () => {
    const media = new FakeMediaQueries();
    const { fixture, host } = render('chart', media);
    expect(host.getAttribute('data-variant')).toBe('chart');
    expect(host.querySelector('.shape')).not.toBeNull();
    expect(host.hasAttribute('data-large')).toBe(false);
    media.emit(EXPANDED, true);
    fixture.detectChanges();
    expect(host.hasAttribute('data-large')).toBe(true);
  });
});
