import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UiCard } from './card';

@Component({
  imports: [UiCard],
  template: `<ui-card heading="Standard">Inhalt</ui-card>
    <ui-card heading="Zwei" [level]="2">Inhalt</ui-card>
    <ui-card heading="Drei" [level]="3">Inhalt</ui-card>`,
})
class Host {}

@Component({
  imports: [UiCard],
  template: `<ui-card heading="Verlauf"><button uiCardHeaderAction>Aktion</button>Inhalt</ui-card>`,
})
class ActionHost {}

describe('UiCard', () => {
  it('puts an element marked uiCardHeaderAction into the header row, not the body', () => {
    const fixture = TestBed.createComponent(ActionHost);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('mat-card-header [uiCardHeaderAction]')).not.toBeNull();
    expect(element.querySelector('mat-card-content [uiCardHeaderAction]')).toBeNull();
  });

  it('renders an h3 heading by default and follows the level', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const headings = (tag: string) =>
      [...element.querySelectorAll(tag)].map((heading) => heading.textContent?.trim());
    expect(headings('h3')).toEqual(['Standard', 'Drei']);
    expect(headings('h2')).toEqual(['Zwei']);
  });
});
