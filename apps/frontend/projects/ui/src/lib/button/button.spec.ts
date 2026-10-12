import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { UiButton } from './button';

@Component({
  imports: [UiButton],
  template: ` <form (submit)="submitted.set(true); $event.preventDefault()">
    <ui-button [disabled]="disabled()" [type]="type()" (pressed)="count.set(count() + 1)"
      >Speichern</ui-button
    >
  </form>`,
})
class Host {
  readonly disabled = signal(false);
  readonly type = signal<'button' | 'submit'>('button');
  readonly count = signal(0);
  readonly submitted = signal(false);
}

function render() {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
  return { fixture, button, host: fixture.componentInstance };
}

describe('UiButton', () => {
  it('emits pressed on click', () => {
    const { button, host } = render();
    button.click();
    expect(host.count()).toBe(1);
  });

  it('does not emit or submit when disabled', () => {
    const { fixture, button, host } = render();
    host.disabled.set(true);
    host.type.set('submit');
    fixture.detectChanges();
    button.click();
    expect(button.disabled).toBe(true);
    expect(host.count()).toBe(0);
    expect(host.submitted()).toBe(false);
  });

  it('is a plain button by default and submits only as type submit', () => {
    const { fixture, button, host } = render();
    expect(button.type).toBe('button');
    host.type.set('submit');
    fixture.detectChanges();
    button.click();
    expect(host.submitted()).toBe(true);
  });
});

@Component({
  imports: [UiButton],
  template: `<ui-button [route]="route()" icon="add" (pressed)="count.set(count() + 1)"
    >Räume</ui-button
  >`,
})
class LinkHost {
  readonly route = signal<string | undefined>('/raeume');
  readonly count = signal(0);
}

describe('UiButton as a link', () => {
  function renderLink() {
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: 'raeume', children: [] }])],
    });
    const fixture = TestBed.createComponent(LinkHost);
    fixture.detectChanges();
    return fixture;
  }

  it('renders an anchor with text and icon when it has a route', () => {
    const fixture = renderLink();
    const element = fixture.nativeElement as HTMLElement;
    const link = element.querySelector('a[href="/raeume"]') as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.textContent).toContain('Räume');
    expect(link.querySelector('ui-icon')).not.toBeNull();
    expect(element.querySelector('button')).toBeNull();
  });

  it('does not emit pressed', async () => {
    const fixture = renderLink();
    (fixture.nativeElement.querySelector('a') as HTMLAnchorElement).click();
    await fixture.whenStable();
    expect(fixture.componentInstance.count()).toBe(0);
  });

  it('is a button without a route', () => {
    const fixture = renderLink();
    fixture.componentInstance.route.set(undefined);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('a')).toBeNull();
    expect(element.querySelector('button')?.textContent).toContain('Räume');
  });
});
