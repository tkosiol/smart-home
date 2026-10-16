import { TestBed } from '@angular/core/testing';
import { UiPage } from './page';

function render(inputs: Record<string, unknown>) {
  const fixture = TestBed.createComponent(UiPage);
  for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('UiPage', () => {
  it('shows the heading with its description', () => {
    const page = render({ heading: 'Darstellung', description: 'So sieht die App aus.' });
    const heading = page.querySelector('h1');
    expect(heading?.textContent?.trim()).toBe('Darstellung');
    expect(heading?.classList.contains('heading--hidden')).toBe(false);
    expect(page.querySelector('.description')?.textContent?.trim()).toBe('So sieht die App aus.');
  });

  it('keeps the heading for screen readers only with headingHidden', () => {
    const page = render({
      heading: 'Übersicht',
      description: 'Wird nicht gezeigt.',
      headingHidden: true,
    });
    const heading = page.querySelector('h1');
    expect(heading?.textContent?.trim()).toBe('Übersicht');
    expect(heading?.classList.contains('heading--hidden')).toBe(true);
    expect(heading?.getAttribute('tabindex')).toBe('-1');
    expect(page.querySelector('.header')).toBeNull();
    expect(page.querySelector('.description')).toBeNull();
  });

  it('accepts headingHidden as a bare attribute', () => {
    const page = render({ heading: 'Übersicht', headingHidden: '' });
    expect(page.querySelector('h1')?.classList.contains('heading--hidden')).toBe(true);
  });

  it('renders no heading without a text', () => {
    expect(render({ headingHidden: true }).querySelector('h1')).toBeNull();
  });
});
