import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
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
