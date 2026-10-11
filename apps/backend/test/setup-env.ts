import { inject } from 'vitest';

Object.assign(process.env, inject('testEnv'), { NODE_ENV: 'test', LOG_LEVEL: 'silent' });
