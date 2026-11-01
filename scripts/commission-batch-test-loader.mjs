// Isolated tests: resolve local TypeScript modules without installing the application.
// No production module is replaced or mocked by this loader.
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && context.parentURL && !/\.[cm]?[jt]s$/.test(specifier)) {
    const target = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(fileURLToPath(target))) return nextResolve(target.href, context);
  }
  return nextResolve(specifier, context);
}});
