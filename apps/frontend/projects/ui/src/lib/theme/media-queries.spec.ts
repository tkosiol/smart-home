import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MEDIA_QUERIES, mediaQuerySignal } from './media-queries';
import { FakeMediaQueries } from './testing/fake-media-queries';

const WIDE = '(min-width: 600px)';

@Component({ template: '' })
class Host {
  readonly wide = mediaQuerySignal(WIDE);
}

function render(media: FakeMediaQueries) {
  TestBed.configureTestingModule({ providers: [{ provide: MEDIA_QUERIES, useValue: media }] });
  return TestBed.createComponent(Host);
}

describe('mediaQuerySignal', () => {
  it('starts with whether the query matches now', () => {
    expect(render(new FakeMediaQueries({ [WIDE]: true })).componentInstance.wide()).toBe(true);
  });

  it('follows changes of the query', () => {
    const media = new FakeMediaQueries();
    const host = render(media).componentInstance;
    expect(host.wide()).toBe(false);
    media.emit(WIDE, true);
    expect(host.wide()).toBe(true);
    media.emit(WIDE, false);
    expect(host.wide()).toBe(false);
  });

  it('stops listening when its owner is destroyed', () => {
    const media = new FakeMediaQueries();
    const fixture = render(media);
    expect(media.listenerCount(WIDE)).toBe(1);
    fixture.destroy();
    expect(media.listenerCount(WIDE)).toBe(0);
  });
});
