import * as W from './wompi-order-webhook.mjs';
import * as C from './order-checkout.mjs';
import * as K from './wompi-connect.mjs';
import crypto from 'node:crypto';
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
let ok=0,bad=0; const t=(n,c)=>{c?ok++:(bad++,console.log('FAIL',n))};
const RID='11111111-1111-4111-8111-111111111111', REF='KO-'+'A1B2C3D4E5F6A7B8C9D0', SEC='test_events_SECRET12345';
const mkEv=(status=' APPROVED'.trim(),amt=50000,secret=SEC,ref=REF)=>{const data={transaction:{id:'tx1',status,amount_in_cents:amt,reference:ref}};const ts=1700000000;
 return {event:'transaction.updated',environment:'test',data,timestamp:ts,signature:{properties:['transaction.id','transaction.status','transaction.amount_in_cents'],checksum:sha('tx1'+status+amt+ts+secret)}}};
const req=(ev,q='?rid='+RID,h={})=>new Request('https://x/f'+q,{method:'POST',body:JSON.stringify(ev),headers:h});
function mkAdmin(over={}){const calls=[];const seen=new Set();return {calls,rpc:async(n,a)=>{calls.push(n);
 if(over[n])return over[n](a);
 if(n==='wompi_get_credentials')return{data:{public:'pub_test_x',integrity:'test_integrity_ABC12345',events:SEC,environment:'sandbox'}};
 if(n==='order_payment_record_event'){const k=a.p_checksum;if(seen.has(k))return{data:{done:true,id:1}};seen.add(k);return{data:{done:false,id:1}}}
 if(n==='order_payment_finish_event')return{data:null};
 if(n==='order_payment_apply')return{data:{ok:true,result:'applied'}};
 return{data:null}}}}
const fx=(status='APPROVED',amt=50000,ref=REF)=>async()=>({status:200,json:async()=>({data:{id:'tx1',status,amount_in_cents:amt,currency:'COP',reference:ref,payment_method_type:'CARD'}})});
let a=mkAdmin(); let r=await W.handle(req(mkEv()),{admin:a,fetchFn:fx()}); t('approved 200',r.status===200&&a.calls.includes('order_payment_apply'));
r=await W.handle(req(mkEv()),{admin:a,fetchFn:fx()}); t('duplicate',(await r.json()).result==='duplicate_event');
a=mkAdmin(); r=await W.handle(req(mkEv('APPROVED',50000,'wrong_secret')),{admin:a,fetchFn:fx()}); t('bad sig 401',r.status===401&&!a.calls.includes('order_payment_apply'));
a=mkAdmin(); r=await W.handle(req(mkEv(),'?rid=bad'),{admin:a,fetchFn:fx()}); t('bad rid',r.status===404);
a=mkAdmin(); r=await W.handle(req(mkEv(),'?rid='+RID,{'x-event-checksum':'zzz'}),{admin:a,fetchFn:fx()}); t('header mismatch',r.status===401);
a=mkAdmin(); r=await W.handle(req(mkEv('DECLINED')),{admin:a,fetchFn:fx('DECLINED')}); t('declined processed',r.status===200);
// event says approved but API says declined -> apply called with API status
let seen; a=mkAdmin({order_payment_apply:async x=>{seen=x;return{data:{ok:true,result:'declined'}}}}); await W.handle(req(mkEv('APPROVED')),{admin:a,fetchFn:fx('DECLINED')}); t('API status wins',seen.p_status==='DECLINED');
a=mkAdmin({order_payment_apply:async x=>{seen=x;return{data:{ok:true,result:'amount_mismatch'}}}}); r=await W.handle(req(mkEv('APPROVED',99)),{admin:a,fetchFn:fx('APPROVED',99)}); t('wrong amount passes through to DB check',seen.p_amount_in_cents===99&&(await r.json()).result==='amount_mismatch');
a=mkAdmin(); r=await W.handle(req(mkEv('APPROVED',50000,SEC,'KT-AAAAAAAAAAAAAAAAAAAA')),{admin:a,fetchFn:fx()}); t('KT ref ignored',(await r.json()).ignored==='not_kartta_order_reference'&&!a.calls.includes('order_payment_apply'));
a=mkAdmin({order_payment_apply:async()=>({data:{ok:false,result:'not_found'}})}); r=await W.handle(req(mkEv()),{admin:a,fetchFn:fx()}); t('nonexistent ref 200',r.status===200&&(await r.json()).result==='not_found');
a=mkAdmin(); r=await W.handle(req(mkEv()),{admin:a,fetchFn:async()=>({status:503,json:async()=>({})})}); t('wompi down->503 retry',r.status===503);
a=mkAdmin({wompi_get_credentials:async()=>({data:null})}); r=await W.handle(req(mkEv()),{admin:a,fetchFn:fx()}); t('no creds 404',r.status===404);
// integrity
const sig=await C.integritySignature('KO-X',50000,'COP','2026-11-14T00:00:00.000Z','test_integrity_S');t('integrity',sig===sha('KO-X50000COP2026-11-14T00:00:00.000Ztest_integrity_S'));
// checkout create
const OID='22222222-2222-4222-8222-222222222222';
a=mkAdmin({order_payment_prepare:async()=>({data:{state:'ready',reference:REF,restaurant_id:RID,amount_in_cents:50000,currency:'COP',environment:'sandbox',expires_at:'2026-11-14T00:00:00Z',slug:'s',order_code:'2222'}})});
r=await C.handle(new Request('https://x',{method:'POST',body:JSON.stringify({action:'create',order_id:OID})}),{admin:a,fetchFn:fx(),appUrl:'https://kartta.food'});let j=await r.json();
t('create widget',j.widget.amountInCents===50000&&j.widget.signature.integrity===sha(REF+'50000COP2026-11-14T00:00:00.000Ztest_integrity_ABC12345')&&j.widget.redirectUrl==='https://kartta.food/pago/'+REF&&!JSON.stringify(j).includes('test_events'));
r=await C.handle(new Request('https://x',{method:'POST',body:JSON.stringify({action:'create',order_id:'x'})}),{admin:a,fetchFn:fx()});t('create invalid',r.status===400);
a=mkAdmin({order_payment_prepare:async()=>({error:{message:'already_paid'}})});r=await C.handle(new Request('https://x',{method:'POST',body:JSON.stringify({action:'create',order_id:OID})}),{admin:a,fetchFn:fx()});t('already paid 409',r.status===409);
// verify
a=mkAdmin({order_payment_lookup:async()=>({data:{status:'PENDING',restaurant_id:RID,environment:'sandbox',slug:'s',order_code:'2222',amount_in_cents:50000,wompi_transaction_id:null}})});
r=await C.handle(new Request('https://x',{method:'POST',body:JSON.stringify({action:'verify',reference:REF,id:'tx1'})}),{admin:a,fetchFn:fx()});t('verify approved',(await r.json()).status==='approved');
r=await C.handle(new Request('https://x',{method:'POST',body:JSON.stringify({action:'verify',reference:REF,id:'tx1'})}),{admin:a,fetchFn:fx('APPROVED',50000,'KO-FFFFFFFFFFFFFFFFFFFF')});t('verify ref mismatch',r.status===409);
a=mkAdmin({order_payment_lookup:async()=>({data:{status:'PENDING',restaurant_id:RID,environment:'sandbox',slug:'s',order_code:'2',amount_in_cents:50000}}),order_payment_apply:async()=>({data:{ok:true,result:'declined'}})});
r=await C.handle(new Request('https://x',{method:'POST',body:JSON.stringify({action:'verify',reference:REF,id:'tx1'})}),{admin:a,fetchFn:fx('DECLINED')});t('verify declined',(await r.json()).status==='declined');
// connect
const mkU=(auth=true,can=true)=>({auth:{getUser:async()=>({data:{user:auth?{id:'u'}:null}})},rpc:async()=>({data:can})});
const body=o=>new Request('https://x',{method:'POST',body:JSON.stringify({restaurant_id:RID,action:'connect',public_key:'pub_test_'+'a'.repeat(30),integrity_secret:'test_integrity_abcdefgh',events_secret:'test_events_abcdefgh',...o})});
const mw=async()=>({ok:true,status:200,json:async()=>({data:{id:5,name:'Rest'}})});
a=mkAdmin();r=await K.handle(body({}),{userClient:mkU(),adminClient:a,fetchFn:mw});t('connect ok',r.status===200&&a.calls.includes('wompi_save_credentials'));
r=await K.handle(body({}),{userClient:mkU(true,false),adminClient:mkAdmin(),fetchFn:mw});t('connect forbidden',r.status===403);
r=await K.handle(body({}),{userClient:mkU(false),adminClient:mkAdmin(),fetchFn:mw});t('connect unauth',r.status===401);
r=await K.handle(body({events_secret:'prod_events_abcdefgh'}),{userClient:mkU(),adminClient:mkAdmin(),fetchFn:mw});t('env mixed',r.status===400);
r=await K.handle(body({}),{userClient:mkU(),adminClient:mkAdmin(),fetchFn:mw,kartta:{public:'pub_test_'+'a'.repeat(30)}});t('kartta key rejected',(await r.json()).error==='kartta_account_not_allowed');
r=await K.handle(body({}),{userClient:mkU(),adminClient:mkAdmin(),fetchFn:async()=>({ok:false,status:404})});t('wompi rejects',r.status===400);
r=await K.handle(body({}),{userClient:mkU(),adminClient:a,fetchFn:mw});t('no secret in response',!JSON.stringify(await r.json()).includes('abcdefgh'));
console.log('ok',ok,'bad',bad);
