import { NgComponentOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  type Type,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { marker } from '@jsverse/transloco-keys-manager/marker';
import { normalizeOverviewLayout, type OverviewLayout } from '@smart/contracts';
import {
  UiBottomSheet,
  UiButton,
  UiEmptyState,
  UiEmptyStateActions,
  UiGrid,
  UiGridItem,
  UiPage,
} from '@smart/ui';
import { TopBarActions, type OverviewBlock } from '../../core/features';
import { HouseholdContext, injectHouseholdErrorHandler } from '../../core/household';
import {
  OverviewSurface,
  injectOverviewBlocks,
  resolveOverviewBlocks,
  usableOverviewBlocks,
} from '../../core/overview-blocks';
import type { CustomizeData, CustomizeResult, CustomizeSheet } from './customize-sheet';
import { OverviewLayoutApi } from './overview-layout.api';

/** A block on the page: its component, and the inputs it gets (only blocks that ask for them). */
interface Placed {
  readonly block: OverviewBlock;
  readonly component: Type<unknown>;
  readonly inputs: Record<string, unknown> | undefined;
}

/**
 * The overview: the blocks features registered, in the order and with the visibility the user chose
 * (spec 5). What the server stored is normalised against the registered blocks, so an unknown
 * block, a new one or nothing at all still gives a valid page. A block that asks for it
 * (`surfaceWhenHidden`, the status block) is also rendered while hidden, and decides itself
 * whether to show anything. The icon in the top bar opens the customise sheet.
 */
@Component({
  selector: 'app-dashboard-page',
  imports: [
    NgComponentOutlet,
    TranslocoPipe,
    UiButton,
    UiEmptyState,
    UiEmptyStateActions,
    UiGrid,
    UiGridItem,
    UiPage,
  ],
  // The household name in the top app bar is the visible title (spec 3.1); the h1 stays for
  // screen readers. From medium up the grid has two columns, the status block spans both.
  template: `
    <ui-page [heading]="'dashboard.title' | transloco" headingHidden>
      @if (known().length === 0) {
        <ui-empty-state
          icon="home"
          [heading]="'dashboard.empty.heading' | transloco"
          [description]="'dashboard.empty.description' | transloco"
        />
      } @else if (ready()) {
        <ui-grid min="lg" gap="lg">
          @for (placed of blocks(); track placed.block.id) {
            <ui-grid-item [span]="placed.block.span">
              <ng-container
                [ngComponentOutlet]="placed.component"
                [ngComponentOutletInputs]="placed.inputs"
              />
            </ui-grid-item>
          }
        </ui-grid>
        @if (allHidden()) {
          <ui-empty-state
            icon="tune"
            [heading]="'dashboard.hidden.heading' | transloco"
            [description]="'dashboard.hidden.description' | transloco"
          >
            <div uiEmptyStateActions>
              <ui-button (pressed)="customize()">{{
                'app.overview.customize' | transloco
              }}</ui-button>
            </div>
          </ui-empty-state>
        }
      }
    </ui-page>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardPage {
  private readonly household = inject(HouseholdContext);
  private readonly api = inject(OverviewLayoutApi);
  private readonly sheet = inject(UiBottomSheet);
  private readonly handleError = injectHouseholdErrorHandler();
  private readonly surface = inject(OverviewSurface);
  private readonly registered = injectOverviewBlocks();
  private readonly currentId = computed(() => this.household.current()?.id);

  /** The blocks this user may use; the role comes from `me`. */
  protected readonly known = computed(() =>
    usableOverviewBlocks(this.registered, this.household.current()?.role ?? null),
  );

  /** What the server stored for this user in this household; null: nothing, use the defaults. */
  private readonly stored = signal<OverviewLayout | null>(null);
  /** Whether the stored layout has arrived (or failed to), so blocks do not jump around. */
  protected readonly ready = signal(false);
  private layoutRequests = 0;

  /** The valid layout: unknown IDs dropped, new blocks added with their defaults. */
  protected readonly layout = computed(() => normalizeOverviewLayout(this.stored(), this.known()));

  /** The blocks to render, in layout order. */
  private readonly wanted = computed(() => {
    const byId = new Map(this.known().map((block) => [block.id, block]));
    return this.layout().blocks.flatMap((entry) => {
      const block = byId.get(entry.id);
      return block && (entry.visible || block.surfaceWhenHidden)
        ? [{ block, visible: entry.visible }]
        : [];
    });
  });
  private readonly components = signal<ReadonlyMap<string, Type<unknown>>>(new Map());
  private resolveRequests = 0;
  /** The customise sheet is being opened or is open (or its answer is being saved). */
  private customizing = false;

  protected readonly blocks = computed<Placed[]>(() => {
    const components = this.components();
    return this.wanted().flatMap(({ block, visible }) => {
      const component = components.get(block.id);
      return component
        ? [
            {
              block,
              component,
              inputs: block.surfaceWhenHidden ? { visible } : undefined,
            },
          ]
        : [];
    });
  });

  /** Nothing is on show: the user hid every block, and no critical notice surfaces despite that. */
  protected readonly allHidden = computed(
    () =>
      this.ready() &&
      this.known().length > 0 &&
      !this.layout().blocks.some((b) => b.visible) &&
      !this.surface.any(),
  );

  constructor() {
    const destroyed = inject(DestroyRef);
    // The stored layout, keyed on the household's id (not on its object).
    effect(() => {
      const id = this.currentId();
      untracked(() => void this.loadLayout(id));
    });
    // Only blocks that are on show load their code: a hidden block stays out of the browser. Until
    // the stored layout has arrived the defaults would decide, and load a block the user hid.
    effect(() => {
      if (!this.ready()) return;
      const wanted = this.wanted().map(({ block }) => block);
      untracked(() => void this.resolve(wanted));
    });
    const removeAction = inject(TopBarActions).show({
      id: 'overview-customize',
      icon: 'tune',
      labelKey: marker('app.overview.customize'),
      run: () => void this.customize(),
    });
    destroyed.onDestroy(() => {
      removeAction();
      this.layoutRequests++;
      this.resolveRequests++;
    });
  }

  private async loadLayout(householdId: string | undefined): Promise<void> {
    const request = ++this.layoutRequests;
    this.ready.set(false);
    this.stored.set(null);
    if (!householdId) return;
    let layout: OverviewLayout | null = null;
    try {
      layout = await this.api.get(householdId);
    } catch (error) {
      // The page still works with the defaults; the error is told once.
      if (request === this.layoutRequests) this.handleError(error);
    }
    if (request !== this.layoutRequests) return;
    this.stored.set(layout);
    this.ready.set(true);
  }

  private async resolve(wanted: readonly OverviewBlock[]): Promise<void> {
    const request = ++this.resolveRequests;
    const resolved = await resolveOverviewBlocks(wanted);
    if (request !== this.resolveRequests) return;
    this.components.set(new Map(resolved.map(({ block, component }) => [block.id, component])));
  }

  /** Opens "Übersicht anpassen"; "Fertig" saves, "Zurücksetzen" deletes, closing discards. */
  protected async customize(): Promise<void> {
    const householdId = this.currentId();
    if (!householdId || !this.ready() || this.customizing) return;
    this.customizing = true;
    try {
      await this.runCustomize(householdId);
    } catch (error) {
      // A chunk that did not load (the sheet, or its dialog host): tell it, stay usable.
      this.handleError(error);
    } finally {
      this.customizing = false;
    }
  }

  private async runCustomize(householdId: string): Promise<void> {
    const byId = new Map(this.known().map((block) => [block.id, block]));
    const blocks: CustomizeData['blocks'] = this.layout().blocks.flatMap((entry) => {
      const block = byId.get(entry.id);
      return block
        ? [
            {
              id: block.id,
              labelKey: block.labelKey,
              descriptionKey: block.descriptionKey,
              icon: block.icon,
              visible: entry.visible,
            },
          ]
        : [];
    });
    // The sheet (reorder list, switches, drag and drop) loads only when the user customises.
    const { CustomizeSheet } = await import('./customize-sheet');
    const result = await this.sheet.open<CustomizeSheet, CustomizeData, CustomizeResult>(
      CustomizeSheet,
      { blocks },
    );
    if (!result) return;
    try {
      const saved =
        result.kind === 'save'
          ? await this.api.save(householdId, result.layout)
          : (await this.api.reset(householdId), null);
      // The user may have switched households while the server was answering.
      if (this.currentId() === householdId) this.stored.set(saved);
    } catch (error) {
      this.handleError(error);
    }
  }
}
