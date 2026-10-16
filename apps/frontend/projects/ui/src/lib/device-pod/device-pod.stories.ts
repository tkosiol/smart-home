import { signal } from '@angular/core';
import { provideRouter, withDisabledInitialNavigation } from '@angular/router';
import { applicationConfig, moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { expect, userEvent, waitFor } from 'storybook/test';
import { UiGrid } from '../layout/grid/grid';
import { expectNoHorizontalOverflow, withPhoneFrame } from '../testing/story-helpers';
import { waitForTranslations } from '../testing/storybook-environment';
import { expectThemeMatrix, rgb } from '../testing/theme-matrix';
import { ThemeMatrixStoryComponent, UiMatrixCell } from '../testing/theme-matrix.story-component';
import { UiDevicePod } from './device-pod';
import { UiPodRow } from './pod-row';

const meta: Meta<UiDevicePod> = {
  title: 'Inhalt/Geräte-Pod',
  component: UiDevicePod,
  decorators: [
    // Storybook's iframe path matches no route; without this the router's initial navigation fails
    // and rewrites the URL, which breaks the second-theme check of the test runner.
    applicationConfig({ providers: [provideRouter([], withDisabledInitialNavigation())] }),
    moduleMetadata({ imports: [UiGrid, UiPodRow] }),
  ],
};
export default meta;

/** One pod per kind (spec 2.4), all links; the lamp pods carry their state as `pressed`. */
const kinds = `
  <ui-device-pod kind="light" icon="lightbulb" value="80" unit="%" label="Deckenlampe · Warmweiß" [chip]="{ text: 'An', tone: 'primary' }" [pressed]="true" route="/geraete/1" />
  <ui-device-pod kind="light" icon="lightbulb" value="Aus" label="Stehlampe" [pressed]="false" route="/geraete/2" />
  <ui-device-pod kind="soil" icon="potted_plant" value="24" unit="%" label="Monstera · 22,1 °C" [chip]="{ text: 'trocken', tone: 'dry' }" route="/geraete/3" />
  <ui-device-pod kind="soil" icon="potted_plant" value="38" unit="%" label="Grünlilie · 21,9 °C" [chip]="{ text: '9 %', tone: 'warning' }" route="/geraete/4" />
  <ui-device-pod kind="climate" icon="thermostat" value="21,4" unit="°C" label="Klima · 48 %" route="/geraete/5" />
  <ui-device-pod kind="contact" icon="door_open" value="Offen" label="Fenster · seit 1 h" route="/geraete/6" />
  <ui-device-pod kind="other" icon="sensors" value="Gut" label="Signal" route="/geraete/7" />`;

export const Arten: StoryObj<UiDevicePod> = {
  render: () => ({ template: `<ui-pod-row wrap>${kinds}</ui-pod-row>` }),
  play: async ({ canvas, canvasElement }) => {
    const pods = canvas.getAllByRole('link');
    await expect(pods).toHaveLength(7);
    const root = getComputedStyle(document.documentElement);
    for (const pod of pods) {
      const rect = pod.getBoundingClientRect();
      await expect(rect.width).toBe(140);
      await expect(rect.height).toBe(116);
      await expect(getComputedStyle(pod).borderRadius).toBe(
        root.getPropertyValue('--mat-sys-corner-large').trim(),
      );
    }
    // The lit lamp is primary, the unlit one the highest surface container, soil tertiary.
    const [lit, unlit, soil] = pods as HTMLElement[];
    await expect(getComputedStyle(lit!).backgroundColor).toBe(
      rgb(root.getPropertyValue('--mat-sys-primary').trim()),
    );
    await expect(getComputedStyle(unlit!).backgroundColor).toBe(
      rgb(root.getPropertyValue('--mat-sys-surface-container-highest').trim()),
    );
    await expect(getComputedStyle(soil!).backgroundColor).toBe(
      rgb(root.getPropertyValue('--mat-sys-tertiary-container').trim()),
    );
    // Named by its content in reading order; the value keeps tabular digits.
    await expect(
      canvas.getByRole('link', { name: 'trocken 24 % Monstera · 22,1 °C' }),
    ).toBeVisible();
    for (const value of canvasElement.querySelectorAll('.value')) {
      await expect(getComputedStyle(value).fontVariantNumeric).toBe('tabular-nums');
    }
  },
};

/** A lamp as a switch (spec 3.1): the press is pending until the device confirms it. */
export const Schalter: StoryObj<UiDevicePod> = {
  render: () => {
    const on = signal(true);
    const pending = signal(false);
    return {
      props: {
        on,
        pending,
        toggle: () => {
          if (pending()) return;
          pending.set(true);
          setTimeout(() => {
            on.update((value) => !value);
            pending.set(false);
          }, 400);
        },
      },
      template: `
        <ui-pod-row>
          <ui-device-pod kind="light" icon="lightbulb" [value]="on() ? '80' : 'Aus'" [unit]="on() ? '%' : undefined" label="Deckenlampe · Warmweiß" [chip]="on() ? { text: 'An', tone: 'primary' } : null" [pressed]="on()" [pending]="pending()" (toggled)="toggle()" />
          <ui-device-pod kind="light" icon="lightbulb" value="Aus" label="Stehlampe" [pressed]="false" [pending]="true" />
        </ui-pod-row>`,
    };
  },
  play: async ({ canvas }) => {
    const pod = canvas.getByRole('button', { pressed: true });
    await expect(pod).toHaveAccessibleName('An 80 % Deckenlampe · Warmweiß');
    await userEvent.click(pod);
    await expect(pod).toHaveAttribute('aria-busy', 'true');
    await waitFor(() => expect(getComputedStyle(pod.querySelector('.icon')!).opacity).toBe('0.6'));
    // A second press while pending is ignored: the state still flips only once.
    await userEvent.click(pod);
    await waitFor(() => expect(pod).toHaveAttribute('aria-pressed', 'false'));
    await expect(pod).not.toHaveAttribute('aria-busy');
    await expect(pod).toHaveAccessibleName('Aus Deckenlampe · Warmweiß');
    await new Promise((resolve) => setTimeout(resolve, 500));
    await expect(pod).toHaveAttribute('aria-pressed', 'false');
  },
};

/** The scrolling row of a room card on a phone: snapping, Tab reaches every pod. */
export const Reihe: StoryObj<UiDevicePod> = {
  decorators: [withPhoneFrame],
  render: () => ({ template: `<ui-pod-row>${kinds}</ui-pod-row>` }),
  play: async ({ canvas, canvasElement }) => {
    const scroller = canvasElement.querySelector<HTMLElement>('.scroller')!;
    await expect(getComputedStyle(scroller).scrollSnapType).toBe('x mandatory');
    await expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth);
    await expectNoHorizontalOverflow(canvasElement.querySelector('.story-narrow')!);
    const pods = canvas.getAllByRole('link');
    await userEvent.tab();
    await expect(pods[0]).toHaveFocus();
    for (let index = 1; index < pods.length; index += 1) {
      await userEvent.tab();
      await expect(pods[index]).toHaveFocus();
    }
    // The last pod scrolled into view when it received focus.
    await waitFor(() => expect(scroller.scrollLeft).toBeGreaterThan(0));
    const last = pods.at(-1)!.getBoundingClientRect();
    const frame = scroller.getBoundingClientRect();
    await expect(last.right).toBeLessThanOrEqual(frame.right + 1);
  },
};

/** From medium windows up the row also has arrows that page it (spec 3.1). */
export const Pfeile: StoryObj<UiDevicePod> = {
  render: () => ({
    template: `<div style="width: 480px"><ui-pod-row>${kinds}${kinds}</ui-pod-row></div>`,
  }),
  play: async ({ canvas, canvasElement }) => {
    if (window.innerWidth < 600) return;
    await waitForTranslations();
    const scroller = canvasElement.querySelector<HTMLElement>('.scroller')!;
    const next = canvas.getByRole('button', { name: /Weiter blättern|Scroll forward/ });
    await expect(canvas.getByRole('button', { name: /Zurück blättern|Scroll back/ })).toBeVisible();
    await userEvent.click(next);
    await waitFor(() => expect(scroller.scrollLeft).toBeGreaterThan(0));
  },
};

/** The side values of the device page (spec 3.3): static pods that fill a grid, three across. */
const sideValues = `
  <ui-grid min="xs" gap="sm">
    <ui-device-pod fill kind="climate" icon="thermostat" value="21,8" unit="°C" label="Temperatur" />
    <ui-device-pod fill kind="climate" icon="battery_alert" value="72" unit="%" label="Batterie" />
    <ui-device-pod fill kind="climate" icon="sensors" value="120" label="Signalqualität" />
  </ui-grid>`;

export const Nebenwerte: StoryObj<UiDevicePod> = {
  render: () => ({ template: `<div style="width: 358px">${sideValues}</div>` }),
  play: async ({ canvasElement }) => {
    const pods = canvasElement.querySelectorAll<HTMLElement>('ui-device-pod');
    await expect(pods).toHaveLength(3);
    const tops = new Set([...pods].map((pod) => Math.round(pod.getBoundingClientRect().top)));
    await expect(tops.size).toBe(1);
    await expect(pods[0]!.getBoundingClientRect().width).toBeGreaterThan(100);
    await expect(pods[0]!.getBoundingClientRect().height).toBe(116);
  },
};

export const Kombinationen: StoryObj<UiDevicePod> = {
  decorators: [moduleMetadata({ imports: [ThemeMatrixStoryComponent, UiMatrixCell] })],
  render: () => ({
    template: `
      <ui-theme-matrix>
        <ng-template uiMatrixCell>
          <ui-pod-row wrap>
            ${kinds}
            <ui-device-pod kind="light" icon="lightbulb" value="80" unit="%" label="Flurlampe" [pressed]="true" [pending]="true" />
            <ui-device-pod kind="climate" icon="thermostat" value="21,8" unit="°C" label="Temperatur" />
          </ui-pod-row>
          ${sideValues}
        </ng-template>
      </ui-theme-matrix>`,
  }),
  play: async ({ canvasElement }) => {
    await expectThemeMatrix(canvasElement);
  },
};
