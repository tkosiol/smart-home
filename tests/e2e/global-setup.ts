import { signInThroughApi } from './helpers/api-sign-in';

/** Signs the accounts that the other specs use in once, instead of once per test. */
export default async function globalSetup(): Promise<void> {
  await signInThroughApi('shell');
  await signInThroughApi('smoke');
}
