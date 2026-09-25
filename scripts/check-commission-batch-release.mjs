import { spawnSync } from 'node:child_process';
const env = { ...process.env, NODE_ENV:'test', ALPHA_EXCHANGE_COMMISSION_BATCH_V1:'0', ALPHA_EXCHANGE_FORCE_INMEMORY_REPOSITORY:'1' };
// A release test must never connect to production persistence or a real receiving account.
for (const key of ['DATABASE_URL','SUPABASE_DB_URL','ALPHA_EXCHANGE_BINANCE_READ_API_KEY','ALPHA_EXCHANGE_BINANCE_READ_API_SECRET','VERCEL_ENV','VERCEL']) delete env[key];
const checks = [
 ['--experimental-strip-types','--import','./scripts/commission-batch-test-loader.mjs','--test','scripts/check-commission-batch-policy.mjs','scripts/check-commission-batch-integration.mjs'],
 ['./node_modules/vitest/vitest.mjs','run','src/lib/commission-batch-reservations.test.ts','src/lib/commission-batch-tron-verifier.test.ts',
  'src/app/api/admin/commission-batches/route.test.ts','src/app/api/cron/commission-payment-verification/batches.test.ts','src/app/api/cron/commission-payment-verification/route.test.ts',
  'src/__tests__/commission-payment-routing.test.ts'],
];
for (const args of checks) {
 const result = spawnSync(process.execPath,args,{stdio:'inherit',env});
 if (result.error || result.status!==0) { console.error('Commission batch release gate failed.');process.exit(result.status??1); }
}
