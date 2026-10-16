import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UiTopAppBar, UiTopAppBarActions } from './top-app-bar';

@Component({
  imports: [UiTopAppBar, UiTopAppBarActions],
  template: `<ui-top-app-bar heading="Haus Sonnenweg">
    <button uiTopAppBarActions type="button">Aktion</button>
  </ui-top-app-bar>`,
})
class Host {}

describe('UiTopAppBar', () => {
  it('renders the title as text, not as a heading', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]')).toBeNull();
    expect(element.querySelector('.title')?.textContent?.trim()).toBe('Haus Sonnenweg');
  });

  it('projects the actions', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const actions = (fixture.nativeElement as HTMLElement).querySelector('.actions button');
    expect(actions?.textContent).toBe('Aktion');
  });
});

@Component({
  imports: [UiTopAppBar],
  template: `<ui-top-app-bar heading="Unser Zuhause" [size]="size()" />`,
})
class SizeHost {
  readonly size = signal<'small' | 'large'>('small');
}

describe('UiTopAppBar sizes', () => {
  it('is small by default and exposes the large size for the styles', () => {
    const fixture = TestBed.createComponent(SizeHost);
    fixture.detectChanges();
    const host = fixture.nativeElement.querySelector('ui-top-app-bar') as HTMLElement;
    expect(host.getAttribute('data-size')).toBe('small');
    fixture.componentInstance.size.set('large');
    fixture.detectChanges();
    expect(host.getAttribute('data-size')).toBe('large');
    expect(host.querySelector('.title')?.textContent?.trim()).toBe('Unser Zuhause');
    expect(host.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]')).toBeNull();
  });
});
