import { spawnSync } from 'node:child_process';
// Never pass production DB, wallet, mail, SMS or other service credentials into tests.
const env = Object.fromEntries(['PATH','HOME','TMPDIR','TMP','TEMP','LANG','LC_ALL','CI']
 .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
Object.assign(env, { NODE_ENV:'test', ALPHA_EXCHANGE_COMMISSION_BATCH_V1:'0', ALPHA_EXCHANGE_FORCE_INMEMORY_REPOSITORY:'1' });
const checks = [
 ['--experimental-strip-types','--import','./scripts/commission-batch-test-loader.mjs','--test','scripts/check-commission-batch-policy.mjs','scripts/check-commission-batch-integration.mjs'],
 ['./node_modules/vitest/vitest.mjs','run','src/lib/commission-batch-reservations.test.ts','src/lib/commission-batch-tron-verifier.test.ts',
  'src/app/api/admin/commission-batches/route.test.ts','src/app/api/cron/commission-payment-verification/batches.test.ts','src/app/api/cron/commission-payment-verification/route.test.ts',
  'src/__tests__/commission-payment-routing.test.ts','src/lib/commission-batch-runtime.test.ts','src/lib/commission-receipt-review.test.ts',
  'src/app/api/admin/commission-receipts/route.test.ts','src/components/admin/commission-receipt-review-panel.test.tsx'],
];
for (const args of checks) {
 const result = spawnSync(process.execPath,args,{stdio:'inherit',env});
 if (result.error || result.status!==0) { console.error('Commission batch release gate failed.');process.exit(result.status??1); }
}
