import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  untracked,
} from '@angular/core';
import { Router, type UrlTree } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { hasRole, type AttentionItem } from '@smart/contracts';
import {
  UiAnnouncer,
  UiFormatContext,
  UiRelativeTimePipe,
  UiStatusEntry,
  UiStatusHero,
} from '@smart/ui';
import { HouseholdContext } from '../../core/household';
import { reportSurfaced } from '../../core/overview-blocks';
import { ALL_NOTICES_ROUTE, entryOf, entryRoute, type EntryView } from './attention-entries';
import { attentionChange, groupAttention, heroModel } from './attention-model';
import { injectAttention } from './attention';

/**
 * The overview's status block (spec 4.1): the hero with at most three groups of notices, or the
 * calm row. A critical notice shows the hero even when the user hid the block (`visible` false,
 * rule 7). New critical notices are announced at once, other changes politely.
 */
@Component({
  selector: 'app-status-block',
  imports: [TranslocoPipe, UiRelativeTimePipe, UiStatusEntry, UiStatusHero],
  template: `
    @if (shown()) {
      @if (model(); as hero) {
        <ui-status-hero
          [tone]="hero.tone"
          [heading]="'app.attention.heading' | transloco"
          [count]="hero.count"
          [criticalCount]="hero.criticalCount"
          [moreLabel]="
            hero.hiddenGroups === 0
              ? undefined
              : hero.hiddenGroups === 1
                ? ('app.attention.more.one' | transloco)
                : ('app.attention.more.other' | transloco: { n: hero.hiddenGroups })
          "
          [moreRoute]="allNoticesRoute"
        >
          @if (hero.tone === 'calm') {
            @if (summary(); as devices) {
              @if (devices.count === 0) {
                {{ 'app.attention.calm.noDevices' | transloco }}
              } @else if (devices.lastSeenAt; as lastSeen) {
                @if (devices.count === 1) {
                  {{
                    'app.attention.calm.detailOne' | transloco: { time: lastSeen | uiRelativeTime }
                  }}
                } @else {
                  {{
                    'app.attention.calm.detail'
                      | transloco: { count: devices.count, time: lastSeen | uiRelativeTime }
                  }}
                }
              } @else if (devices.count === 1) {
                {{ 'app.attention.calm.detailOneNoTime' | transloco }}
              } @else {
                {{ 'app.attention.calm.detailNoTime' | transloco: { count: devices.count } }}
              }
            }
          } @else {
            @for (row of rows(); track row.id) {
              <ui-status-entry
                [icon]="row.icon"
                [kindTone]="row.tone"
                [title]="row.titleKey | transloco: row.titleParams"
                [subtitle]="
                  row.subtitle === null
                    ? undefined
                    : 'text' in row.subtitle
                      ? row.subtitle.text
                      : (row.subtitle.key | transloco: row.subtitle.params)
                "
                [value]="row.value ?? undefined"
                [severityLabel]="
                  row.critical ? ('app.attention.severity.critical' | transloco) : undefined
                "
                [route]="row.route"
              />
            }
          }
        </ui-status-hero>
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatusBlock {
  /** False when the user hid the block: it then shows only while a critical notice is open. */
  readonly visible = input(true);

  protected readonly allNoticesRoute = ALL_NOTICES_ROUTE;

  private readonly transloco = inject(TranslocoService);
  private readonly announcer = inject(UiAnnouncer);
  private readonly router = inject(Router);
  private readonly format = inject(UiFormatContext);
  private readonly household = inject(HouseholdContext);
  private readonly attention = injectAttention(this.visible);

  protected readonly summary = this.attention.summary;
  protected readonly model = computed(() => heroModel(this.attention.items()));
  protected readonly shown = computed(
    () => this.attention.loaded() && (this.visible() || this.model().tone === 'critical'),
  );

  private readonly isOwner = computed(() => {
    const role = this.household.current()?.role;
    return role !== undefined && hasRole(role, 'owner');
  });

  /** The rows of the hero: at most three groups, each with the route the user may follow. */
  protected readonly rows = computed<Row[]>(() =>
    this.model().groups.map((group) => {
      const entry = entryOf(group, this.format.locale());
      return {
        ...entry,
        route: entryRoute(entry.target, { isOwner: this.isOwner(), router: this.router }),
      };
    }),
  );

  constructor() {
    // The overview must not call itself empty while this shows a critical notice against a hide.
    reportSurfaced('status', () => !this.visible() && this.shown());
    let previous: readonly AttentionItem[] | null = null;
    effect(() => {
      const loaded = this.attention.loaded();
      const next = this.attention.items();
      untracked(() => {
        if (!loaded) {
          previous = null;
          return;
        }
        if (previous !== null) this.announce(previous, next);
        previous = next;
      });
    });
  }

  private announce(previous: readonly AttentionItem[], next: readonly AttentionItem[]): void {
    const { newCritical, changed } = attentionChange(previous, next);
    if (newCritical.length > 0) {
      const [first] = newCritical;
      const text =
        newCritical.length === 1 && first
          ? this.transloco.translate('app.attention.announce.critical', {
              title: this.titleOf(first),
            })
          : this.transloco.translate('app.attention.announce.criticalMany', {
              count: newCritical.length,
            });
      void this.announcer.announce(text, 'assertive');
    } else if (changed && this.visible()) {
      const text =
        next.length === 0
          ? this.transloco.translate('app.attention.announce.none')
          : this.transloco.translate('app.attention.announce.changed', { count: next.length });
      void this.announcer.announce(text, 'polite');
    }
  }

  private titleOf(item: AttentionItem): string {
    const [group] = groupAttention([item]);
    const entry = entryOf(group!, this.format.locale());
    return this.transloco.translate(entry.titleKey, entry.titleParams);
  }
}

/** A row of the hero with the route it leads to, when the user may follow one. */
type Row = EntryView & { readonly route: string | UrlTree | undefined };
