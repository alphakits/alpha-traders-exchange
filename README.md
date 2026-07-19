# Alpha Traders

## Requirements

- Node.js 20+
- npm 10+

## First install

```bash
npm install
```

## Normal development

```bash
npm run dev
```

Starts the Next.js dev server on `http://localhost:3000`.
If another dev server is already running for this repo, the command now exits early with a clear message to prevent chunk-cache corruption.

## Clean rebuild (recommended after runtime/chunk issues)

```bash
npm run clean
npm run dev
```

Or run both in one command:

```bash
npm run dev:clean
```

`clean` removes generated runtime directories:
- `.next`
- `.next-dev`
- `.next-runtime`
- `.next-runtime-build`
- `.next-stale`

## Production build

```bash
npm run build
npm run start
```

`npm run build` now refuses to run if a repo-local `next dev` process is active, preventing shared `.next` corruption.

## Quality checks

```bash
npm run lint
```

## Common troubleshooting

1. **Cannot find module './<chunk>.js'**  
   Run `npm run dev:clean` and restart the server.
2. **Dev server behaves inconsistently after branch switches**  
   Run `npm run clean`, then `npm run dev`.
3. **Build works locally but runtime is stale**  
   Ensure no generated Next.js artifact folders are committed.
4. **Cannot find module './<chunk>.js' while multiple dev terminals are open**  
   Stop all existing `next dev` processes for this repo, then run `npm run dev:clean`.
5. **Cannot find module './<chunk>.js' after running build and dev at the same time**  
   Stop `next dev`, run `npm run clean`, then run either `npm run dev` or `npm run build` (not both concurrently).
6. **`ERR_CONNECTION_REFUSED` on `http://localhost:3000`**  
   No dev server is currently listening on port 3000. Start it with `npm run dev` and keep that terminal running.

## Recommendation on custom `distDir`

The previous custom `distDir` setting was not required by the app itself and increased risk of stale artifact drift across multiple runtime folders.  
This project now uses Next.js default output (`.next`) for a more stable development workflow.
