import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCommissionCheckoutWorkflow, CHECKOUT_SETTLED } from '../src/lib/commission-checkout-workflow.ts';
const now=Date.parse('2026-09-25T16:00:00Z');
function setup(){
 let db={users:[{id:'seller',role:'approved_seller',sellerStatus:'approved_seller'}],commissionRecords:[{id:'cm',sellerId:'seller',commissionAmount:40,paymentExpectedAmount:40.000001,paymentStatus:'pending',createdAt:new Date(now-60000).toISOString(),updatedAt:new Date(now).toISOString()}],auditLogs:[],notifications:[]};
 const api=createCommissionCheckoutWorkflow({read:async()=>structuredClone(db),atomic:async(fn)=>{const copy=structuredClone(db);const result=fn(copy);db=copy;return result;},verify:async()=>({verified:true}),destination:()=> 'canonical',now:()=>now,random:()=>10});
 return {api,db:()=>db};
}
const issue=x=>x.api.issue({sellerId:'seller',network:'BEP20',desiredAmount:'39'});
test('fully paid legacy instructions no longer block future dues or fabricate a new receipt',async()=>{
 const x=setup();await issue(x);x.db().commissionRecords[0].paymentStatus='paid';const state=await x.api.state('seller');assert.equal(state.status,'paid');assert.equal(state.checkout,null);assert.equal(state.lastPaidCheckout,null);
 x.db().commissionRecords.push({...x.db().commissionRecords[0],id:'new',paymentStatus:'pending',paymentExpectedAmount:40.000002});const next=await issue(x);assert.notEqual(next.expectedMicros,39000000);assert.equal(x.db().auditLogs.filter(e=>e.newValue.kind===CHECKOUT_SETTLED).length,0);
});
test('amount reservation advances its commission timestamp for canonical stale merges',async()=>{const x=setup();await issue(x);assert.ok(Date.parse(x.db().commissionRecords[0].updatedAt)>now);});
