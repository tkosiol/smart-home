import { randomUUID } from 'node:crypto';
import postgres from 'postgres';

/** Creates an empty database on the test server and returns its URL. */
export async function createFreshDatabase(baseUrl: string): Promise<string> {
  const admin = postgres(baseUrl, { max: 1, onnotice: () => undefined });
  const name = `t_${randomUUID().replaceAll('-', '')}`;
  try {
    await admin.unsafe(`create database ${name}`);
  } finally {
    await admin.end();
  }
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  return url.toString();
}
