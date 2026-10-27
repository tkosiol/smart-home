// Fixture: loads its content on demand and imports only a type from it statically, so
// snackbar-content.ts is not part of the eager entry.
import type { Content } from './snackbar-content';
export const UiSnackbar = (): Promise<Content> => import('./snackbar-content');
