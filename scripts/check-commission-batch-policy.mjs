import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planCommissionBatch, commissionReceiptKey, commissionAmountMicros } from '../src/lib/commission-batch-policy.ts';
const now = Date.parse('2026-09-25T14:20:00Z');
const records = [
  { id:'cm42', sellerId:'seller', commissionAmount:18.3, paymentStatus:'pending', createdAt:'2026-09-25T14:03:48Z', updatedAt:'2026-09-25T14:03:48Z' },
  { id:'cm43', sellerId:'seller', commissionAmount:20, paymentStatus:'pending', createdAt:'2026-09-25T14:07:10Z', updatedAt:'2026-09-25T14:07:10Z' },
];
const receipt = { signature:'binance-deposit:123456789012345678', network:'BEP20', amountMicros:38_000_000, timestamp:Date.parse('2026-09-25T14:09:08Z') };
const attribution = { kind:'owner_confirmed_receipt', sellerId:'seller', commissionIds:['cm42','cm43'], signature:receipt.signature,
  network:'BEP20', expectedAmountMicros:38_300_000, approvedByUserId:'owner' };
const run = (changes={}) => planCommissionBatch({records:structuredClone(records), receipt:{...receipt}, attribution:structuredClone(attribution), now, ...changes});
const checkReject=(changes,reason)=>assert.deepEqual(run(changes),{accepted:false,reason});
for (const [amount, accepted] of [[38,true],[38.3,true],[37.3,true],[39.3,true],[37.299999,false],[39.300001,false],[0,false],[-1,false]]) {
  test(`combined 38.30 with ${amount} received`,()=>assert.equal(run({receipt:{...receipt,amountMicros:Math.round(amount*1e6)}}).accepted,accepted));
}
test('38 payment records 0.30 waiver, not 38.30 received',()=>{
 const p=run(); assert.equal(p.accepted,true); assert.equal(p.receivedMicros,38_000_000); assert.equal(p.waivedMicros,300_000); assert.equal(p.excessMicros,0);
 assert.equal(p.allocations.reduce((s,a)=>s+a.receivedMicros,0),38_000_000); assert.equal(p.allocations.reduce((s,a)=>s+a.waivedMicros,0),300_000);
});
test('overpayment is retained in audit math, not silently discarded',()=>{const p=run({receipt:{...receipt,amountMicros:39_000_000}});assert.equal(p.accepted,true);assert.equal(p.excessMicros,700_000);assert.equal(p.waivedMicros,0);});
test('no amount-only seller guessing',()=>checkReject({attribution:null},'attribution_required'));
test('untrusted attribution kind refused',()=>checkReject({attribution:{...attribution,kind:'amount_only'}},'invalid_attribution'));
test('wrong seller cannot claim the receipt',()=>checkReject({attribution:{...attribution,sellerId:'other'}},'wrong_seller'));
test('wrong reference refused',()=>checkReject({attribution:{...attribution,signature:'binance-deposit:2'}},'invalid_attribution'));
test('wrong network refused',()=>checkReject({receipt:{...receipt,network:'TRC20'}},'invalid_attribution'));
test('paid commissions not settled twice',()=>checkReject({records:records.map(r=>({...r,paymentStatus:'paid'}))},'already_settled'));
test('concurrent single-commission payment blocks batch',()=>checkReject({records:[{...records[0],paymentVerificationStatus:'pending_verification'},records[1]]},'payment_in_progress'));
test('partial batch not reinterpreted as smaller payment',()=>checkReject({records:[{...records[0],paymentStatus:'paid'},records[1]]},'already_settled'));
test('previously used receipt cannot clear another batch',()=>checkReject({records:[...records,{...records[0],id:'older',paymentStatus:'paid',paymentSignature:receipt.signature}]},'receipt_already_used'));
test('failed/manual reference remains reserved',()=>checkReject({records:[...records,{...records[0],id:'older',paymentStatus:'pending',paymentVerificationStatus:'failed',paymentSignature:receipt.signature}]},'receipt_already_used'));
test('duplicate commission ids refused',()=>checkReject({attribution:{...attribution,commissionIds:['cm42','cm42']}},'invalid_attribution'));
test('missing commission refused',()=>checkReject({records:[records[0]]},'commission_missing'));
test('changed authorized balance refused',()=>checkReject({attribution:{...attribution,expectedAmountMicros:38_000_000}},'amount_changed'));
test('old payment refused',()=>checkReject({receipt:{...receipt,timestamp:Date.parse('2026-09-25T13:00:00Z')}},'before_commission'));
test('future payment refused',()=>checkReject({receipt:{...receipt,timestamp:now+301_000}},'invalid_receipt'));
test('nan and infinite receipts refused',()=>{for(const amountMicros of [NaN,Infinity,Number.MAX_SAFE_INTEGER+1,0.5])checkReject({receipt:{...receipt,amountMicros}},'invalid_receipt');});
test('fee rate/amount and caller objects remain unchanged',()=>{const before=JSON.stringify({records,receipt,attribution});run();assert.equal(JSON.stringify({records,receipt,attribution}),before);});
test('receipt reference aliases deduplicate',()=>assert.equal(commissionReceiptKey('0x'+'A'.repeat(64)),commissionReceiptKey('a'.repeat(64))));
test('invalid reference formats refused',()=>{for(const s of ['','123','https://evil.test/tx','binance-deposit:-1'])assert.equal(commissionReceiptKey(s),null);});
test('safe six-decimal conversion',()=>{assert.equal(commissionAmountMicros(18.3),18_300_000);assert.equal(commissionAmountMicros(20.000001),20_000_001);for(const n of [NaN,Infinity,-1,0,0.0000001])assert.equal(commissionAmountMicros(n),null);});
test('tolerance applies once, not once per commission',()=>checkReject({receipt:{...receipt,amountMicros:36_500_000}},'outside_tolerance'));
test('1,001 deterministic allocations conserve actual cash and adjustment',()=>{
 for(let delta=-1_000_000;delta<=1_000_000;delta+=2000){
  const p=run({receipt:{...receipt,amountMicros:38_300_000+delta}});assert.equal(p.accepted,true);
  assert.equal(p.allocations.reduce((s,a)=>s+a.receivedMicros,0),38_300_000+delta);
  assert.equal(p.allocations.reduce((s,a)=>s+a.waivedMicros,0),Math.max(0,-delta));
  assert.equal(p.allocations.reduce((s,a)=>s+a.excessMicros,0),Math.max(0,delta));
 }
});
