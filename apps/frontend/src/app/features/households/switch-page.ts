import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiButton, UiList, UiListItem, UiPage, UiSection, UiStack } from '@smart/ui';
import { HouseholdContext, injectHouseholdErrorHandler } from '../../core/household';

/** The user's households with their role; choosing one switches to it. */
@Component({
  selector: 'app-switch-page',
  imports: [TranslocoPipe, UiButton, UiList, UiListItem, UiPage, UiSection, UiStack],
  template: `
    <ui-page [heading]="'households.switch.title' | transloco">
      <ui-stack gap="lg">
        @for (item of households.households(); track item.id) {
          <ui-section
            [heading]="item.name"
            [description]="
              (item.role === 'owner'
                ? 'households.roles.owner'
                : item.role === 'member'
                  ? 'households.roles.member'
                  : 'households.roles.viewer'
              ) | transloco
            "
          >
            @if (item.id === households.current()?.id) {
              {{ 'households.switch.current' | transloco }}
            } @else {
              <ui-stack direction="row" gap="sm">
                <ui-button variant="tonal" [disabled]="busy()" (pressed)="choose(item.id)">{{
                  'households.switch.to' | transloco: { name: item.name }
                }}</ui-button>
              </ui-stack>
            }
          </ui-section>
        }
        <ui-list>
          <ui-list-item
            icon="add"
            route="/einrichten"
            [headline]="'households.switch.new' | transloco"
          />
        </ui-list>
      </ui-stack>
    </ui-page>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SwitchPage {
  protected readonly households = inject(HouseholdContext);
  private readonly router = inject(Router);
  private readonly handleError = injectHouseholdErrorHandler();
  protected readonly busy = signal(false);

  protected async choose(householdId: string): Promise<void> {
    this.busy.set(true);
    try {
      await this.households.switchTo(householdId);
      await this.router.navigateByUrl('/');
    } catch (error) {
      this.handleError(error);
    } finally {
      this.busy.set(false);
    }
  }
}
