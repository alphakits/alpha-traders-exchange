import { test } from 'node:test';
import assert from 'node:assert/strict';
import {createCommissionCheckoutWorkflow, CHECKOUT_SETTLED, CHECKOUT_RECOVERY, parseCheckoutAmount, allocateCheckout} from '../src/lib/commission-checkout-workflow.ts';
const NOW=Date.parse('2026-09-25T16:00:00Z');
function setup(amounts=[40]) {
 let db={users:[{id:'seller',role:'approved_seller',sellerStatus:'approved_seller'},{id:'other',role:'approved_seller',sellerStatus:'approved_seller'},{id:'buyer',role:'buyer'}],
 commissionRecords:amounts.map((amount,index)=>({id:`cm${index}`,sellerId:'seller',commissionAmount:amount,rate:.01,paymentStatus:'pending',createdAt:new Date(NOW-60000).toISOString(),paymentExpectedAmount:amount+.000001})),
 auditLogs:[],notifications:[],purchaseRequests:[],authSessions:[{token:'keep'}],marketplaceListings:[{id:'keep',status:'active'}]};
 let queue=Promise.resolve(), providerCalls=0, clock=NOW, proof={verified:true}, afterVerify=()=>{}, commitFailure=false;
 const ports={read:async()=>structuredClone(db),now:()=>clock,random:()=>10,destination:()=> 'canonical',
 atomic:fn=>{const work=queue.then(()=>{const copy=structuredClone(db),result=fn(copy);if(commitFailure)throw Error('db unavailable');db=copy;return result;});queue=work.catch(()=>{});return work;},
 verify:async(receipt,earliest)=>{providerCalls++;assert.equal(earliest,NOW);await afterVerify();return proof;}};
 const api=createCommissionCheckoutWorkflow(ports);
 return {api,db:()=>db,patch:fn=>fn(db),calls:()=>providerCalls,proof:p=>{proof=p;},afterVerify:fn=>{afterVerify=fn;},fail:()=>{commitFailure=true;},clock:t=>{clock=t;}};
}
const issue=(x,amount='39')=>x.api.issue({sellerId:'seller',network:'BEP20',desiredAmount:amount});
const deposit=(checkout,extra={})=>({signature:'binance-deposit:123456789',network:checkout.network,amountMicros:checkout.expectedMicros,timestamp:NOW+100,...extra});
const reconcile=(x,ds)=>{x.clock(NOW+2000);return x.api.reconcile({deposits:ds,deadline:NOW+60000});};
const rejects=async(fn,code)=>assert.rejects(fn,e=>e.code===code);
test('seller issues 39 against 40 without owner approval and independently verified receipt settles',async()=>{const x=setup();const c=await issue(x);assert.equal(c.expectedMicros,39000000);assert.equal(x.db().commissionRecords[0].paymentStatus,'pending');const r=await reconcile(x,[deposit(c)]);assert.equal(r.verified,1);assert.equal(x.calls(),1);assert.equal(x.db().commissionRecords[0].commissionAmount,40);assert.equal(x.db().commissionRecords[0].paymentBatchSettlement.waivedMicros,1000000);});
test('38 paid against combined 18.3 plus 20 preserves original amounts',async()=>{const x=setup([18.3,20]);const c=await issue(x,'38');const r=await reconcile(x,[deposit(c)]);assert.equal(r.verified,1);assert.deepEqual(x.db().commissionRecords.map(c=>c.commissionAmount),[18.3,20]);assert.equal(x.db().commissionRecords.reduce((s,c)=>s+c.paymentBatchSettlement.waivedMicros,0),300000);});
for(const amount of ['39','41','40.00001'])test(`boundary allowed ${amount}`,async()=>{const x=setup();const c=await issue(x,amount);assert.ok(Math.abs(c.expectedMicros-c.dueMicros)<=1000000);});
for(const amount of ['38.999999','41.000001'])test(`outside tolerance ${amount}`,async()=>{const x=setup();await rejects(()=>issue(x,amount),'outside_tolerance');assert.equal(x.db().auditLogs.length,0);});
for(const amount of ['0','-1','NaN','Infinity','1e2','1.0000001','', ' 39','39 '])test(`reject malformed ${JSON.stringify(amount)}`,()=>assert.throws(()=>parseCheckoutAmount(amount)));
test('positive tiny payment required for small fees; zero never clears',async()=>{const x=setup([.5]);await rejects(()=>issue(x,'0'),'invalid_amount');});
test('duplicate issuance is idempotent',async()=>{const x=setup();const [a,b]=await Promise.all([issue(x),issue(x)]);assert.equal(a.id,b.id);assert.equal(x.db().auditLogs.length,1);});
test('colliding amount has visible suffix within the allowed range',async()=>{const x=setup();x.patch(db=>db.commissionRecords.push({...db.commissionRecords[0],id:'old',sellerId:'other',commissionAmount:39,paymentExpectedAmount:39,paymentStatus:'paid'}));const c=await issue(x);assert.notEqual(c.expectedMicros,39000000);assert.equal(c.requestedMicros,39000000);assert.ok(c.expectedMicros>=39000000);assert.equal((await issue(x)).id,c.id);});
test('chosen reference is reserved for legacy allocator forever',async()=>{const x=setup();const c=await issue(x);assert.ok(x.db().commissionRecords[0].paymentReservedExpectedAmounts.includes(c.expectedMicros/1e6));await reconcile(x,[deposit(c)]);assert.ok(x.db().commissionRecords[0].paymentReservedExpectedAmounts.includes(c.expectedMicros/1e6));});
test('buyer or disabled seller cannot issue',async()=>{const x=setup();await rejects(()=>x.api.issue({sellerId:'buyer',network:'BEP20'}),'seller_required');x.patch(db=>db.users[0].disabled=true);await rejects(()=>issue(x),'seller_required');});
test('client cannot settle another seller group',async()=>{const x=setup();await rejects(()=>x.api.issue({sellerId:'other',network:'BEP20',desiredAmount:'39'}),'no_commissions_due');});
test('does not automatically match unissued rounded deposits',async()=>{const x=setup();const r=await reconcile(x,[{signature:'binance-deposit:1',amountMicros:39000000,network:'BEP20',timestamp:NOW+100}]);assert.equal(r.verified,0);assert.equal(x.calls(),0);});
test('unplanned rounded payment never gets fuzzy matched after a suffix was issued',async()=>{const x=setup();x.patch(db=>db.commissionRecords.push({...db.commissionRecords[0],id:'older-reference',sellerId:'other',paymentStatus:'paid'}));const c=await issue(x,'40');assert.notEqual(c.expectedMicros,40000000);const r=await reconcile(x,[deposit(c,{amountMicros:40000000})]);assert.equal(r.verified,0);});
test('pre-checkout transfer is rejected with no clock-skew backdating',async()=>{const x=setup();const c=await issue(x);assert.equal((await reconcile(x,[deposit(c,{timestamp:NOW-1})])).verified,0);assert.equal(x.calls(),0);});
test('future, wrong network, invalid signature receipts refused',async()=>{for(const extra of [{timestamp:NOW+400000},{network:'TRC20'},{signature:'bogus'}]){const x=setup();const c=await issue(x);assert.equal((await reconcile(x,[deposit(c,extra)])).verified,0);assert.equal(x.calls(),0);}});
test('provider aliases credited once and never from conflicting amount records',async()=>{const x=setup();const c=await issue(x);const r=await reconcile(x,[deposit(c),deposit(c,{amountMicros:c.expectedMicros+1})]);assert.equal(r.verified,0);assert.equal(x.calls(),0);});
test('independent provider failure stays pending',async()=>{const x=setup();x.proof({verified:false,pending:true});const c=await issue(x);const r=await reconcile(x,[deposit(c)]);assert.equal(r.pending,1);assert.equal(x.db().commissionRecords[0].paymentStatus,'pending');});
test('provider rejection does not unlock and remains diagnosable',async()=>{const x=setup();x.proof({verified:false});const c=await issue(x);assert.equal((await reconcile(x,[deposit(c)])).verified,0);assert.equal(x.db().notifications.length,0);});
test('duplicate cron executions settle and notify once',async()=>{const x=setup();const c=await issue(x);const ds=[deposit(c)];await Promise.all([reconcile(x,ds),reconcile(x,ds)]);assert.equal(x.db().notifications.length,1);assert.equal(x.db().auditLogs.filter(e=>e.newValue.kind===CHECKOUT_SETTLED).length,1);});
test('network receipt and 0x/case alias cannot be used again',async()=>{const x=setup();const c=await issue(x);x.patch(db=>db.commissionRecords.push({id:'old',sellerId:'other',paymentStatus:'paid',paymentSignature:'0x'+'A'.repeat(64)}));const r=await reconcile(x,[deposit(c,{signature:'a'.repeat(64)})]);assert.equal(r.verified,0);});
test('partial paid group blocks entire settlement rather than waiving each fee',async()=>{const x=setup([20,20]);const c=await issue(x);x.afterVerify(()=>x.patch(db=>db.commissionRecords[0].paymentStatus='paid'));const r=await reconcile(x,[deposit(c)]);assert.equal(r.verified,0);assert.equal(x.db().commissionRecords[1].paymentStatus,'pending');});
test('receipt reserved by owner group cannot be claimed',async()=>{const x=setup();const c=await issue(x);x.patch(db=>db.auditLogs.push({id:'owner-approval',newValue:{kind:'commission_batch_receipt_approval_v1',batch:{signature:'binance-deposit:123456789'}}}));assert.equal((await reconcile(x,[deposit(c)])).verified,0);});
test('commission mutation preserving group total is refused',async()=>{const x=setup([20,20]);const c=await issue(x);x.afterVerify(()=>x.patch(db=>{db.commissionRecords[0].commissionAmount=19;db.commissionRecords[1].commissionAmount=21;}));assert.equal((await reconcile(x,[deposit(c)])).verified,0);});
test('new dues during verification are left unpaid and no full-unlock claim is made',async()=>{const x=setup();const c=await issue(x);x.afterVerify(()=>x.patch(db=>db.commissionRecords.push({...db.commissionRecords[0],id:'next',commissionAmount:5,paymentExpectedAmount:5.000001,paymentReservedExpectedAmounts:[]})));assert.equal((await reconcile(x,[deposit(c)])).verified,1);assert.equal(x.db().notifications[0].reason,'commission_payment_due');});
test('zero budget never begins provider request',async()=>{const x=setup();const c=await issue(x);assert.equal((await x.api.reconcile({deposits:[deposit(c)],deadline:NOW})).verified,0);assert.equal(x.calls(),0);});
test('database failure cannot partially credit or notify',async()=>{const x=setup([20,20]);const c=await issue(x);x.afterVerify(()=>x.fail());assert.equal((await reconcile(x,[deposit(c)])).verified,0);assert.ok(x.db().commissionRecords.every(c=>c.paymentStatus==='pending'));assert.equal(x.db().notifications.length,0);});
test('users sessions listing status and fee rates are unchanged',async()=>{const x=setup();const before=JSON.stringify({users:x.db().users,sessions:x.db().authSessions,listings:x.db().marketplaceListings});const c=await issue(x);await reconcile(x,[deposit(c)]);assert.equal(JSON.stringify({users:x.db().users,sessions:x.db().authSessions,listings:x.db().marketplaceListings}),before);assert.equal(x.db().commissionRecords[0].rate,.01);});
test('paid status and recoverable email outbox markers share one commit',async()=>{const x=setup([20,20]);const c=await issue(x);await reconcile(x,[deposit(c)]);assert.equal((await x.api.state('seller')).status,'paid');assert.equal((await x.api.state('seller')).pendingCount,0);assert.ok(x.db().commissionRecords.every(c=>c.paymentConfirmationEmailPending));});
test('1000 allocation cases conserve actual received and a single waiver/excess',()=>{for(let n=1;n<=1000;n++){const amounts=[n,1,n+20],due=amounts.reduce((a,b)=>a+b);const received=Math.max(1,due-10);const c={expectedMicros:received,dueMicros:due,commissions:amounts.map((dueMicros,i)=>({id:`c${i}`,dueMicros}))};const a=allocateCheckout(c);assert.equal(a.reduce((s,r)=>s+r.receivedMicros,0),received);assert.equal(a.reduce((s,r)=>s+r.waivedMicros,0),due-received);assert.equal(a.reduce((s,r)=>s+r.excessMicros,0),0);}});

test('single fee uses its own base amount without an unnecessary decimal reference',async()=>{const x=setup([3.54]);const c=await issue(x,'3.54');assert.equal(c.expectedMicros,3540000);assert.equal((await reconcile(x,[deposit(c)])).verified,1);assert.equal(x.db().commissionRecords[0].paymentStatus,'paid');});
test('another seller or historical base amount remains reserved',async()=>{const x=setup([3.54]);x.patch(db=>db.commissionRecords.push({...db.commissionRecords[0],id:'other-fee',sellerId:'other',paymentStatus:'paid'}));const c=await issue(x,'3.54');assert.notEqual(c.expectedMicros,3540000);assert.equal((await reconcile(x,[deposit(c,{amountMicros:3540000})])).verified,0);});

test('29.20 checkout reserves 30 before payment and records the actual 0.80 excess',async()=>{
 const x=setup([29.2]);const c=await issue(x,'29.2');assert.equal(c.roundedMicros,30000000);
 assert.ok(x.db().commissionRecords[0].paymentReservedExpectedAmounts.includes(30));
 assert.equal((await reconcile(x,[deposit(c,{amountMicros:30000000})])).verified,1);
 const paid=x.db().commissionRecords[0];assert.equal(paid.commissionAmount,29.2);
 assert.equal(paid.paymentBatchSettlement.receivedMicros,30000000);assert.equal(paid.paymentBatchSettlement.excessMicros,800000);
 assert.equal(paid.paymentBatchSettlement.waivedMicros,0);
});
test('a different seller or historical reference prevents issuing the rounded option',async()=>{
 const x=setup([29.2]);x.patch(db=>db.commissionRecords.push({id:'other',sellerId:'other',commissionAmount:30,paymentExpectedAmount:30,paymentStatus:'paid'}));
 const c=await issue(x,'29.2');assert.equal(c.roundedMicros,undefined);
 assert.equal((await reconcile(x,[deposit(c,{amountMicros:30000000})])).verified,0);assert.equal(x.calls(),0);
});
test('colliding exact amounts do not receive a rounded alias',async()=>{
 const x=setup([29.2]);x.patch(db=>db.commissionRecords.push({...db.commissionRecords[0],id:'other',sellerId:'other',paymentStatus:'paid'}));
 const c=await issue(x,'29.2');assert.notEqual(c.expectedMicros,29200000);assert.equal(c.roundedMicros,undefined);
 assert.equal((await reconcile(x,[deposit(c,{amountMicros:30000000})])).verified,0);
});
test('combined rounded receipt conserves actual received funds across every allocation',async()=>{
 const x=setup([14.6,14.6]);const c=await issue(x,'29.2');assert.equal((await reconcile(x,[deposit(c,{amountMicros:30000000})])).verified,1);
 assert.equal(x.db().commissionRecords.reduce((sum,row)=>sum+row.paymentBatchSettlement.receivedMicros,0),30000000);
 assert.equal(x.db().commissionRecords.reduce((sum,row)=>sum+row.paymentBatchSettlement.excessMicros,0),800000);
});
function recovery(x,c,changes={}) {
 x.patch(db=>{db.users.push({id:'owner',role:'owner'});db.auditLogs.push({id:`${c.id}:receipt-recovery`,actorUserId:'owner',targetUserId:'seller',
 newValue:{kind:CHECKOUT_RECOVERY,checkoutId:c.id,network:'BEP20',amountMicros:30000000,timestamp:NOW+100,timestampToleranceMs:60000,...changes}});});
}
test('an explicit owner deposit recovery still independently verifies a legacy exact-only checkout',async()=>{
 const x=setup([29.2]);const c=await issue(x,'29.2');x.patch(db=>delete db.auditLogs[0].newValue.checkout.roundedMicros);
 recovery(x,c);assert.equal((await reconcile(x,[deposit(c,{amountMicros:30000000})])).verified,1);assert.equal(x.calls(),1);
 assert.equal(x.db().commissionRecords[0].paymentBatchSettlement.attribution,'owner_confirmed_received_deposit');
});
test('owner recovery cannot be spoofed by a seller, exceed tolerance, or claim another deposit time/network',async()=>{
 for(const changes of [{timestamp:NOW-120000},{timestampToleranceMs:60001},{network:'TRC20'},{amountMicros:31000000}]){
  const x=setup([29.2]);const c=await issue(x,'29.2');x.patch(db=>delete db.auditLogs[0].newValue.checkout.roundedMicros);recovery(x,c,changes);
  assert.equal((await reconcile(x,[deposit(c,{amountMicros:30000000})])).verified,0);assert.equal(x.calls(),0);
 }
 const x=setup([29.2]);const c=await issue(x,'29.2');x.patch(db=>delete db.auditLogs[0].newValue.checkout.roundedMicros);recovery(x,c);
 x.patch(db=>db.users.find(row=>row.id==='owner').role='buyer');assert.equal((await reconcile(x,[deposit(c,{amountMicros:30000000})])).verified,0);
});
test('revoked receipt recovery during independent verification does not unlock',async()=>{
 const x=setup([29.2]);const c=await issue(x,'29.2');x.patch(db=>delete db.auditLogs[0].newValue.checkout.roundedMicros);recovery(x,c);
 x.afterVerify(()=>x.patch(db=>db.users.find(row=>row.id==='owner').disabled=true));assert.equal((await reconcile(x,[deposit(c,{amountMicros:30000000})])).verified,0);
});
test('receiving both payment options does not silently discard one receipt',async()=>{
 const x=setup([29.2]);const c=await issue(x,'29.2');const r=await reconcile(x,[deposit(c),deposit(c,{signature:'binance-deposit:2',amountMicros:30000000})]);
 assert.equal(r.verified,0);assert.equal(r.review,1);assert.equal(x.calls(),0);
});
test('two distinct rounded receipts require review rather than choosing by order',async()=>{
 const x=setup([29.2]);const c=await issue(x,'29.2');const r=await reconcile(x,[deposit(c,{amountMicros:30000000}),deposit(c,{signature:'binance-deposit:2',amountMicros:30000000})]);
 assert.equal(r.verified,0);assert.equal(r.review,1);assert.equal(x.calls(),0);
});
test('a historical fee base with a different exact reference does not block an explicitly attributed recovery',async()=>{
 const x=setup([29.2]);const c=await issue(x,'29.2');x.patch(db=>{delete db.auditLogs[0].newValue.checkout.roundedMicros;
 db.commissionRecords.push({id:'historical',sellerId:'other',commissionAmount:30,paymentExpectedAmount:30.000001,paymentExpectedAmountMode:'unique_v1',paymentStatus:'paid'});});
 recovery(x,c);assert.equal((await reconcile(x,[deposit(c,{amountMicros:30000000})])).verified,1);
});
