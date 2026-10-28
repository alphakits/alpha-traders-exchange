import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectId = 'prj_2ZrlYsszRDNyll1lkZ69BYs9tHpL';
export const teamId = 'team_RI4GCZrJfs5fCWqQKl06DYGS';
export const targetRef = 'ntnehgenzsooxwznrzzx';
export const repo = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
export const need = (condition, code) => { if (!condition) throw new Error(code); };

export function absolutePath(value, code) {
  need(typeof value === 'string' && path.isAbsolute(value) && !/[\0\r\n]/.test(value)
    && !value.split(/[\\/]/).includes('..'), code);
  return path.resolve(value);
}

export const work = path.join(repo, 'tmp', 'wise-staging');
export function fixtureDirectory(env = process.env) {
  const result = absolutePath(env.ALPHA_WISE_STAGING_FIXTURE_DIR, 'EXPLICIT_PRIVATE_FIXTURE_DIRECTORY_REQUIRED');
  const relative = path.relative(repo, result);
  need(relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative), 'PRIVATE_FIXTURES_MUST_BE_OUTSIDE_SOURCE');
  return result;
}
