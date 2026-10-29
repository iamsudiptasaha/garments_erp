import test from 'node:test';
import assert from 'node:assert/strict';
import {FILE_GROUPS,initialBucketRegistry,resolveGroup,targetFor,validateFile,validateRecordId,objectPath,prettyBytes} from '../src/files/model.js';
import {createDemoFileStore,createMemoryFileRepository,createLiveFileStore} from '../src/files/adapter.js';
const uuid='fe87f095-0ea3-418f-881c-b681d7c01954';
const file=()=>new File(['sample bill'], 'invoice.pdf',{type:'application/pdf'});
test('file groups match feature sheet and resolve registered bucket IDs rather than group names',()=>{
 const registry=initialBucketRegistry();assert.deepEqual(FILE_GROUPS.map(g=>g.key),['job_worker_bills','fabric_bills','items','raw_material_bills','employee']);registry.find(g=>g.group==='fabric_bills').bucket_id='a-private-rotated-bucket';assert.equal(resolveGroup(registry,'fabric_bills').bucket_id,'a-private-rotated-bucket');assert.throws(()=>resolveGroup([...registry,registry[0]],registry[0].group),/duplicated/);registry[0].private=false;assert.throws(()=>resolveGroup(registry,registry[0].group),/private bucket/);
});
test('file validation refuses active types, oversize, empty files and unsafe record paths',()=>{
 const group=resolveGroup(initialBucketRegistry(),'fabric_bills');assert.equal(validateFile(file(),targetFor('knittingBill'),group).file_size,'11');assert.throws(()=>validateFile(new File(['x'],'file.svg',{type:'image/svg+xml'}),targetFor('itemImage'),group),/supported/);assert.throws(()=>validateFile(new File([],'empty.pdf',{type:'application/pdf'}),targetFor('knittingBill'),group),/non-empty/);assert.throws(()=>validateFile({name:'huge.pdf',type:'application/pdf',size:group.max_bytes+1},targetFor('knittingBill'),group),/size/);assert.throws(()=>validateRecordId('../foreign'),/Save the record/);assert.throws(()=>validateRecordId('kb1',true),/Save the record/);assert.equal(validateRecordId('9223372036854775807',true),'9223372036854775807');assert.equal(objectPath(targetFor('knittingBill'),'123',uuid),`knitting_bill/123/bill_attachment/${uuid}`);assert.throws(()=>objectPath(targetFor('knittingBill'),'123','invoice.pdf'),/random/);assert.equal(prettyBytes('1048576'),'1.0 MB');
});
test('local attachments persist metadata/blob through the repository and remain scoped by document',async()=>{
 const repository=createMemoryFileRepository(),registry=initialBucketRegistry(),store=createDemoFileStore({registry,repository,makeId:()=>uuid,clock:()=> '2026-10-27T00:00:00.000Z'});const attached=await store.attach({targetKey:'knittingBill',recordId:'kb1',file:file()});assert.equal(attached.bucket_group_id,resolveGroup(registry,'fabric_bills').id);assert.equal(attached.address,undefined);assert.equal((await store.list('knittingBill','kb1')).length,1);assert.equal((await store.list('knittingBill','kb2')).length,0);const secondSession=createDemoFileStore({registry,repository});assert.equal(await (await secondSession.open(attached)).text(),'sample bill');
});
function liveHarness({uploadError=null,finaliseError=null,cancelError=null,ticketChange={}}={}){
 const calls=[],registry=initialBucketRegistry(),group=resolveGroup(registry,'fabric_bills'),commands={
  async beginUpload(){calls.push('begin');return {id:'ticket1',bucket_group_id:group.id,bucket_id:group.bucket_id,storage_path:objectPath(targetFor('knittingBill'),'123',uuid),token:'server-signed-token',...ticketChange}},
  async finaliseUpload(){calls.push('finalise');if(finaliseError)throw Error(finaliseError);return {id:'attachment1'}},
  async cancelUpload(){calls.push('cancel');if(cancelError)throw Error(cancelError)},
  async listAttachments(){return []},async readAttachment(){return {url:'https://example.com/short-lived'}}
 },client={storage:{from(bucket){calls.push(bucket);return {async uploadToSignedUrl(_path,_token,_file,options){calls.push('upload');assert.equal(options.upsert,false);return {error:uploadError?Error(uploadError):null}}}}}};
 return {store:createLiveFileStore({client,registry,commands}),calls,registry};
}
test('live adapter uses only server ticket, finalises after upload and returns no public URL',async()=>{
 const {store,calls}=liveHarness();const result=await store.attach({targetKey:'knittingBill',recordId:'123',file:file()});assert.equal(result.id,'attachment1');assert.deepEqual(calls,['begin','garments-fabric-bills','upload','finalise']);assert.deepEqual(await store.list('knittingBill','123'),[]);assert.equal((await store.open(result)).url,'https://example.com/short-lived');assert.throws(()=>createLiveFileStore({client:{},registry:[],commands:{}}),/not configured/);
});
test('failed finalisation or upload triggers trusted cancellation; failed cleanup is explicit',async()=>{
 for(const options of [{uploadError:'Upload failed'},{finaliseError:'Record changed'}]){const {store,calls}=liveHarness(options);await assert.rejects(store.attach({targetKey:'knittingBill',recordId:'123',file:file()}),/failed|changed/);assert.equal(calls.at(-1),'cancel')}
 const {store}=liveHarness({finaliseError:'Record changed',cancelError:'Storage offline'});await assert.rejects(store.attach({targetKey:'knittingBill',recordId:'123',file:file()}),/Cleanup is pending/);
});
test('mismatched ticket bucket or target path never reaches Storage',async()=>{
 for(const ticketChange of [{bucket_id:'public'},{storage_path:'employee/123/supporting_document_1_upload/'+uuid},{storage_path:'knitting_bill/123/bill_attachment/../../employee'}]){const {store,calls}=liveHarness({ticketChange});await assert.rejects(store.attach({targetKey:'knittingBill',recordId:'123',file:file()}),/does not match/);assert.deepEqual(calls,['begin','cancel'])}
});

test('only Administrator can edit registry settings; referenced buckets cannot be redirected',async()=>{
 const {updateBucketSettings}=await import('../src/files/model.js');const registry=initialBucketRegistry(),group=resolveGroup(registry,'fabric_bills'),input={groupKey:'fabric_bills',description:'Revised fabric documents',bucketId:'new-private-bucket',maxBytes:1024*1024,expectedVersion:1},buckets=[{id:'new-private-bucket',private:true},{id:group.bucket_id,private:true}];
 assert.throws(()=>updateBucketSettings(registry,input,{isAdministrator:false,buckets}),/Administrator/);assert.throws(()=>updateBucketSettings(registry,input,{isAdministrator:true,buckets,attachments:[{bucket_group_id:group.id}]}),/already has attachments/);assert.throws(()=>updateBucketSettings(registry,{...input,expectedVersion:99},{isAdministrator:true,buckets}),/changed/);assert.throws(()=>updateBucketSettings(registry,input,{isAdministrator:true,buckets:[{id:'new-private-bucket',private:false}]}),/private bucket/);
 const next=updateBucketSettings(registry,input,{isAdministrator:true,buckets});assert.equal(resolveGroup(next,'fabric_bills').bucket_id,'new-private-bucket');assert.equal(resolveGroup(next,'fabric_bills').version,2);assert.equal(resolveGroup(registry,'fabric_bills').bucket_id,group.bucket_id);
 const existing=updateBucketSettings(registry,{...input,bucketId:group.bucket_id},{isAdministrator:true,buckets,attachments:[{bucket_group_id:group.id}]});assert.equal(resolveGroup(existing,'fabric_bills').description,'Revised fabric documents');
});
test('server content validation rejects spoofed MIME types',async()=>{
 const {matchesContent}=await import('../../supabase/functions/erp-files/content.mjs');
 assert.equal(matchesContent(new TextEncoder().encode('%PDF-1.4\n'),'application/pdf'),true);
 assert.equal(matchesContent(new TextEncoder().encode('<script>bad</script>'),'application/pdf'),false);
 assert.equal(matchesContent(new Uint8Array([137,80,78,71,13,10,26,10]),'image/png'),true);
 assert.equal(matchesContent(new Uint8Array([255,216,255]),'image/jpeg'),true);
 assert.equal(matchesContent(new TextEncoder().encode('RIFF0000WEBP'),'image/webp'),true);
 assert.equal(matchesContent(new Uint8Array([]),'image/svg+xml'),false);
});
test('live file commands preserve string IDs and upload only validated saved-record files',async()=>{
 const {liveFileCommands}=await import('../src/files/live.js');const calls=[];
 const client={rpc:async(name,args)=>{calls.push({name,args});return {data:[],error:null}},functions:{invoke:async(name,args)=>{calls.push({name,args});return {data:{id:'9223372036854775807'},error:null}}}};
 const commands=liveFileCommands(client),store=commands.store(initialBucketRegistry());
 await store.list('knittingBill','9223372036854775807');assert.equal(calls[0].args.p_record_id,'9223372036854775807');
 await store.attach({targetKey:'knittingBill',recordId:'12',file:file()});assert.equal(calls[1].name,'erp-files');assert.equal(calls[1].args.body.get('recordId'),'12');
 await assert.rejects(store.attach({targetKey:'knittingBill',recordId:'sample-12',file:file()}),/Save the record/);
 assert.equal(calls.length,2);
});
test('live uploads follow database routes rather than default group/type settings',async()=>{
 const {liveFileCommands}=await import('../src/files/live.js');let invoked=0;
 const client={functions:{invoke:async()=>{invoked++;return {data:{id:'1'},error:null}}}};
 const registry=initialBucketRegistry(),route={...targetFor('knittingBill'),group:'items',mime:['image/png'],max_bytes:10,enabled:true};
 const store=liveFileCommands(client).store(registry,[route]);
 await assert.rejects(store.attach({targetKey:'knittingBill',recordId:'1',file:file()}),/size|supported/);
 await assert.rejects(store.attach({targetKey:'knittingBill',recordId:'1',file:new File(['12345678901'],'x.png',{type:'image/png'})}),/size/);
 await store.attach({targetKey:'knittingBill',recordId:'1',file:new File(['png'],'x.png',{type:'image/png'})});
 assert.equal(invoked,1);
 const paused=liveFileCommands(client).store(registry,[{...route,enabled:false}]);
 await assert.rejects(paused.attach({targetKey:'knittingBill',recordId:'1',file:file()}),/disabled/);
});
test('bucket lifecycle commands send administrator inputs without exposing storage credentials',async()=>{
 const {liveFileCommands}=await import('../src/files/live.js');const calls=[];
 const client={rpc:async(name,args)=>{calls.push({name,args});return {data:{id:'9'},error:null}},functions:{invoke:async(name,args)=>{calls.push({name,args});return {data:{removed:true},error:null}}}};
 const commands=liveFileCommands(client);
 await commands.createGroup({group:'lab_dip_files',description:'Shade cards',mime:['image/png'],max_bytes:1048576});
 assert.deepEqual(calls[0],{name:'erp_create_bucket_group',args:{p_group:'lab_dip_files',p_description:'Shade cards',p_mimes:['image/png'],p_max_bytes:1048576}});
 await commands.removeGroup({id:'9223372036854775807',version:2},'lab_dip_files');
 assert.equal(calls[1].args.body.groupId,'9223372036854775807');assert.equal(calls[1].args.body.confirmation,'lab_dip_files');
});
