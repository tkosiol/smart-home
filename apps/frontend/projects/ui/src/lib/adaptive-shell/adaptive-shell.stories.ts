import { provideLocationMocks } from '@angular/common/testing';
import { BreakpointObserver, type BreakpointState } from '@angular/cdk/layout';
import { provideRouter, withDisabledInitialNavigation } from '@angular/router';
import { applicationConfig, moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { of } from 'rxjs';
import { expect, userEvent } from 'storybook/test';
import { UiBadge } from '../badge/badge';
import { UiBanner } from '../banner/banner';
import { UiIconButton } from '../button/icon-button';
import { UiIcon } from '../icon/icon';
import { UiPage } from '../layout/page/page';
import { UiTextField } from '../text-field/text-field';
import { UiTopAppBar, UiTopAppBarActions } from '../top-app-bar/top-app-bar';
import { EXPANDED, MEDIUM, UiAdaptiveShell, UiShellBanner, UiShellTopBar } from './adaptive-shell';
import type { UiNavDestination, UiWindowClass } from './navigation';

const destinations: readonly UiNavDestination[] = [
  { route: '/', label: 'Start', icon: 'home', exact: true },
  { route: '/raeume', label: 'Räume', icon: 'meeting_room' },
  { route: '/geraete', label: 'Geräte', icon: 'devices' },
  { route: '/mehr', label: 'Mehr', icon: 'more_horiz' },
];

const meta: Meta<UiAdaptiveShell> = {
  title: 'Navigation/Adaptive-Shell',
  component: UiAdaptiveShell,
  parameters: { layout: 'fullscreen' },
  decorators: [
    // Storybook's iframe path matches no route; without this the router's initial navigation fails
    // and rewrites the URL, which breaks the second-theme check of the test runner. The location
    // mock keeps a click on a destination from moving the iframe's real URL for the next story.
    applicationConfig({
      providers: [
        provideLocationMocks(),
        provideRouter(
          destinations.map((destination) => ({
            path: destination.route.slice(1),
            children: [],
          })),
          withDisabledInitialNavigation(),
        ),
      ],
    }),
    moduleMetadata({
      imports: [
        UiShellTopBar,
        UiShellBanner,
        UiTopAppBar,
        UiTopAppBarActions,
        UiIconButton,
        UiBadge,
        UiIcon,
        UiBanner,
        UiPage,
        UiTextField,
      ],
    }),
  ],
  render: () => ({
    props: { destinations },
    template: `
      <ui-adaptive-shell [destinations]="destinations" navigationLabel="Hauptnavigation">
        <ui-top-app-bar uiShellTopBar heading="Haus Sonnenweg">
          <ui-icon-button uiTopAppBarActions icon="notifications" label="Benachrichtigungen" />
        </ui-top-app-bar>
        <ui-banner uiShellBanner tone="offline">Keine Verbindung.</ui-banner>
        <ui-page heading="Start" description="Alles im Blick.">
          <p>Hier steht der Hauptinhalt der Seite.</p>
        </ui-page>
      </ui-adaptive-shell>`,
  }),
};
export default meta;

type Story = StoryObj<UiAdaptiveShell>;

/** Forces a window class regardless of the test runner's viewport width. */
function forceWindowClass(windowClass: UiWindowClass) {
  const state: BreakpointState = {
    matches: windowClass !== 'compact',
    breakpoints: {
      [MEDIUM]: windowClass !== 'compact',
      [EXPANDED]: windowClass === 'expanded',
    },
  };
  return applicationConfig({
    providers: [{ provide: BreakpointObserver, useValue: { observe: () => of(state) } }],
  });
}

async function expectNavigation(
  canvasElement: HTMLElement,
  canvas: Parameters<NonNullable<Story['play']>>[0]['canvas'],
  windowClass: UiWindowClass,
): Promise<HTMLElement> {
  await expect(canvasElement.querySelector('ui-adaptive-shell')).toHaveAttribute(
    'data-window-class',
    windowClass,
  );
  const nav = canvas.getByRole('navigation', { name: 'Hauptnavigation' });
  await expect(nav).toBeVisible();
  await expect(canvas.getAllByRole('link')).toHaveLength(4);
  for (const link of canvas.getAllByRole('link')) {
    const rect = link.getBoundingClientRect();
    await expect(rect.width).toBeGreaterThanOrEqual(48);
    await expect(rect.height).toBeGreaterThanOrEqual(48);
  }
  const rooms = canvas.getByRole('link', { name: 'Räume' });
  await expect(rooms).not.toHaveAttribute('aria-current');
  await userEvent.click(rooms);
  await expect(rooms).toHaveAttribute('aria-current', 'page');
  await expect(canvas.getByRole('link', { name: 'Start' })).not.toHaveAttribute('aria-current');
  return nav;
}

export const Handy: Story = {
  decorators: [forceWindowClass('compact')],
  play: async ({ canvasElement, canvas }) => {
    const nav = await expectNavigation(canvasElement, canvas, 'compact');
    const rect = nav.getBoundingClientRect();
    await expect(rect.height).toBe(80);
    await expect(rect.width).toBe(document.documentElement.clientWidth);
    await expect(rect.bottom).toBe(document.documentElement.clientHeight);
    // The content keeps clear of the fixed bar.
    await expect(getComputedStyle(canvasElement.querySelector('main')!).paddingBottom).toBe('80px');
  },
};

export const Tablet: Story = {
  decorators: [forceWindowClass('medium')],
  play: async ({ canvasElement, canvas }) => {
    const nav = await expectNavigation(canvasElement, canvas, 'medium');
    const rect = nav.getBoundingClientRect();
    await expect(rect.width).toBe(80);
    await expect(rect.left).toBe(0);
    // The label sits below the icon.
    const link = canvas.getByRole('link', { name: 'Start' });
    await expect(link.querySelector('.label')!.getBoundingClientRect().top).toBeGreaterThan(
      link.querySelector('ui-icon')!.getBoundingClientRect().bottom - 1,
    );
  },
};

export const Desktop: Story = {
  decorators: [forceWindowClass('expanded')],
  play: async ({ canvasElement, canvas }) => {
    const nav = await expectNavigation(canvasElement, canvas, 'expanded');
    await expect(nav.getBoundingClientRect().width).toBe(360);
    // Icon and label side by side.
    const link = canvas.getByRole('link', { name: 'Start' });
    const iconRect = link.querySelector('ui-icon')!.getBoundingClientRect();
    const labelRect = link.querySelector('.label')!.getBoundingClientRect();
    await expect(labelRect.left).toBeGreaterThanOrEqual(iconRect.right);
  },
};

/** Compact shell with content taller than the viewport and positioned form fields in it. */
const tallContent = {
  render: () => ({
    props: { destinations, fields: Array.from({ length: 16 }, (_, index) => `Feld ${index + 1}`) },
    template: `
      <ui-adaptive-shell [destinations]="destinations" navigationLabel="Hauptnavigation">
        <ui-page heading="Lange Seite">
          @for (field of fields; track field) {
            <ui-text-field [label]="field" />
          }
        </ui-page>
      </ui-adaptive-shell>`,
  }),
};

/** Content scrolled under the fixed bar must not paint over it. */
export const UnterDerLeiste: Story = {
  ...tallContent,
  decorators: [forceWindowClass('compact')],
  play: async ({ canvasElement, canvas }) => {
    const nav = canvas.getByRole('navigation', { name: 'Hauptnavigation' });
    const bar = nav.getBoundingClientRect();
    const field = canvasElement.querySelectorAll('ui-text-field')[8]!;
    const fieldRect = field.getBoundingClientRect();
    // Put the middle of a (positioned) form field right behind the middle of the bar.
    window.scrollBy(0, fieldRect.top + fieldRect.height / 2 - (bar.top + bar.height / 2));
    const x = field.getBoundingClientRect().left + field.getBoundingClientRect().width / 2;
    const y = bar.top + bar.height / 2;
    await expect(field.getBoundingClientRect().top).toBeLessThan(y);
    await expect(field.getBoundingClientRect().bottom).toBeGreaterThan(y);
    await expect(nav.contains(document.elementFromPoint(x, y))).toBe(true);
  },
};

/** A focused control scrolled into view must stay clear of the fixed bar (WCAG 2.4.11). */
export const FokusUeberDerLeiste: Story = {
  ...tallContent,
  decorators: [forceWindowClass('compact')],
  play: async ({ canvasElement, canvas }) => {
    const nav = canvas.getByRole('navigation', { name: 'Hauptnavigation' });
    window.scrollTo(0, 0);
    const target = canvasElement.querySelectorAll('input')[10]!;
    await expect(target.getBoundingClientRect().top).toBeGreaterThan(window.innerHeight);
    target.focus({ preventScroll: true });
    await expect(target).toHaveFocus();
    // Scrolling the focused control just into view (as a keyboard user's Tab does) must leave
    // it above the bar, not right at the viewport edge behind it.
    target.scrollIntoView({ block: 'nearest' });
    await expect(target.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      nav.getBoundingClientRect().top,
    );
  },
};

/** Real BreakpointObserver: whichever form the runner's width selects must be shown. */
export const Breiten: Story = {
  play: async ({ canvasElement, canvas }) => {
    const windowClass = canvasElement
      .querySelector('ui-adaptive-shell')!
      .getAttribute('data-window-class');
    await expect(['compact', 'medium', 'expanded']).toContain(windowClass);
    const nav = canvas.getByRole('navigation', { name: 'Hauptnavigation' });
    await expect(nav).toBeVisible();
    const rect = nav.getBoundingClientRect();
    await expect(rect.width).toBeGreaterThan(0);
    await expect(rect.height).toBeGreaterThan(0);
  },
};
