# Etappe 3d: App-Rahmen, Seiten und PWA – Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nach 3d ist die PWA installierbar und vollständig gestaltet: adaptiver Rahmen mit vier Zielen, gestaltete Seiten, Einstellungen mit Theme-Editor und Sprachwahl, Offline- und Update-Banner, eigenes App-Icon – geprüft per Storybook, Unit-Tests und Playwright gegen den Stack.

**Architecture:** Neue Rahmen-Komponenten in `@smart/ui` (`ui-badge`, `ui-top-app-bar`, `ui-adaptive-shell`). Die App bekommt `shell/` (Rahmen, Banner, „Nicht gefunden“), `core/features` (Registry für `provideFeature()`), `core/pwa` (Online-Status, Updates) und lazy geladene Features `dashboard`, `rooms`, `devices`, `more`, `settings`. Seitentexte liegen pro Feature in eigenen Transloco-Scopes (lazy); Rahmen- und Navigationstexte in der Wurzelübersetzung der App. Der Service Worker (Angular) cacht den App-Rahmen; `config.json` läuft über eine Data-Group mit Frische-Strategie.

**Tech Stack:** wie 3c; neu `@angular/service-worker` 22.2.2 (MIT). App-Icon-Generator nutzt das vorhandene Playwright 1.64.0.

**Spec:** `docs/superpowers/specs/2026-10-11-etappe-3-design-system-design.md` (Abschnitte 2, 3, 5, 6, 7, 8, 10) und Architektur-Spec Abschnitte 10.1, 10.6, 10.7, 10.9. Übertrag aus `docs/superpowers/plans/2026-10-11-etappe-3b-komponenten.md` und `docs/superpowers/plans/2026-10-12-etappe-3c-sprache-laufzeit-theme-editor.md`, jeweils „Ergebnis und Übertrag“.

**Planform (Tokens sparen):** Vollständiger Code steht nur dort, wo Fehler wahrscheinlich sind (Registry, Rahmen, Service Worker, nginx, Icon-Generator, Initializer). Sonst nennt der Plan Verhalten, Schnittstellen und die Tests mit ihren Erwartungen; die Umsetzung folgt den Mustern der vorhandenen Komponenten (gleicher Ordner-, Story- und Spec-Aufbau wie in `projects/ui/src/lib/*`).

**Bewusste Entscheidungen:**

- **Routen:** zusätzlich `/mehr/einstellungen` (Liste „Darstellung“, „Erscheinungsbild der Installation“), damit der Eintrag „Einstellungen“ unter „Mehr“ ein Ziel hat. Sonst exakt Spec 3.
- **Glocke:** Link nach `/mehr` (dort stehen Benachrichtigungen als „kommt bald“), mit Zähler 0 und Namen „Benachrichtigungen, keine neuen“. Ein Knopf ohne Wirkung wäre schlechter.
- **Haushaltsname:** bis Etappe 4 der Platzhalter „Mein Zuhause“ / „My home“ aus der Übersetzung.
- **`provideFeature()`:** registriert „Mehr“-Einträge und Übersichtskarten; Routen bleiben lazy in `app.routes.ts` (eine Datei, gut lesbar). Gerätewidgets kommen mit Etappe 6.
- **Übersetzungen:** Seitentexte je Feature als Transloco-Scope mit Inline-Loader (Spec 7 „pro Feature, lazy“). Texte, die per `marker()` markiert werden (Navigation, „Mehr“-Einträge), liegen in der Wurzelübersetzung, weil der Keys Manager Marker mit Scope falsch zuordnet (3c-Versuch).
- **Manifest-Farbe:** Build-Default (`#00687a`); eine abweichende Instanzfarbe aus `config.json` erreicht das statische Manifest nicht (dokumentiert).

## Global Constraints

- Alle Global Constraints aus Plan 3c gelten weiter (Versionen, Komponentenregeln, Tokens, 48-px-Ziele, Storybook-Prüfung in zwei Durchläufen mit Englisch, keine KI-Attribution, Prüfung am Ende jeder Task: `pnpm lint && pnpm typecheck && pnpm --filter @smart/frontend test && pnpm --filter @smart/frontend build`, bei Stories zusätzlich Storybook-Prüfung, bei nginx/Container/E2E zusätzlich `sh infra/compose/test/stack-test.sh`).
- Neues Paket exakt: `@angular/service-worker@22.2.2`.
- Fensterklassen (Spec 3): Compact < 600 px → Navigation Bar unten; Medium 600–839 px → Navigation Rail links; Expanded ≥ 840 px → Navigation Drawer dauerhaft. Vier Ziele: Übersicht `/`, Räume `/raeume`, Geräte `/geraete`, Mehr `/mehr`.
- Routen: `/`, `/raeume`, `/geraete`, `/mehr`, `/mehr/einstellungen`, `/mehr/einstellungen/darstellung`, `/mehr/einstellungen/installation`; alles andere → „Nicht gefunden“ mit Weg zur Übersicht. Jede Seite lazy geladen.
- „Erscheinungsbild der Installation“ (Eintrag und Route) nur bei `RUNTIME_CONFIG.features.instanceAppearanceEditor`; sonst leitet die Route auf `/mehr/einstellungen` um.
- Feature-Komponenten: kein CSS, nur `@smart/ui`; Features importieren sich nicht gegenseitig; `core/` und `shell/` nie auf Features (Lint).
- Texte: kein sichtbarer Text ohne Schlüssel. In Stories wartet jede `play`-Funktion mit Text zuerst auf `waitForTranslations()` (3c).
- Theme-Editor bindet `(resetRequested)` (nicht `reset`).
- Nach dem Laden zeigt die App nie unübersetzte oder leere Texte: die aktive Sprache wird vor dem ersten Rendern geladen (Task 4).

## Review Focus

1. **Fensterbreite wechselt** (Handy gedreht, Fenster verkleinert): Navigation wechselt Bar ↔ Rail ↔ Drawer ohne Neuladen, das aktive Ziel bleibt markiert. → Story „Breiten“ in Task 3, E2E in Task 9.
2. **Direktaufruf und Neuladen tiefer Routen** (`/mehr/einstellungen/darstellung`, Unbekanntes): richtige Seite bzw. „Nicht gefunden“, auch vom Service Worker. → E2E in Task 9.
3. **Offline und neue Version:** Banner erscheinen und verschwinden, werden angesagt; „Neu laden“ lädt. → Unit-Tests in Task 7.
4. **Gesperrter Speicher / zweiter Tab:** Sprachwahl und Theme bleiben in der Sitzung wirksam, Tabs gleichen sich an. → Tests in Task 5.
5. **Installations-Editor aus:** weder Eintrag noch Route erreichbar (auch per Direktaufruf). → Test in Task 5, E2E in Task 9.

---

### Task 1: UI-Nacharbeiten aus 3b

**Files:** `projects/ui/src/lib/button/*`, `snackbar/*` (neu: `snackbar-content.ts/.html/.scss`), `announcer/announcer.ts` (neu), `card/*`, `empty-state/*`, `list/*`, `tokens/layout.css`, `i18n/{de,en}.json`, `public-api.ts`, betroffene Specs/Stories.

**Interfaces (Produces):**

- `UiButton.route = input<string>()`: gesetzt → rendert `<a mat-button routerLink>` statt `<button>`, `pressed` feuert dann nicht; gleiche Varianten und Icon.
- `UiSnackbar.show(message: string, options?: { action?: string; politeness?: 'polite' | 'assertive' }): Promise<'action' | 'dismissed'>` – mit Aktion bleibt die Meldung stehen, bis Aktion oder **Schließen** (Icon-Button mit Text `ui.snackbar.close`); ohne Aktion schließt sie nach `PLAIN_DURATION_MS`. `durationMs` entfällt (WCAG 2.2.1: keine zeitgesteuerte Meldung mit Aktion).
- `UiAnnouncer.announce(message: string, politeness?: 'polite' | 'assertive'): Promise<void>` (kapselt CDK `LiveAnnouncer`, damit die App kein CDK importiert).
- `UiCard.level` und `UiEmptyState.level`: `input<2 | 3>()`, Standard wie bisher (Karte 3, Leer-Zustand 2).
- `UiListItem` deaktiviert: kein `aria-disabled` am `div` mehr (ARIA 1.2), sichtbar über Token `--smart-opacity-disabled: 0.38`.

**Tests (Specs, TDD):**

- Button: mit `route="/raeume"` ist das Element ein `a[href="/raeume"]` mit Text und Icon; ohne `route` ein `button`. Story `Link`.
- Snackbar: Meldung mit Aktion zeigt Aktion und Schließen (Name „Schließen“), Schließen löst `'dismissed'` aus, Aktion `'action'`; ohne Aktion kein Schließen-Knopf. Story mit `play` per Tastatur (Tab zu Schließen, Enter) und `waitForTranslations()`.
- Announcer: `announce` ruft `LiveAnnouncer.announce` mit Text und Höflichkeit (Spy auf dem echten Service per `TestBed.inject`).
- Karte/Leer-Zustand: `level` 2 bzw. 3 rendert `h2` bzw. `h3`.
- Liste: deaktivierte Zeile hat kein `aria-disabled`, ist kein Link, und ihre `opacity` ist 0.38 (computed style in der Story).
- Nachgezogene Tests aus 3c: `ThemeService` übernimmt eine im anderen Tab gespeicherte Instanz nur bei eingeschaltetem Editor (sonst bleibt der Default); im Farbteil ändert das Bearbeiten eines bestehenden Overrides `coreOverrides`; „Auf Standard zurücksetzen“ meldet `resetRequested` auch im Installationsmodus.

**Steps:** je Komponente Test rot → Umsetzung → grün; `ui.snackbar.close` in beide UI-Übersetzungen („Schließen“ / „Close“); `pnpm i18n:check`; Prüfung am Ende der Task inkl. Storybook. Commit `feat(ui): link buttons, closable snackbars, announcer and heading levels`.

---

### Task 2: `ui-badge` und `ui-top-app-bar`

**Files:** `projects/ui/src/lib/badge/*`, `top-app-bar/*`, `public-api.ts`.

**Interfaces (Produces):**

- `UiBadge` (`ui-badge`): `count = input.required<number>()`; projiziert seinen Inhalt (z. B. ein `ui-icon`) und legt die Zahl darüber: bei 0 nichts, bei 1–99 die Zahl, darüber „99+“. Die Zahl ist `aria-hidden="true"`; den zugänglichen Namen (inkl. Zahl) setzt das umgebende Bedienelement (Task 4: Link der Glocke).
- `UiTopAppBar` (`ui-top-app-bar`): `heading = input.required<string>()`; Aktionen per `<ng-content select="[uiTopAppBarActions]" />` (Direktive `UiTopAppBarActions`). M3 Small Top App Bar: Höhe 64 px (Token), Fläche `--mat-sys-surface`, Titel `--mat-sys-title-large`, einzeilig mit Ellipse (`overflow-wrap: normal`).

**Tests:** Badge – 0 → keine sichtbare Zahl; 5 → „5“; 120 → „99+“; Zahl `aria-hidden="true"`. Top App Bar – der Titel ist kein Heading (das `h1` trägt `ui-page`), sondern ein Text mit Ellipse; Story „Schmal“ (288 px) mit langem Haushaltsnamen: kein waagerechtes Scrollen, Titel einzeilig, Aktionen ≥ 48 × 48 px.

**Steps:** wie Task 1. Commit `feat(ui): add badge and top app bar`.

---

### Task 3: `ui-adaptive-shell`

**Files:** `projects/ui/src/lib/adaptive-shell/adaptive-shell.ts/.html/.scss/.spec.ts/.stories.ts`, `navigation.ts`, `tokens/layout.css`, `public-api.ts`.

**Interfaces (Produces):**

```ts
export interface UiNavDestination {
  readonly route: string; // e.g. '/raeume'
  readonly label: string; // translated by the caller
  readonly icon: IconName;
  readonly exact?: boolean; // routerLinkActive exactness, true for '/'
}
export type UiWindowClass = 'compact' | 'medium' | 'expanded';
```

`UiAdaptiveShell` (`ui-adaptive-shell`): `destinations = input.required<readonly UiNavDestination[]>()`, `navigationLabel = input.required<string>()` (Name der `nav`-Landmarke); Inhalt: `<ng-content select="[uiShellTopBar]" />` (Direktive `UiShellTopBar`), `<ng-content select="[uiShellBanner]" />` (Direktive `UiShellBanner`), Rest = Hauptinhalt in `<main>`. Öffentliches Signal `windowClass: Signal<UiWindowClass>`.

Fensterklasse über CDK `BreakpointObserver` (in `@smart/ui` erlaubt):

```ts
const MEDIUM = '(min-width: 600px)';
const EXPANDED = '(min-width: 840px)';
// in the component:
private readonly breakpoints = toSignal(
  inject(BreakpointObserver).observe([MEDIUM, EXPANDED]),
);
readonly windowClass = computed<UiWindowClass>(() => {
  const state = this.breakpoints();
  if (state?.breakpoints[EXPANDED]) return 'expanded';
  if (state?.breakpoints[MEDIUM]) return 'medium';
  return 'compact';
});
```

Aufbau (eigene Elemente, kein `mat-sidenav`): ein `nav` mit `aria-label`, darin Links (`routerLink`, `routerLinkActive` → `aria-current="page"` über `ariaCurrentWhenActive="page"`), Icon + Beschriftung. Compact: Leiste unten fest (Höhe 80 px, Ziele gleich breit, aktive Pille `--mat-sys-secondary-container`), Hauptinhalt mit unterem Abstand der Leistenhöhe. Medium: Rail links 80 px breit, Beschriftung unter dem Icon. Expanded: Drawer links 360 px, Icon und Beschriftung nebeneinander. Längen als Tokens in `tokens/layout.css` (`--smart-size-nav-bar: 80px`, `--smart-size-nav-rail: 80px`, `--smart-size-nav-drawer: 360px`, `--smart-size-top-app-bar: 64px`). Reihenfolge im DOM: Top-Bar, Banner, Navigation, Main – „Zum Inhalt springen“ ist nicht nötig, weil `main` eine Landmarke ist.

**Tests:**

- Spec (mit `BreakpointObserver`-Stub, `provideRouter([])`): je Fensterklasse das Datenattribut `data-window-class` am Host; vier Links mit Namen; aktiver Link hat `aria-current="page"` nach Navigation.
- Stories (`provideRouter` mit Dummy-Routen und `withDisabledInitialNavigation()` wie in den 3b-Listen-Stories): `Handy`, `Tablet`, `Desktop`. Jede Story erzwingt ihre Fensterklasse deterministisch über einen `BreakpointObserver`-Stub per `applicationConfig` (feste `BreakpointState`), unabhängig von der Viewport-Breite des Test-Runners. `play`: Navigationslandmarke mit Namen, Ziele ≥ 48 × 48 px, Klick auf „Räume“ setzt `aria-current="page"`. Story `Breiten` (echter `BreakpointObserver`) prüft nur, dass bei der Runner-Breite eine der drei Formen sichtbar ist.

**Steps:** wie Task 1. Commit `feat(ui): add the adaptive shell with bar, rail and drawer`.

---

### Task 4: App-Rahmen, Feature-Registry, Routen, Sprache vorladen

**Files:** `src/app/core/features/{index.ts,feature-registry.ts,feature-registry.spec.ts}`, `src/app/core/i18n/{preload-language.ts,…}`, `src/app/shell/{shell.ts,shell.html,shell.spec.ts,not-found.ts,navigation.ts}`, `src/app/app.ts`, `app.routes.ts`, `app.config.ts`, `src/i18n/{de,en}.json`, `projects/ui/src/lib/icon/icons.json` (+ `pnpm icons:build`), `apps/frontend/transloco.config.cjs`, `tools/lint-config/i18n/check-translation-keys.mjs` (+ Test).

**Interfaces (Produces):**

```ts
// core/features/feature-registry.ts
export interface MoreEntry {
  readonly id: string;
  readonly labelKey: string; // root translation key, marked with marker()
  readonly icon: IconName;
  readonly route?: string; // without route: shown as "kommt bald", not clickable
  readonly order: number;
}
export interface FeatureDefinition {
  readonly moreEntries?: readonly MoreEntry[];
  readonly overviewCards?: readonly Type<unknown>[];
}
export const FEATURES = new InjectionToken<readonly FeatureDefinition[]>('FEATURES');
export function provideFeature(definition: FeatureDefinition): Provider {
  return { provide: FEATURES, useValue: definition, multi: true };
}
/** All registered entries, sorted by order; empty when no feature registered any. */
export function injectMoreEntries(): MoreEntry[] {
  const features = inject(FEATURES, { optional: true }) ?? [];
  return features.flatMap((f) => f.moreEntries ?? []).sort((a, b) => a.order - b.order);
}
export function injectOverviewCards(): Type<unknown>[] {
  const features = inject(FEATURES, { optional: true }) ?? [];
  return features.flatMap((f) => f.overviewCards ?? []);
}
```

Sprache vor dem ersten Rendern (3c-Übertrag), in `provideI18n()` ergänzen:

```ts
provideAppInitializer(() => {
  const language = inject(LanguageService).language();
  return firstValueFrom(inject(TranslocoService).load(language)).then(() => undefined);
}),
```

Rahmen: `App` rendert `<app-shell />`; `Shell` nutzt `ui-adaptive-shell` mit vier Zielen (Labels aus Wurzelschlüsseln `app.nav.overview|rooms|devices|more`, Icons `home`, `meeting_room`, `devices`, `more_horiz`), `ui-top-app-bar` mit Haushaltsname `app.household.placeholder` und Glocke: `<a [routerLink]="'/mehr'">` mit `ui-badge [count]="0"` um `ui-icon name="notifications"` und `aria-label` aus `app.notifications.none`. Dafür braucht die Glocke einen Link-Icon-Button: `UiIconButton.route` analog zu Task 1 ergänzen (Spec + Story).

Routen (`app.routes.ts`):

```ts
export const routes: Routes = [
  { path: '', loadChildren: () => import('./features/dashboard').then((m) => m.dashboardRoutes) },
  { path: 'raeume', loadChildren: () => import('./features/rooms').then((m) => m.roomsRoutes) },
  {
    path: 'geraete',
    loadChildren: () => import('./features/devices').then((m) => m.devicesRoutes),
  },
  { path: 'mehr', loadChildren: () => import('./features/more').then((m) => m.moreRoutes) },
  { path: '**', loadComponent: () => import('./shell/not-found').then((m) => m.NotFound) },
];
```

`mehr/einstellungen/**` hängt der `more`-Feature nicht selbst ein (Features importieren sich nicht): `app.routes.ts` bekommt vor `mehr` den Eintrag `{ path: 'mehr/einstellungen', loadChildren: () => import('./features/settings').then((m) => m.settingsRoutes) }`. Die Feature-Ordner aus Task 5 existieren ab hier als Gerüst mit je `index.ts` (`xRoutes: Routes` mit einer leeren Seite), damit die App baut; Task 5 füllt sie.

„Nicht gefunden“: `ui-page` mit `ui-empty-state` (Icon `search`) und `ui-button route="/"`.

Übersetzungen: Wurzel `app.*` (Navigation, Haushalt, Glocke, Nicht gefunden, Mehr-Einträge). Feature-Scopes mit Inline-Loader in den Feature-Routen:

```ts
providers: [
  provideTranslocoScope({
    scope: 'dashboard',
    loader: {
      de: () => import('./i18n/de.json').then((m) => m.default),
      en: () => import('./i18n/en.json').then((m) => m.default),
    },
  }),
],
```

Schlüsselprüfung für Scopes: `apps/frontend/transloco.config.cjs` erhält `scopePathMap: { dashboard: 'src/app/features/dashboard/i18n', rooms: …, devices: …, more: …, settings: … }`; der Wrapper `check-translation-keys.mjs` prüft zusätzlich, dass jeder Pfad aus `scopePathMap` existiert und `de.json`/`en.json` enthält (Test: fehlende Scope-Datei → Fehler, wie die vorhandenen Tests). Im 3c-Versuch bestätigt: Template-Schlüssel `'dashboard.title' | transloco` werden dem Scope zugeordnet, wenn `provideTranslocoScope({ scope: 'dashboard', … })` als Literal im Eingabeordner steht.

Neue Symbole in `icons.json` (alphabetisch): `extension` (Module), `home_work` (Haushalt), `router` (Gateways); dann `pnpm icons:build`.

**Tests:**

- Registry: zwei Features mit Einträgen → sortiert nach `order`; ohne Features → leere Liste.
- Preload: nach `TestBed.inject(ApplicationInitStatus).donePromise` ist die Übersetzung der aktiven Sprache geladen (`TranslocoService.getTranslation('en')` nicht leer bei Browser `en-US`).
- Shell: vier Ziele mit deutschen Namen; Glocke ist Link nach `/mehr` mit Namen „Benachrichtigungen, keine neuen“; „Nicht gefunden“ bei unbekannter Route (Router-Test mit `RouterTestingHarness`).
- Schlüsselprüfung: neuer Wrapper-Test für fehlenden Scope-Ordner.

**Steps:** TDD je Einheit; `pnpm i18n:check`; Prüfung am Ende der Task. Commit(s) `feat(frontend): add the app shell, feature registry and lazy routes`.

---

### Task 5: Seiten und Einstellungen

**Files:** `src/app/features/{dashboard,rooms,devices,more,settings}/**` (je `index.ts`, Routen, Seite(n), `i18n/{de,en}.json`, Specs), `src/app/core/i18n/language-store.ts` (Tab-Abgleich), `src/app/app.config.ts` (Feature-Provider).

**Verhalten:**

- **Übersicht, Räume, Geräte:** `ui-page` (Titel `h1`) mit `ui-empty-state` (Icon `home`/`meeting_room`/`devices`), kurzer Text, was dort erscheinen wird (Spec 2). Übersicht rendert darunter registrierte Übersichtskarten (`injectOverviewCards()`, `NgComponentOutlet`); in 3d sind es keine.
- **Mehr:** `ui-list` aus `injectMoreEntries()` plus statische „kommt bald“-Einträge Module (`extension`), Benachrichtigungen (`notifications`), Haushalt (`home_work`), Gateways (`router`) ohne Route mit Nebentext „Kommt bald“ (nicht anklickbar, nicht fokussierbar). Einstellungen kommt aus dem Settings-Feature: `provideSettingsFeature()` in `features/settings/index.ts` → `provideFeature({ moreEntries: [{ id: 'settings', labelKey: marker('app.more.settings'), icon: 'settings', route: '/mehr/einstellungen', order: 90 }] })`; `app.config.ts` ruft es auf. Alle Labels der Einträge sind Wurzelschlüssel (`app.more.*`).
- **Einstellungen (`/mehr/einstellungen`):** Liste „Darstellung“ und – nur bei `RUNTIME_CONFIG.features.instanceAppearanceEditor` – „Erscheinungsbild der Installation“.
- **Darstellung:** `ui-page`; `ui-section` „Sprache“ mit `ui-segmented-button` (Deutsch/English, Wert = `LanguageService.language()`, Änderung → `setLanguage`); darunter `ui-theme-editor mode="personal"` gebunden wie in der 3c-Live-Story (`(personalChange)="theme.setPersonal($event)"`, `(resetRequested)="theme.resetPersonal()"`). Änderungen wirken sofort (Spec 2).
- **Installation:** `ui-theme-editor mode="instance"` mit `[instance]="theme.instance()"`, `(instanceChange)="theme.setInstance($event)"`, `(resetRequested)="theme.resetInstance()"`. Route mit `canMatch`-Guard: bei ausgeschaltetem Schalter gibt er `inject(Router).parseUrl('/mehr/einstellungen')` zurück (Umleitung, auch bei Direktaufruf).
- **Sprache zwischen Tabs** (3c-Übertrag): `LanguageStore.watch(callback)` analog zum Theme-Speicher (`storage`-Ereignis auf `smart.language`, `key === null` mit eingeschlossen); `LanguageService` übernimmt die neue Sprache (ohne erneut zu speichern).

**Tests:**

- Mehr: Einstellungen-Eintrag ist Link; die vier „kommt bald“-Einträge sind keine Links und nicht fokussierbar; Reihenfolge nach `order`.
- Einstellungen: Installations-Eintrag nur bei Schalter an; Guard: Navigation zu `/mehr/einstellungen/installation` bei Schalter aus endet auf `/mehr/einstellungen` (`RouterTestingHarness`).
- Darstellung: Klick auf „English“ ruft `setLanguage('en')`; Modus „Dunkel“ ändert `ThemeService.personal().mode`; Zurücksetzen ruft `resetPersonal`.
- Sprach-Tab-Abgleich: `StorageEvent` mit `smart.language = "en"` → `language()` ist `en`, Speicher nicht erneut beschrieben; gesperrter Speicher → kein Fehler, Sprache wirkt in der Sitzung.
- Seiten-Specs prüfen Titel (`h1`) und Leer-Zustand je Seite auf Deutsch und Englisch.

**Steps:** TDD je Seite; Feature-Übersetzungen pro Scope; `pnpm i18n:check`; Prüfung am Ende der Task. Commits je Feature, z. B. `feat(frontend): add overview, rooms and devices pages`, `feat(frontend): add more and settings pages`.

---

### Task 6: App-Icon

**Files:** `tools/app-icon/{package.json,app-icon.svg,generate.mjs,test/app-icon.spec.mjs,vitest.config.mjs}`, `apps/frontend/public/icons/*`, `apps/frontend/public/favicon.svg`, `apps/frontend/src/index.html`, Wurzel-`package.json` (`"app-icon:build": "pnpm --filter @smart/app-icon generate"`), `CLAUDE.md` (Befehlstabelle). `public/favicon.ico` löschen.

`app-icon.svg` = Anhang A der Spec (wörtlich). `generate.mjs` rendert mit Playwright (Chromium, `deviceScaleFactor: 1`, transparenter Hintergrund nicht nötig – das Icon hat eine volle Fläche):

```js
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const OUT = join(import.meta.dirname, '../../apps/frontend/public');
const SIZES = [
  ['icons/icon-192.png', 192],
  ['icons/icon-512.png', 512],
  ['icons/apple-touch-icon.png', 180],
  ['icons/favicon-32.png', 32],
];

export async function generate() {
  const svg = await readFile(join(import.meta.dirname, 'app-icon.svg'), 'utf8');
  await mkdir(join(OUT, 'icons'), { recursive: true });
  await writeFile(join(OUT, 'favicon.svg'), svg);
  const browser = await chromium.launch();
  try {
    for (const [file, size] of SIZES) {
      const page = await browser.newPage({ viewport: { width: size, height: size } });
      await page.setContent(
        `<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
      );
      await writeFile(join(OUT, file), await page.screenshot({ type: 'png' }));
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await generate();
```

Maskierbar: Das Motiv liegt zwischen x 26 und 82 von 108 (≈ 52 %), also innerhalb der Sicherheitszone (80 % Kreis); `icon-512.png` dient auch als `maskable`.

`index.html`: `<link rel="icon" href="favicon.svg" type="image/svg+xml" />`, `<link rel="icon" href="icons/favicon-32.png" sizes="32x32" type="image/png" />`, `<link rel="apple-touch-icon" href="icons/apple-touch-icon.png" />`.

**Tests (`tools/app-icon/test`):** jede PNG existiert und hat laut IHDR (Bytes 16–23) die erwartete Breite/Höhe; die SVG-Datei in `public` ist identisch mit der Quelle; Pixel (0,0) der 512er-PNG ist die Hintergrundfarbe `#d8f6ff` (PNG im Test per Playwright laden und mit Canvas auslesen) – Byte-Gleichheit der PNGs wird nicht geprüft (Plattformunterschiede, Lehre aus 3b). Lizenzprüfung bleibt grün (keine neuen Pakete).

**Steps:** Test rot → Generator → `pnpm app-icon:build` → grün; App-Build; Commit `feat(frontend): add the app icon and favicons`.

---

### Task 7: PWA – Manifest, Service Worker, Offline- und Update-Banner

**Files:** `apps/frontend/package.json` (`@angular/service-worker`), `angular.json` (`serviceWorker: "ngsw-config.json"` in den Build-Optionen), `apps/frontend/ngsw-config.json`, `apps/frontend/public/manifest.webmanifest`, `src/index.html` (Manifest-Link, `theme-color`), `src/app/core/pwa/{index.ts,online-status.ts,app-updates.ts,*.spec.ts}`, `src/app/shell/*` (Banner), `app.config.ts`, `apps/frontend/nginx/default.conf`, Wurzel-Übersetzungen.

`ngsw-config.json`:

```json
{
  "$schema": "./node_modules/@angular/service-worker/config/schema.json",
  "index": "/index.html",
  "navigationUrls": ["/**", "!/**/*.*", "!/**/*__*", "!/**/*__*/**", "!/api/**", "!/healthz"],
  "assetGroups": [
    {
      "name": "app",
      "installMode": "prefetch",
      "resources": {
        "files": [
          "/index.html",
          "/manifest.webmanifest",
          "/theme-boot.js",
          "/*.css",
          "/*.js",
          "/favicon.svg",
          "/icons/*"
        ]
      }
    },
    {
      "name": "assets",
      "installMode": "lazy",
      "updateMode": "prefetch",
      "resources": { "files": ["/media/**", "/**/*.woff2"] }
    }
  ],
  "dataGroups": [
    {
      "name": "runtime-config",
      "urls": ["/config.json"],
      "cacheConfig": { "strategy": "freshness", "timeout": "2s", "maxSize": 1, "maxAge": "30d" }
    }
  ]
}
```

`/config.json` steht bewusst **nicht** in einer Asset-Gruppe (3c-Übertrag): Die Datei im Image ist die Entwicklungsdatei, der Container liefert seine eigene. `theme-boot.js` ist im App-Asset-Set (Hash in `ngsw.json`, Name ohne Hash – 3a-Übertrag).

`manifest.webmanifest`: `name`/`short_name` „Smart Home“, `start_url` „/“, `scope` „/“, `display` „standalone“, `lang` „de“, `theme_color` „#00687a“, `background_color` „#f5fafc“, Icons 192 (`any`), 512 (`any`), 512 (`maskable`). `index.html`: `<link rel="manifest" href="manifest.webmanifest" />`, `<meta name="theme-color" content="#00687a" />`.

nginx (vor der Regel für `js|css|woff2`, weil Regex-Locations in Reihenfolge greifen):

```nginx
  # Service worker files must be revalidated, or clients keep an old app version.
  location ~ ^/(ngsw-worker\.js|ngsw\.json|safety-worker\.js|worker-basic\.min\.js)$ {
    try_files $uri =404;
    add_header Cache-Control "no-cache" always;
    include /etc/nginx/snippets/security-headers.conf;
  }

  location = /manifest.webmanifest {
    try_files $uri =404;
    default_type application/manifest+json;
    add_header Cache-Control "no-cache" always;
    include /etc/nginx/snippets/security-headers.conf;
  }
```

App: `provideServiceWorker('ngsw-worker.js', { enabled: !isDevMode(), registrationStrategy: 'registerWhenStable:30000' })`.

`core/pwa`:

- `OnlineStatus` (`providedIn: 'root'`): `online: Signal<boolean>` aus `navigator.onLine` und den Fenster-Ereignissen `online`/`offline` (Token `NAVIGATOR_ONLINE` für Tests).
- `AppUpdates`: `updateReady: Signal<boolean>` aus `SwUpdate.versionUpdates` (`VERSION_READY`), `reload(): void` → `document.location.reload()` (über `DOCUMENT`); bei `!swUpdate.isEnabled` bleibt `false`.
- Shell zeigt über dem Inhalt (`uiShellBanner`): `ui-banner tone="offline"` mit `app.offline` („Offline – Anzeigen können veraltet sein“) solange offline; `ui-banner tone="info"` mit `app.update.text` („Neue Version verfügbar“) und `ui-button variant="text"` `app.update.reload` („Neu laden“). Beim Erscheinen ansagen: `UiAnnouncer.announce(text, 'polite')` (3b-Übertrag: `role="status"` beim Einfügen wird nicht zuverlässig angesagt).

**Tests:** OnlineStatus folgt `offline`/`online`-Ereignissen; AppUpdates: Stub `SwUpdate` mit `versionUpdates`-Subject → `VERSION_READY` setzt `updateReady`, `reload` ruft `location.reload` (Stub-Document); Shell: Offline-Banner erscheint/verschwindet und wird angesagt (Spy auf `UiAnnouncer`), Update-Banner mit Knopf „Neu laden“.

**Steps:** TDD; Build prüfen (`dist/frontend/browser/ngsw.json` vorhanden, enthält `theme-boot.js`, nicht `config.json`); Stack-Test; Commit `feat(frontend): make the app installable with offline and update banners`.

---

### Task 8: Staging-Schalter im Provisioning

**Files:** `infra/deploy/provision.sh`, `infra/deploy/test/run-tests.sh`, `docs/runbooks/provisioning.md`.

Verhalten: Für `staging` schreibt `provision.sh` zusätzlich `SMART_INSTANCE_APPEARANCE_EDITOR=true`. Bei `--force` übernimmt es vorhandene `SMART_*`-Zeilen aus der alten `.env` unverändert (wie die Passwörter), statt sie zu verwerfen; neue Werte für Staging nur, wenn keine vorhanden sind. Produktion bekommt keinen Schalter.

**Tests (`run-tests.sh`, Muster der vorhandenen `check`-Zeilen):** Staging-`.env` enthält `SMART_INSTANCE_APPEARANCE_EDITOR=true`; Produktion enthält keine `SMART_INSTANCE_APPEARANCE_EDITOR`-Zeile; `--force` mit bestehender `.env`, die `SMART_INSTANCE_APPEARANCE={...}` enthält, behält die Zeile wörtlich.

**Steps:** Tests rot → Umsetzung → `bash infra/deploy/test/run-tests.sh` grün; Runbook-Satz ergänzen; Commit `feat(infra): provision the staging editor switch and keep runtime settings`.

**Hinweis für Till nach dem Merge:** Wer die Zeile schon von Hand eingetragen hat, muss nichts tun.

---

### Task 9: Playwright-Smoke gegen den Stack

**Files:** `tests/e2e/specs/app-shell.spec.ts` (neu), `tests/e2e/specs/stack-smoke.spec.ts` (Schrift-Test verschärfen), `tests/e2e/playwright.config.ts` (falls ein Projekt für Handybreite nötig ist).

**Tests (Spec 10):**

1. **Navigation Handy (390 × 844):** Navigationsleiste unten sichtbar, vier Ziele; Klick „Räume“ → URL `/raeume`, `h1` der Räume-Seite, Ziel `aria-current="page"`.
2. **Navigation Desktop (1280 × 800):** Drawer links sichtbar; Klick „Mehr“ → Liste mit „Einstellungen“; „Kommt bald“-Einträge sind keine Links.
3. **Breitenwechsel:** Seite bei 1280 laden, auf 700 verkleinern → Rail sichtbar, Leiste/Drawer nicht; auf 390 → Leiste unten.
4. **Direktaufruf tiefer Routen:** `/mehr/einstellungen/darstellung` lädt direkt die Darstellungsseite; `/gibt-es-nicht` zeigt „Nicht gefunden“ mit Link zur Übersicht.
5. **Theme bleibt nach Neuladen:** auf Darstellung Modus „Dunkel“ wählen, neu laden → `color-scheme` dunkel ohne Aufblitzen: Messung in `page.addInitScript` (beim ersten Frame `getComputedStyle(document.documentElement).colorScheme` in `window.__firstScheme` speichern) → `dark`.
6. **Sprachwechsel:** „English“ wählen → Navigation „Overview/Rooms/Devices/More“, `html[lang=en]`; nach Neuladen weiterhin Englisch.
7. **Installations-Einstellungen:** im Stack (Schalter an) erreichbar und zeigt Formen/Schrift.
8. **Manifest und Service Worker:** `link[rel=manifest]` lädt mit 200, `application/manifest+json`, Name „Smart Home“, drei Icons erreichbar; nach dem Laden ist ein Service Worker registriert (`navigator.serviceWorker.ready`); `ngsw.json` und `ngsw-worker.js` haben `Cache-Control: no-cache`.
9. **Keine CSP-Verstöße und Konsolenfehler** beim Durchklicken aller Ziele (vorhandenen Test auf alle Seiten erweitern).
10. **Nur aktive Schrift** (3a-Übertrag verschärfen): auf der Übersicht wird Roboto Flex angefragt, Figtree/Atkinson nicht.

**Steps:** Tests schreiben → Stack-Test (zuerst rot, wo Funktionen fehlen) → grün; Commit `test(e2e): cover navigation, theme, language and PWA in the stack`.

---

### Task 10: Doku und Abschluss

- `projects/ui/README.md`: Bausteine um `ui-badge`, `ui-top-app-bar`, `ui-adaptive-shell` ergänzen; `UiAnnouncer`, Link-Modus von Button/Icon-Button, Snackbar ohne Zeitlimit mit Aktion.
- `CLAUDE.md`: Befehl `pnpm app-icon:build`; Regel „Features registrieren sich über `provideFeature()`, Seitentexte als Feature-Scope, markierte Schlüssel in der Wurzelübersetzung“.
- `docs/runbooks/provisioning.md`: Hinweis zu Manifest-Farbe (Build-Default) und Service Worker (Update erscheint als Banner).
- Spec Etappe 3: Abschnitt 3 um `/mehr/einstellungen` ergänzen; Abschnitt 5 `ui-chip` → `ui-chip-set` und `ui-select` (3c) – mit einem Satz Begründung.
- Gesamtprüfung wie Plan 3c Task 10 Step 5 (inkl. Storybook, Stack-Test, Private-Scan); Commit `docs: describe the app shell, PWA and feature registration`.

---

## Ergebnis und Übertrag

Umgesetzt subagent-gestützt (Sonnet für Umsetzung und Reviews, Haiku für Task 8 und 10, Opus für das Gesamt-Review mit einer Nachbesserungsrunde). Dieser Abschnitt hält fest, wo die Umsetzung vom Plan abweicht und was Etappe 4 übernehmen muss.

### Abweichungen vom Plan (Entscheidungen)

- **CSP (Entscheidung Till):** `style-src 'self' 'unsafe-inline'` statt einer Nonce pro Anfrage. nginx schrieb die Nonce in `index.html`, der Service Worker prüft die Datei aber Byte für Byte gegen `ngsw.json` und hätte nie installiert. Skripte bleiben streng (`'self'`, keine Inline-Skripte); ein E2E-Test vergleicht den Hash der ausgelieferten `index.html` mit `ngsw.json`.
- **`@smart/ui/forms` (neuer Einstieg):** Formular-Bausteine und `UiThemeEditor` kommen aus `@smart/ui/forms`, alles andere aus `@smart/ui`. Sonst zog der Barrel-Import der Shell rund 300 kB Material-Code ins initiale Bundle. Lint verbietet `@smart/ui/forms` in `core/`, `shell/` und den App-Wurzeldateien.
- **Bundle:** initial 498,35 kB (Grenze 500 kB). Deshalb ohne `withInMemoryScrolling` (+4 kB): Vorwärts-Navigation scrollt nach oben, Zurück/Vor überlässt die Scrollposition dem Browser.
- **Liste:** „Kommt bald“-Zeilen sind normale, nicht klickbare Zeilen mit lesbarem Nebentext; deaktivierte Zeilen sind in axe nur von der Kontrastregel ausgenommen.
- **Snackbar-Schließfarbe** als Material-Override in `tokens/_material.scss`; **Rahmen:** `z-index`-Token für die untere Leiste, `isolation: isolate` am Inhalt, globales `scroll-padding-bottom` auf dem Handy (WCAG 2.4.11).
- **Seitentitel und Fokus (Gesamt-Review):** jede Route hat einen übersetzten Titel („Räume – Smart Home“), nach einer Navigation springt der Fokus auf die Seitenüberschrift.
- **Theme-Editor** setzt `TRANSLOCO_SCOPE` zurück, sonst fand `translateSignal` in Seiten mit eigenem Scope die `ui.*`-Schlüssel nicht.
- **Provisioning:** Staging bekommt `SMART_INSTANCE_APPEARANCE_EDITOR=true`, `--force` behält vorhandene `SMART_*`-Zeilen.
- **Tests:** App-Icon-Test ohne Browser (die CI installiert im `verify`-Job keinen); E2E-Test „kein Aufblitzen“ lädt ohne App-Bundle und mit blockiertem Service Worker neu; Playwright läuft mit `locale: 'de-DE'`.

### Übertrag in Etappe 4

- **Zuerst Platz im Bundle schaffen** (1,6 kB Luft): Farb-Engine nach dem ersten Bild nachladen (`theme-boot.js` deckt den ersten Paint), Zod im initialen Bundle prüfen; danach `withInMemoryScrolling` nachziehen.
- **`Shell` als Layout-Route** (`{ path: '', component: Shell, children: […] }`), damit eine Login-Seite außerhalb des Rahmens liegt.
- Updates: periodisches `checkForUpdate()` bzw. bei `visibilitychange`, `SwUpdate.unrecoverable` behandeln; Navigationsfehler (fehlender Chunk offline) mit Hinweis statt stillem Nichts; Symbolschrift im Service Worker vorab laden.
- Snackbar über der unteren Leiste versetzen; doppelte Ansage (Banner `role="status"` plus Announcer) prüfen; Scope-Übersetzungen per Resolver vorladen (Überschriften erscheinen sonst kurz verzögert); Zurück-Weg auf Unterseiten (installierte iOS-App); aktiver Zustand im Forced-Colors-Modus.
- Installations-Schalter (Einstellungsseite und `canMatch`) durch die Admin-Rolle ersetzen; `MoreEntry` um Sichtbarkeit/Rolle erweitern; Haushaltsname aus dem Haushalt.
- Zwei Unit-Specs (Übersetzungs-Loader, Installationsseite) sind beim Kaltstart je einmal gekippt („environment torn down“) – beobachten.

### Bewusst zurückgestellt (klein)

- Badge ohne Schutz gegen `NaN`/Bruchzahlen (Zähler bis Etappe 7 immer 0); gekürzter Haushaltsname ohne `title`.
- Titel-Strategie: verwaister `afterNextRender`-Hook bei zwei schnellen Navigationen; jsdom-Rauschen zu `scrollTo` in der Spec; Query-/Fragment-Navigationen würden ebenfalls scrollen und fokussieren.
- Statische `theme-color` und Manifest-Sprache; Sprachnamen als Literale; Provisioning-Randfälle ohne eigenen Test; kleinere Story-/Test-Lücken laut Reviews (u. a. Fokus-Tests der Shell, Schriftprüfung nur für Roboto Flex).
