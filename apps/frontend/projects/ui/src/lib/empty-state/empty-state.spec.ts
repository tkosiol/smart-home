import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UiEmptyState } from './empty-state';

@Component({
  imports: [UiEmptyState],
  template: `<ui-empty-state icon="meeting_room" heading="Standard" />
    <ui-empty-state icon="meeting_room" heading="Zwei" [level]="2" />
    <ui-empty-state icon="meeting_room" heading="Drei" [level]="3" />`,
})
class Host {}

describe('UiEmptyState', () => {
  it('renders an h2 heading by default and follows the level', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const headings = (tag: string) =>
      [...element.querySelectorAll(tag)].map((heading) => heading.textContent?.trim());
    expect(headings('h2')).toEqual(['Standard', 'Zwei']);
    expect(headings('h3')).toEqual(['Drei']);
  });
});
