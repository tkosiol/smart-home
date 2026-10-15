import { toSignal } from '@angular/core/rxjs-interop';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  linkedSignal,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { hasRole, type AttentionKind } from '@smart/contracts';
import {
  UiButton,
  UiCard,
  UiEmptyState,
  UiFormatContext,
  UiPage,
  UiRelativeTimePipe,
  UiSection,
  UiStack,
  UiStatusEntry,
} from '@smart/ui';
import { UiChipSet, type UiChipOption } from '@smart/ui/forms';
import { HouseholdContext } from '../../core/household';
import { injectAttention } from './attention';
import { entryRoute } from './attention-entries';
import {
  SEVERITY_FILTER_KEYS,
  filterAttention,
  filterCounts,
  groupTitleKey,
  kindsFromParam,
  sectionsOf,
  type SeverityFilter,
} from './attention-page-model';

/**
 * "Alle Hinweise" (spec 3.4): every open notice, a section per severity with a card per kind and an
 * entry per notice that leads to its device or gateway. Chips filter by severity and by kind
 * (several at once); `?art=<kind>` preselects kinds, as the groups of the overview's hero do. The
 * notices are fetched again every minute, like the overview's.
 */
@Component({
  selector: 'app-attention-page',
  imports: [
    TranslocoPipe,
    UiButton,
    UiCard,
    UiChipSet,
    UiEmptyState,
    UiPage,
    UiRelativeTimePipe,
    UiSection,
    UiStack,
    UiStatusEntry,
  ],
  template: `
    <ui-page [heading]="'attention.title' | transloco">
      <ui-stack gap="xl">
        <ui-stack direction="row" gap="sm">
          <ui-button variant="text" icon="arrow_back" route="/">{{
            'attention.back' | transloco
          }}</ui-button>
        </ui-stack>
        @if (attention.loaded()) {
          @if (attention.items().length === 0) {
            <ui-empty-state
              icon="check"
              [heading]="'attention.empty.heading' | transloco"
              [description]="'attention.empty.description' | transloco"
            />
          } @else {
            <p>{{ 'attention.summary' | transloco: { count: attention.items().length } }}</p>
            <ui-stack gap="sm">
              <!-- A new chip set when a press changed nothing: Material keeps its own chip state. -->
              @for (version of [severityChips()]; track version) {
                <ui-chip-set
                  [label]="'attention.filter.severity' | transloco"
                  [options]="severityOptions()"
                  [selected]="severities()"
                  (selectedChange)="chooseSeverities($event)"
                />
              }
              @if (kindOptions().length > 1) {
                <ui-chip-set
                  [label]="'attention.filter.kind' | transloco"
                  [options]="kindOptions()"
                  [(selected)]="kinds"
                />
              }
            </ui-stack>
            @for (section of sections(); track section.severity) {
              <ui-section [heading]="section.titleKey | transloco">
                <ui-stack gap="md">
                  @for (card of section.cards; track card.kind) {
                    <ui-card
                      variant="filled"
                      [heading]="card.titleKey | transloco"
                      [description]="
                        card.notices.length === 1
                          ? ('attention.card.countOne' | transloco)
                          : ('attention.card.count' | transloco: { count: card.notices.length })
                      "
                    >
                      <ui-stack gap="sm">
                        @for (notice of card.notices; track notice.id) {
                          <ui-status-entry
                            [icon]="notice.icon"
                            [kindTone]="notice.tone"
                            [title]="
                              'text' in notice.title
                                ? notice.title.text
                                : (notice.title.key | transloco: notice.title.params)
                            "
                            [subtitle]="
                              notice.affectedDevices === null
                                ? (notice.since | uiRelativeTime)
                                : ((notice.affectedDevices === 1
                                    ? 'attention.entry.devicesOne'
                                    : 'attention.entry.devices'
                                  )
                                  | transloco
                                    : {
                                        count: notice.affectedDevices,
                                        time: (notice.since | uiRelativeTime),
                                      })
                            "
                            [value]="notice.value ?? undefined"
                            [route]="routeOf(notice.target)"
                          />
                        }
                      </ui-stack>
                    </ui-card>
                  }
                </ui-stack>
              </ui-section>
            } @empty {
              <p>{{ 'attention.noMatch' | transloco }}</p>
            }
          }
        }
      </ui-stack>
    </ui-page>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AttentionPage {
  protected readonly attention = injectAttention(signal(false));

  private readonly transloco = inject(TranslocoService);
  private readonly router = inject(Router);
  private readonly format = inject(UiFormatContext);
  private readonly household = inject(HouseholdContext);
  private readonly language = toSignal(this.transloco.langChanges$);
  private readonly art = toSignal(inject(ActivatedRoute).queryParamMap, { requireSync: false });

  private readonly isOwner = computed(() => {
    const role = this.household.current()?.role;
    return role !== undefined && hasRole(role, 'owner');
  });

  /** The kinds chosen with the chips; a link with `?art=` sets them, the chips change them. */
  protected readonly kinds = linkedSignal<string | null, readonly AttentionKind[]>({
    source: () => this.art()?.get('art') ?? null,
    computation: (param) => kindsFromParam(param),
  });
  /** `all` is the only chip selected when no severity is. */
  protected readonly severities = signal<readonly SeverityFilter[]>(['all']);
  /** Counts presses that the filter ignored; the chips are drawn anew so they show the filter. */
  protected readonly severityChips = signal(0);

  private readonly counts = computed(() => filterCounts(this.attention.items()));
  private readonly shown = computed(() =>
    filterAttention(this.attention.items(), this.severities(), this.kinds()),
  );
  protected readonly sections = computed(() => sectionsOf(this.shown(), this.format.locale()));

  protected readonly severityOptions = computed<UiChipOption<SeverityFilter>[]>(() => {
    const { all, severities } = this.counts();
    return [
      { value: 'all', label: this.text(SEVERITY_FILTER_KEYS.all), count: all },
      ...(['critical', 'warning', 'info'] as const).map((value) => ({
        value,
        label: this.text(SEVERITY_FILTER_KEYS[value]),
        count: severities[value],
      })),
    ];
  });

  protected readonly kindOptions = computed<UiChipOption<AttentionKind>[]>(() =>
    this.counts().kinds.map(({ kind, count }) => ({
      value: kind,
      label: this.text(groupTitleKey(kind)),
      count,
    })),
  );

  protected routeOf(target: Parameters<typeof entryRoute>[0]) {
    return entryRoute(target, { isOwner: this.isOwner(), router: this.router });
  }

  /** "Alle" stands for no filter: choosing it clears the severities, choosing a severity drops it. */
  protected chooseSeverities(chosen: readonly SeverityFilter[]): void {
    const wasAll = this.severities().includes('all');
    const concrete = chosen.filter((value) => value !== 'all');
    const pickedAll = chosen.includes('all') && !wasAll;
    const next: readonly SeverityFilter[] = pickedAll || concrete.length === 0 ? ['all'] : concrete;
    // Switching "Alle" off, when nothing else is on, changes nothing: the chips must not stay off.
    if (wasAll && next[0] === 'all' && !chosen.includes('all')) {
      this.severityChips.update((version) => version + 1);
    }
    this.severities.set(next);
  }

  /** A text of the root translation, again when the language changes. */
  private text(key: string): string {
    this.language();
    return this.transloco.translate(key);
  }
}
