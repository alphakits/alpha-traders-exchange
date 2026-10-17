import { spawnSync } from 'node:child_process';
const env = Object.fromEntries(['PATH','HOME','TMPDIR','TMP','TEMP','LANG','LC_ALL','CI'].filter(key=>process.env[key]!==undefined).map(key=>[key,process.env[key]]));
Object.assign(env,{NODE_ENV:'test',ALPHA_EXCHANGE_COMMISSION_CHECKOUT_V1:'0',ALPHA_EXCHANGE_COMMISSION_BATCH_V1:'0',ALPHA_EXCHANGE_FORCE_INMEMORY_REPOSITORY:'1'});
// Keep the CPU-heavy embedded PostgreSQL suite from starving DOM assertions
// on small hosting build machines. All cases and their timeouts remain enforced.
for(const args of [
 ['--experimental-strip-types','--import','./scripts/commission-batch-test-loader.mjs','--test','scripts/check-commission-checkout.mjs','scripts/check-commission-checkout-recovery.mjs','scripts/check-commission-checkout-repeat.mjs'],
 ['./node_modules/vitest/vitest.mjs','run','--no-file-parallelism','src/lib/commission-checkout-reservations.test.ts','src/lib/commission-checkout-runtime.test.ts','src/app/api/alpha-exchange/commissions/checkout/route.test.ts','src/app/api/cron/commission-checkout/route.test.ts','src/components/sections/usdt-exchange/commission-checkout-panel.test.tsx'],
]) {
 const result=spawnSync(process.execPath,args,{stdio:'inherit',env});
 if(result.error||result.status!==0){console.error('Automatic checkout release gate failed.');process.exit(result.status??1);}
}
