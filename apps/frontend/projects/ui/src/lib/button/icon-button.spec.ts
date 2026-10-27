import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { UiIconButton } from './icon-button';

@Component({
  imports: [UiIconButton],
  template: `<ui-icon-button
    icon="close"
    label="Schließen"
    [disabled]="disabled()"
    (pressed)="count.set(count() + 1)"
  />`,
})
class Host {
  readonly disabled = signal(false);
  readonly count = signal(0);
}

describe('UiIconButton', () => {
  it('is a native button without Material parts', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('button')!.classList).toContain('ui-icon-button');
    expect(element.querySelector('[class*="mat-"], [class*="mdc-"]')).toBeNull();
  });

  it('keeps a disabled button out of the tab order', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.disabled.set(true);
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    button.focus();
    expect(document.activeElement).not.toBe(button);
  });
  it('names the button with its label and emits pressed', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe('Schließen');
    button.click();
    expect(fixture.componentInstance.count()).toBe(1);
  });

  it('does not emit when disabled', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.disabled.set(true);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();
    expect(fixture.componentInstance.count()).toBe(0);
  });
});

@Component({
  imports: [UiIconButton],
  template: `<ui-icon-button icon="table_rows" label="Tabelle" [toggled]="on()" />
    <ui-icon-button icon="close" label="Plain" />`,
})
class ToggleHost {
  readonly on = signal(false);
}

describe('UiIconButton as a toggle', () => {
  it('reports aria-pressed only when it is given a state', () => {
    const fixture = TestBed.createComponent(ToggleHost);
    fixture.detectChanges();
    const [toggle, plain] = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    );
    expect(toggle!.getAttribute('aria-pressed')).toBe('false');
    expect(plain!.hasAttribute('aria-pressed')).toBe(false);
    fixture.componentInstance.on.set(true);
    fixture.detectChanges();
    expect(toggle!.getAttribute('aria-pressed')).toBe('true');
  });
});

@Component({
  imports: [UiIconButton],
  template: `<ui-icon-button
    icon="notifications"
    label="Benachrichtigungen"
    [route]="route()"
    (pressed)="count.set(count() + 1)"
  />`,
})
class LinkHost {
  readonly route = signal<string | undefined>('/mehr');
  readonly count = signal(0);
}

describe('UiIconButton as a link', () => {
  function renderLink() {
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: 'mehr', children: [] }])],
    });
    const fixture = TestBed.createComponent(LinkHost);
    fixture.detectChanges();
    return fixture;
  }

  it('renders a named anchor with the icon when it has a route', () => {
    const fixture = renderLink();
    const element = fixture.nativeElement as HTMLElement;
    const link = element.querySelector('a[href="/mehr"]') as HTMLAnchorElement;
    expect(link.getAttribute('aria-label')).toBe('Benachrichtigungen');
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
    expect(element.querySelector('button')).not.toBeNull();
  });
});

@Component({
  imports: [UiIconButton],
  template: `<ui-icon-button icon="close" label="Schließen"
    ><b class="custom">x</b></ui-icon-button
  >`,
})
class ContentHost {}

describe('UiIconButton content', () => {
  it('shows projected content instead of the plain icon', () => {
    const fixture = TestBed.createComponent(ContentHost);
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(button.querySelector('.custom')).not.toBeNull();
    expect(button.querySelector('ui-icon')).toBeNull();
  });
});

@Component({
  imports: [UiIconButton],
  template: `<ui-icon-button icon="settings" label="Einstellungen" [variant]="variant()" />`,
})
class VariantHost {
  readonly variant = signal<'standard' | 'tonal'>('standard');
}

describe('UiIconButton variants', () => {
  it('is standard by default and exposes the tonal variant for the styles', () => {
    const fixture = TestBed.createComponent(VariantHost);
    fixture.detectChanges();
    const host = fixture.nativeElement.querySelector('ui-icon-button') as HTMLElement;
    expect(host.getAttribute('data-variant')).toBe('standard');
    fixture.componentInstance.variant.set('tonal');
    fixture.detectChanges();
    expect(host.getAttribute('data-variant')).toBe('tonal');
    expect(host.querySelector('button')?.getAttribute('aria-label')).toBe('Einstellungen');
  });
});
