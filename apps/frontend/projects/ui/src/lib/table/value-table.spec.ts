import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EXPANDED } from '../adaptive-shell/adaptive-shell';
import { MEDIA_QUERIES } from '../theme/media-queries';
import { FakeMediaQueries } from '../theme/testing/fake-media-queries';
import { UiValueTable, type UiTableColumn, type UiTableRow } from './value-table';

@Component({
  imports: [UiValueTable],
  template: `<ui-value-table
    [columns]="columns()"
    [rows]="rows()"
    label="Bodenfeuchte, letzte 4 Wochen"
  />`,
})
class Host {
  readonly columns = signal<UiTableColumn[]>([
    { label: 'Tag' },
    { label: 'Mittel' },
    { label: 'Tief–Hoch' },
  ]);
  readonly rows = signal<UiTableRow[]>([
    { key: '2026-10-27', cells: ['Di., 27. Okt.', '43 %', '42–45 %'] },
    {
      key: '2026-10-26',
      cells: ['Mo., 26. Okt.', '30 %', '20–56 %'],
      note: 'zeitweise zu trocken · gegossen',
    },
  ]);
}

function render(media = new FakeMediaQueries()) {
  TestBed.configureTestingModule({ providers: [{ provide: MEDIA_QUERIES, useValue: media }] });
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  return fixture;
}

const texts = (fixture: { nativeElement: HTMLElement }, selector: string) =>
  [...fixture.nativeElement.querySelectorAll(selector)].map((cell) =>
    cell.textContent?.replace(/\s+/g, ' ').trim(),
  );

describe('UiValueTable', () => {
  it('renders the columns as the header row and a row per entry', () => {
    const fixture = render();
    expect(texts(fixture, 'thead th')).toEqual(['Tag', 'Mittel', 'Tief–Hoch']);
    expect(fixture.nativeElement.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(texts(fixture, 'tbody tr:first-child td')).toEqual(['Di., 27. Okt.', '43 %', '42–45 %']);
  });

  it('puts a note on the second line of the first cell only', () => {
    const fixture = render();
    const notes = fixture.nativeElement.querySelectorAll('.note') as NodeListOf<HTMLElement>;
    expect(notes).toHaveLength(1);
    expect(notes[0]!.textContent).toBe('zeitweise zu trocken · gegossen');
    expect(notes[0]!.closest('td')).toBe(
      fixture.nativeElement.querySelector('tbody tr:last-child td:first-child'),
    );
  });

  it('starts the first column and ends the others unless a column says otherwise', () => {
    const fixture = render();
    const aligns = () =>
      [...fixture.nativeElement.querySelectorAll('thead th')].map((th) =>
        th.getAttribute('data-align'),
      );
    expect(aligns()).toEqual(['start', 'end', 'end']);
    expect(
      [...fixture.nativeElement.querySelectorAll('tbody tr:first-child td')].map((td) =>
        td.getAttribute('data-align'),
      ),
    ).toEqual(['start', 'end', 'end']);
    fixture.componentInstance.columns.set([{ label: 'Zeit' }, { label: 'Text', align: 'start' }]);
    fixture.detectChanges();
    expect(aligns()).toEqual(['start', 'start']);
  });

  it('is a named group the keyboard can scroll', () => {
    const fixture = render();
    const region = fixture.nativeElement.querySelector('[role="group"]') as HTMLElement;
    expect(region.getAttribute('aria-label')).toBe('Bodenfeuchte, letzte 4 Wochen');
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(region.querySelector('table')).not.toBeNull();
  });

  it('follows the Expanded window class like the chart', () => {
    const media = new FakeMediaQueries();
    const fixture = render(media);
    const host = fixture.nativeElement.querySelector('ui-value-table') as HTMLElement;
    expect(host.hasAttribute('data-large')).toBe(false);
    media.emit(EXPANDED, true);
    fixture.detectChanges();
    expect(host.hasAttribute('data-large')).toBe(true);
  });
});
