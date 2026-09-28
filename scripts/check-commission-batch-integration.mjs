import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCommissionBatchWorkflow, getPendingCommissionBatches, getCommissionBatchReceiptReservations } from '../src/lib/commission-batch-workflow.ts';
import { planCommissionBatch } from '../src/lib/commission-batch-policy.ts';
const time=Date.parse('2026-09-25T14:20:00Z');
const receipt={signature:'binance-deposit:123456789012345678',network:'BEP20',amountMicros:38_000_000,timestamp:Date.parse('2026-09-25T14:09:08Z')};
const approval={actorUserId:'owner',sellerId:'seller',commissionIds:['cm42','cm43'],signature:receipt.signature,network:'BEP20'};
function fixture(){return {
 users:[{id:'owner',role:'owner'},{id:'seller',role:'approved_seller',disabled:true},{id:'other',role:'approved_seller'}],
 commissionRecords:[{id:'cm42',sellerId:'seller',commissionAmount:18.3,rate:0.01,paymentStatus:'pending',createdAt:'2026-09-25T14:03:48Z',updatedAt:'2026-09-25T14:03:48Z'},
 {id:'cm43',sellerId:'seller',commissionAmount:20,rate:0.01,paymentStatus:'pending',createdAt:'2026-09-25T14:07:10Z',updatedAt:'2026-09-25T14:07:10Z'}],
 notifications:[],auditLogs:[],marketplaceListings:[{id:'listing',status:'active',availableAmount:'8085'}],
 purchaseRequests:[{id:'trade',status:'payment_sent'}],authSessions:[{token:'unchanged-test-token'}]
};}
function harness(options={}){
 let state=fixture(),clock=time,queue=Promise.resolve(),proofs=0,invalidations=0,failCommit=false;
 async function atomic(mutation){
  const task=queue.then(()=>{const next=structuredClone(state);const result=mutation(next);if(failCommit)throw new Error('simulated-db-failure');state=next;return result;});
  queue=task.catch(()=>{});return task;
 }
 const workflow=createCommissionBatchWorkflow({read:async()=>structuredClone(state),atomic,now:()=>clock,
  verify:async(r,t)=>{proofs++;assert.equal(r.amountMicros,options.amount??38_000_000);assert.equal(r.signature,receipt.signature);assert.ok(t<receipt.timestamp);
   if(options.duringVerify)await options.duringVerify({atomic,get:()=>structuredClone(state)});
   return options.proof??{verified:true,code:'binance_verified'};},
  destination:()=> 'canonical-destination-test-fixture',afterCommit:()=>{invalidations++;}
 });
 return {workflow,atomic,get:()=>structuredClone(state),clock:()=>{clock+=60_000;},fail:()=>{failCommit=true;},proofs:()=>proofs,invalidations:()=>invalidations,
  async approve(overrides={}){return workflow.approve({...approval,...overrides});},
  async run(overrides={}){return workflow.reconcile({deposits:[receipt],deadline:clock+60_000,...overrides});}
 };
}
test('approval is durable but never counts as receipt proof',async()=>{const h=harness();await h.approve();assert.equal(getPendingCommissionBatches(h.get()).length,1);assert.equal(h.get().commissionRecords[0].paymentStatus,'pending');assert.equal(h.proofs(),0);});
test('non-owner cannot approve, including a seller sending actor id',async()=>{const h=harness();await assert.rejects(h.approve({actorUserId:'seller'}),/owner_required/);assert.equal(h.get().auditLogs.length,0);});
test('disabled owner cannot approve',async()=>{const h=harness();await h.atomic(s=>{s.users[0].disabled=true;});await assert.rejects(h.approve(),/owner_required/);});
test('idempotent approval creates one persisted group',async()=>{const h=harness();const groups=await Promise.all([h.approve(),h.approve(),h.approve()]);assert.equal(new Set(groups.map(g=>g.id)).size,1);assert.equal(h.get().auditLogs.length,1);});
test('a repeated reference cannot be assigned to another group',async()=>{const h=harness();await h.approve();await assert.rejects(h.approve({commissionIds:['cm42']}),/receipt_reserved/);});
test('overlapping outstanding groups are refused',async()=>{const h=harness();await h.approve();await assert.rejects(h.approve({signature:'binance-deposit:88',commissionIds:['cm43']}),/group_overlap/);});
test('cross-seller invoices cannot be combined',async()=>{const h=harness();await h.atomic(s=>{s.commissionRecords[0].sellerId='other';});await assert.rejects(h.approve(),/wrong_seller/);});
test('manually paid incident invoices cannot be settled again',async()=>{const h=harness();await h.atomic(s=>{for(const c of s.commissionRecords)c.paymentStatus='paid';});await assert.rejects(h.approve(),/already_settled/);});
test('38 against 38.30 settles all rows with accurate cash and waiver',async()=>{
 const h=harness();await h.approve();const before=h.get();const r=await h.run();assert.equal(r.verified,1);assert.equal(h.proofs(),1);
 const after=h.get();assert.ok(after.commissionRecords.every(c=>c.paymentStatus==='paid'));
 assert.equal(after.commissionRecords.reduce((s,c)=>s+c.paymentBatchSettlement.receivedMicros,0),38_000_000);
 assert.equal(after.commissionRecords.reduce((s,c)=>s+c.paymentBatchSettlement.waivedMicros,0),300_000);
 assert.deepEqual(after.commissionRecords.map(c=>c.commissionAmount),[18.3,20]);
 assert.deepEqual(after.marketplaceListings,before.marketplaceListings);assert.deepEqual(after.purchaseRequests,before.purchaseRequests);
 assert.deepEqual(after.authSessions,before.authSessions);assert.deepEqual(after.users,before.users);
 assert.equal(after.notifications.length,1);assert.equal(after.notifications[0].reason,'commission_payment_verified');
 assert.ok(after.commissionRecords.every(c=>c.paymentConfirmationEmailPending));assert.equal(getPendingCommissionBatches(after).length,0);
});
test('single invoice tolerance is supported after authentic owner attribution',async()=>{
 const h=harness({amount:18_000_000});await h.approve({commissionIds:['cm42']});const r=await h.run({deposits:[{...receipt,amountMicros:18_000_000}]});assert.equal(r.verified,1);
 assert.equal(h.get().commissionRecords[1].paymentStatus,'pending');assert.equal(h.get().notifications[0].reason,'commission_payment_due');
});
test('upper boundary records excess, not fictitious fee income',async()=>{const h=harness({amount:39_300_000});await h.approve();const r=await h.run({deposits:[{...receipt,amountMicros:39_300_000}]});assert.equal(r.verified,1);assert.equal(h.get().commissionRecords.reduce((s,c)=>s+c.paymentBatchSettlement.excessMicros,0),1_000_000);});
test('similarly sized unapproved payment never clears anybody',async()=>{const h=harness();assert.equal((await h.run()).verified,0);assert.equal(h.proofs(),0);});
test('wrong original receipt cannot satisfy approval',async()=>{const h=harness();await h.approve();const r=await h.run({deposits:[{...receipt,signature:'binance-deposit:2'}]});assert.equal(r.verified,0);assert.equal(h.proofs(),0);});
test('wrong network receipt cannot satisfy approval',async()=>{const h=harness();await h.approve();assert.equal((await h.run({deposits:[{...receipt,network:'TRC20'}]})).verified,0);assert.equal(h.proofs(),0);});
test('outside tolerance is held for review before verification',async()=>{const h=harness();await h.approve();assert.equal((await h.run({deposits:[{...receipt,amountMicros:37_299_999}]})).review,1);assert.equal(h.proofs(),0);});
test('contradictory provider amounts do not use array order',async()=>{const h=harness();await h.approve();const r=await h.run({deposits:[receipt,{...receipt,amountMicros:38_100_000}]});assert.equal(r.verified,0);assert.equal(r.review,1);});
test('duplicate provider history is verified and credited once',async()=>{const h=harness();await h.approve();const r=await h.run({deposits:[receipt,{...receipt} ]});assert.equal(r.verified,1);assert.equal(h.proofs(),1);});
test('not-yet-final receipt stays pending without ledger mutation',async()=>{const h=harness({proof:{verified:false,pending:true,code:'awaiting_finality'}});await h.approve();const r=await h.run();assert.equal(r.waiting,1);assert.equal(h.get().notifications.length,0);assert.ok(h.get().commissionRecords.every(c=>c.paymentStatus==='pending'));});
test('provider rejection never marks paid',async()=>{const h=harness({proof:{verified:false,code:'wrong_asset'}});await h.approve();assert.equal((await h.run()).review,1);assert.ok(h.get().commissionRecords.every(c=>c.paymentStatus==='pending'));});
test('provider outage remains retryable without resetting payment',async()=>{const h=harness({duringVerify:async()=>{throw new Error('unavailable');}});await h.approve();assert.equal((await h.run()).errors,1);assert.equal(getPendingCommissionBatches(h.get()).length,1);});
test('concurrent scheduler retries credit once and create one notification',async()=>{const h=harness();await h.approve();const r=await Promise.all([h.run(),h.run()]);assert.equal(r.reduce((s,v)=>s+v.verified,0),1);assert.equal(h.get().notifications.length,1);assert.equal(h.get().auditLogs.filter(a=>a.action==='commission_paid').length,1);});
test('concurrent legacy single payment wins safely; whole batch refused',async()=>{
 const h=harness({duringVerify:async({atomic})=>atomic(s=>{s.commissionRecords[0].paymentStatus='paid';s.commissionRecords[0].paymentSignature='a'.repeat(64);})});
 await h.approve();const r=await h.run();assert.equal(r.verified,0);assert.equal(h.get().commissionRecords[1].paymentStatus,'pending');assert.equal(h.get().notifications.length,0);
});
test('receipt used on another invoice during provider wait is rejected at commit',async()=>{
 const h=harness({duringVerify:async({atomic})=>atomic(s=>{s.commissionRecords.push({...s.commissionRecords[0],id:'other',sellerId:'other',paymentStatus:'paid',paymentSignature:receipt.signature});})});
 await h.approve();assert.equal((await h.run()).verified,0);assert.equal(h.get().commissionRecords[0].paymentStatus,'pending');
});
test('individual pending payment begun during provider wait cannot be overwritten',async()=>{
 const h=harness({duringVerify:async({atomic})=>atomic(s=>{s.commissionRecords[0].paymentVerificationStatus='pending_verification';})});
 await h.approve();assert.equal((await h.run()).verified,0);assert.equal(h.get().commissionRecords[1].paymentStatus,'pending');
});
test('amount changes preserving combined total are still rejected',async()=>{
 const h=harness({duringVerify:async({atomic})=>atomic(s=>{s.commissionRecords[0].commissionAmount=19.3;s.commissionRecords[1].commissionAmount=19;})});
 await h.approve();assert.equal((await h.run()).verified,0);assert.equal(h.get().notifications.length,0);
});
test('owner privilege removal during provider wait is rechecked under lock',async()=>{
 const h=harness({duringVerify:async({atomic})=>atomic(s=>{s.users[0].role='buyer';})});await h.approve();assert.equal((await h.run()).verified,0);assert.ok(h.get().commissionRecords.every(c=>c.paymentStatus==='pending'));
});
test('database commit failure cannot leave one invoice paid or send notifications',async()=>{const h=harness();await h.approve();h.fail();const r=await h.run();assert.ok(r.errors>=1);assert.ok(h.get().commissionRecords.every(c=>c.paymentStatus==='pending'));assert.equal(h.get().notifications.length,0);});
test('already settled batch replay does not duplicate email or notification',async()=>{const h=harness();await h.approve();await h.run();const state=h.get();await h.run();assert.deepEqual(h.get(),state);});
test('receipt ownership remains reserved after manual record reset',async()=>{const h=harness();await h.approve();await h.run();await h.atomic(s=>{for(const c of s.commissionRecords){c.paymentStatus='pending';delete c.paymentSignature;}});assert.ok(getCommissionBatchReceiptReservations(h.get()).has(receipt.signature));await assert.rejects(h.approve({commissionIds:['cm42']}),/receipt_reserved/);});
test('missing time budget does not start provider work',async()=>{const h=harness();await h.approve();const r=await h.run({deadline:time+1000});assert.equal(r.budgetExhausted,true);assert.equal(h.proofs(),0);});
test('persisted attribution tampering fails closed',async()=>{const h=harness();await h.approve();await h.atomic(s=>{s.auditLogs[0].newValue.batch.approvedByUserId='seller';});await assert.rejects(h.run(),/invalid_persisted_batch/);});
test('unrelated owner/account/trade/session objects are never adjusted to clear fees',async()=>{const h=harness();const original=h.get();await h.approve();await h.run();for(const field of ['users','authSessions','marketplaceListings','purchaseRequests'])assert.deepEqual(h.get()[field],original[field]);});
test('largest-remainder fixes small-invoice rounding: 3 micros due, 2 received',()=>{
 const records=[1,1,1].map((amount,i)=>({id:`c${i}`,sellerId:'s',commissionAmount:amount/1e6,paymentStatus:'pending',createdAt:new Date(time-1000).toISOString(),updatedAt:new Date(time-1000).toISOString()}));
 const p=planCommissionBatch({records,receipt:{...receipt,amountMicros:2,timestamp:time},now:time,attribution:{kind:'owner_confirmed_receipt',sellerId:'s',approvedByUserId:'owner',commissionIds:records.map(c=>c.id),signature:receipt.signature,network:'BEP20',expectedAmountMicros:3}});
 assert.equal(p.accepted,true);assert.equal(p.allocations.reduce((s,a)=>s+a.waivedMicros,0),1);assert.equal(p.allocations.reduce((s,a)=>s+a.excessMicros,0),0);
});
test('8,000 generated allocation cases conserve money and direction',()=>{
 for(let n=1;n<=8;n++)for(let sample=1;sample<=1000;sample++){
  const amounts=Array.from({length:n},(_,i)=>(sample*(i+13)%997)+1),total=amounts.reduce((a,b)=>a+b,0),received=Math.max(1,total+((sample%3)-1)*Math.min(500,total-1));
  const records=amounts.map((a,i)=>({id:`c${i}`,sellerId:'s',commissionAmount:a/1e6,paymentStatus:'pending',createdAt:new Date(time-1000).toISOString(),updatedAt:new Date(time-1000).toISOString()}));
  const p=planCommissionBatch({records,receipt:{...receipt,amountMicros:received,timestamp:time},now:time,attribution:{kind:'owner_confirmed_receipt',sellerId:'s',approvedByUserId:'owner',commissionIds:records.map(c=>c.id),signature:receipt.signature,network:'BEP20',expectedAmountMicros:total}});
  assert.equal(p.accepted,true);assert.equal(p.allocations.reduce((s,a)=>s+a.receivedMicros,0),received);assert.equal(p.allocations.reduce((s,a)=>s+a.waivedMicros,0),Math.max(0,total-received));assert.equal(p.allocations.reduce((s,a)=>s+a.excessMicros,0),Math.max(0,received-total));
 }
});
