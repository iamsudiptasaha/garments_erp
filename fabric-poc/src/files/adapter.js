import {resolveGroup,targetFor,validateFile,validateRecordId,objectPath} from './model.js';
const clone=value=>structuredClone(value);
const ticketPathMatches=(target,id,path)=>{try{return path===objectPath(target,id,path.split('/')[3])}catch{return false}};
export function createDemoFileStore({registry,repository,makeId=()=>crypto.randomUUID(),clock=()=>new Date().toISOString()}){
 return {
  mode:'local',
  async list(targetKey,recordId){targetFor(targetKey);validateRecordId(recordId);return repository.list(targetKey,recordId)},
  async attach({targetKey,recordId,file,employeeId=null}){
   const target=targetFor(targetKey),id=validateRecordId(recordId),group=resolveGroup(registry,target.group),metadata=validateFile(file,target,group),attachmentId=makeId();
   const attachment={id:attachmentId,bucket_group_id:group.id,storage_path:objectPath(target,id,attachmentId),...metadata,uploaded_by:employeeId,created_at:clock(),target_key:targetKey,record_id:id};
   await repository.put(attachment,file);return clone(attachment);
  },
  async open(attachment){return repository.getBlob(attachment.id)}
 };
}
// The server must resolve the registry and current record access. The browser
// never chooses a bucket/path, writes attachments directly or stores a public URL.
export function createLiveFileStore({client,registry,commands}){
 for(const name of ['beginUpload','finaliseUpload','cancelUpload','listAttachments','readAttachment'])if(typeof commands?.[name]!=='function')throw Error('Live file commands are not configured.');
 return {
  mode:'supabase',
  async list(targetKey,recordId){targetFor(targetKey);validateRecordId(recordId,true);return commands.listAttachments({targetKey,recordId:String(recordId)})},
  async attach({targetKey,recordId,file,previousAttachmentId=null}){
   const target=targetFor(targetKey),id=validateRecordId(recordId,true),group=resolveGroup(registry,target.group),metadata=validateFile(file,target,group);
   const ticket=await commands.beginUpload({targetKey,recordId:id,previousAttachmentId,...metadata});
   if(!ticket?.id||String(ticket.bucket_group_id)!==String(group.id)||ticket.bucket_id!==group.bucket_id||typeof ticket.token!=='string'||typeof ticket.storage_path!=='string'||!ticketPathMatches(target,id,ticket.storage_path)){
    if(ticket?.id)await commands.cancelUpload({ticketId:ticket.id,reason:'invalid_ticket'}).catch(()=>{});
    throw Error('The upload ticket does not match the registered file group.');
   }
   let uploaded=false;
   try{
    const {error}=await client.storage.from(ticket.bucket_id).uploadToSignedUrl(ticket.storage_path,ticket.token,file,{contentType:file.type,upsert:false});if(error)throw error;uploaded=true;
    return await commands.finaliseUpload({ticketId:ticket.id});
   }catch(error){
    try{await commands.cancelUpload({ticketId:ticket.id,reason:uploaded?'finalise_failed':'upload_failed'})}catch{throw Error('File upload did not finish. Cleanup is pending; reload the record before retrying.')}
    throw error;
   }
  },
  async open(attachment){return commands.readAttachment({attachmentId:attachment.id})}
 };
}
export function createMemoryFileRepository(){const rows=new Map(),blobs=new Map();return {
 async put(row,blob){rows.set(row.id,clone(row));blobs.set(row.id,blob)},
 async list(targetKey,recordId){return [...rows.values()].filter(r=>r.target_key===targetKey&&r.record_id===String(recordId)).sort((a,b)=>b.created_at.localeCompare(a.created_at)).map(clone)},
 async getBlob(id){const blob=blobs.get(id);if(!blob)throw Error('File is not available in this browser.');return blob}
}}
export function createIndexedFileRepository(indexedDB){
 if(!indexedDB)throw Error('This browser does not support local file storage.');
 let connection;
 async function database(){if(!connection)connection=new Promise((resolve,reject)=>{const request=indexedDB.open('garments-local-files-v1',1);request.onupgradeneeded=()=>request.result.createObjectStore('files',{keyPath:'id'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});return connection}
 async function request(mode,operation){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('files',mode),req=operation(tx.objectStore('files'));let result;req.onsuccess=()=>{result=req.result};tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error||Error('Local file storage failed.'));tx.onabort=()=>reject(tx.error||Error('Local file storage was interrupted.'))})}
 return {
  async put(row,blob){await request('readwrite',store=>store.put({...clone(row),blob}))},
  async list(targetKey,recordId){const rows=await request('readonly',store=>store.getAll());return rows.filter(r=>r.target_key===targetKey&&r.record_id===String(recordId)).sort((a,b)=>b.created_at.localeCompare(a.created_at)).map(({blob:_blob,...row})=>row)},
  async getBlob(id){const row=await request('readonly',store=>store.get(id));if(!row?.blob)throw Error('The local file is unavailable.');return row.blob}
 };
}
