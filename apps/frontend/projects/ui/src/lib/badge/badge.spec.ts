import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UiBadge } from './badge';

@Component({
  imports: [UiBadge],
  template: `<ui-badge [count]="count()"><span class="content">Glocke</span></ui-badge>`,
})
class Host {
  readonly count = signal(0);
}

describe('UiBadge', () => {
  function setup(count: number) {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.count.set(count);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    return { element, count: element.querySelector('.count') };
  }

  it('shows no number for 0 and keeps the projected content', () => {
    const { element, count } = setup(0);
    expect(count).toBeNull();
    expect(element.querySelector('.content')?.textContent).toBe('Glocke');
  });

  it('shows the number up to 99', () => {
    expect(setup(5).count?.textContent?.trim()).toBe('5');
  });

  it('caps larger numbers at 99+', () => {
    expect(setup(99).count?.textContent?.trim()).toBe('99');
    expect(setup(120).count?.textContent?.trim()).toBe('99+');
  });

  it('hides the number from assistive technology', () => {
    expect(setup(5).count?.getAttribute('aria-hidden')).toBe('true');
  });
});
