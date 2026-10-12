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

describe('UiCard', () => {
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
