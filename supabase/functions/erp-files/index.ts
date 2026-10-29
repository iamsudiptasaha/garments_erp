import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
import {matchesContent} from './content.mjs';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...headers,'Content-Type':'application/json'}});
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response(null,{headers});
 if(req.method!=='POST')return json({error:'POST required'},405);
 const authorization=req.headers.get('Authorization');if(!authorization?.startsWith('Bearer '))return json({error:'Sign in required'},401);
 const url=Deno.env.get('SUPABASE_URL')!,user=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:authorization}},auth:{persistSession:false}});
 const {data:auth,error:authError}=await user.auth.getUser();if(authError||!auth.user)return json({error:'Sign in required'},401);
 const service=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
 async function rpc(name:string,args:Record<string,unknown>={}){const {data,error}=await user.rpc('erp_'+name,args);if(error)throw Error(error.message);return data}
 async function removePending(ticket:{id:string,bucket_id:string,storage_path:string}){
  const state=await rpc('file_cleanup',{p_ticket:ticket.id});
  if(state.status!=='cleanup_required')throw Error('Cleanup no longer allowed');
  const {error}=await service.storage.from(state.bucket_id).remove([state.storage_path]);if(error)throw error;
  await rpc('file_cleanup_done',{p_ticket:ticket.id});
 }
 let ticket:{id:string,bucket_id:string,storage_path:string}|null=null;
 try{
  if(req.headers.get('Content-Type')?.includes('multipart/form-data')){
   if(Number(req.headers.get('Content-Length'))>11*1024*1024)return json({error:'Upload limit is 10 MB'},413);
   const form=await req.formData(),file=form.get('file');
   if(!(file instanceof File)||file.size<=0||file.size>10*1024*1024)throw Error('Choose a file up to 10 MB');
   const bytes=new Uint8Array(await file.arrayBuffer());if(!matchesContent(bytes,file.type))throw Error('File content does not match its PDF/image type');
   ticket=await rpc('begin_file_upload',{p_key:String(form.get('targetKey')),p_record_id:String(form.get('recordId')),p_filename:file.name,p_mime:file.type,p_size:file.size});
   const {error}=await service.storage.from(ticket!.bucket_id).upload(ticket!.storage_path,bytes,{contentType:file.type,upsert:false});if(error)throw error;
   const attachment=await rpc('finish_file_upload',{p_ticket:ticket!.id});ticket=null;return json(attachment);
  }
  const input=await req.json();
  if(input.action==='removeBucket'){
   const reservation=await rpc('prepare_bucket_removal',{p_group_id:String(input.groupId),p_version:input.version,p_confirm:input.confirmation});
   try{const {data:bucket}=await service.storage.getBucket(reservation.bucket_id);if(bucket){const {error}=await service.storage.deleteBucket(reservation.bucket_id);if(error)throw error;}await rpc('finish_bucket_removal',{p_group_id:reservation.id,p_token:reservation.token});return json({removed:true});}
   catch(error){await rpc('cancel_bucket_removal',{p_group_id:reservation.id,p_token:reservation.token}).catch(()=>{});throw error;}
  }
  if(input.action==='read'){
   const path=await rpc('file_read',{p_id:String(input.attachmentId)});
   const {data,error}=await service.storage.from(path.bucket_id).createSignedUrl(path.storage_path,60);if(error)throw error;
   return json({url:data.signedUrl});
  }
  if(input.action==='cleanup'){
   const pending=await rpc('file_cleanup'),results=[];
   for(const row of pending){try{await removePending(row);results.push({id:row.id,cleaned:true})}catch{results.push({id:row.id,cleaned:false})}}
   return json({results});
  }
  return json({error:'Unknown file operation'},400);
 }catch(error){
  let cleanupPending=false;
  if(ticket){try{const result=await rpc('cancel_file_upload',{p_ticket:ticket.id});if(!result.ready)await removePending(ticket)}catch{cleanupPending=true}}
  return json({error:cleanupPending?'Upload did not finish. An Administrator must retry file cleanup.':error instanceof Error?error.message:'File operation failed'},400);
 }
});
