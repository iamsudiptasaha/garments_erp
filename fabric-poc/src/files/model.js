const MB=1024*1024;
export const FILE_GROUPS=Object.freeze([
 {key:'job_worker_bills',label:'Job worker bills',description:'Bills from job workers',bucket:'garments-job-worker-bills'},
 {key:'fabric_bills',label:'Fabric bills',description:'Yarn, knitting and dyeing bills',bucket:'garments-fabric-bills'},
 {key:'items',label:'Item files',description:'Item-related files, except job worker bills',bucket:'garments-items'},
 {key:'raw_material_bills',label:'Raw material bills',description:'Bills for raw materials received',bucket:'garments-raw-material-bills'},
 {key:'employee',label:'Employee documents',description:'Employee supporting documents',bucket:'garments-employee'}
]);
const images=['image/jpeg','image/png','image/webp'],documents=['application/pdf',...images];
export const FILE_TARGETS=Object.freeze([
 {key:'labDipShade',group:'items',resource:'labDips',table:'lab_dip_version',slot:'shade_card_image_attachment',label:'Lab-dip shade card',mime:images},
 {key:'yarnBill',group:'fabric_bills',resource:'yarn',table:'yarn_bill',slot:'bill_attachment',label:'Yarn bill',mime:documents},
 {key:'knittingBill',group:'fabric_bills',resource:'knitting',table:'knitting_bill',slot:'bill_attachment',label:'Knitting bill',mime:documents},
 {key:'dyedBill',group:'fabric_bills',resource:'dyeBills',table:'dyed_fabric_bill',slot:'bill_attachment',label:'Dyed fabric bill',mime:documents},
 {key:'workerBill',group:'job_worker_bills',resource:'jobWorkerBills',table:'job_worker_bill',slot:'bill_attachment',label:'Job worker bill',mime:documents},
 {key:'itemImage',group:'items',resource:'productionItems',table:'item',slot:'image_attachment',label:'Item image',mime:images},
 {key:'rawMaterialBill',group:'raw_material_bills',resource:'materialReceipts',table:'raw_material_check_in',slot:'bill_attachment',label:'Stock receipt bill',mime:documents},
 {key:'employeeDocument1',group:'employee',resource:'employees',table:'employee',slot:'supporting_document_1_upload',label:'Employee document 1',mime:documents},
 {key:'employeeDocument2',group:'employee',resource:'employees',table:'employee',slot:'supporting_document_2_upload',label:'Employee document 2',mime:documents}
]);
const DEFAULT_FILE_LIMIT=10*MB;
export function initialBucketRegistry(){return FILE_GROUPS.map((g,i)=>({id:String(i+1),group:g.key,bucket_id:g.bucket,description:g.description,private:true,max_bytes:DEFAULT_FILE_LIMIT}))}
export function targetFor(key){const target=FILE_TARGETS.find(t=>t.key===key);if(!target)throw Error('This attachment field has not been configured.');return target}
export function resolveGroup(registry,key){const matches=registry.filter(r=>r.group===key);if(matches.length!==1)throw Error('The file group is missing or duplicated in the bucket registry.');const group=matches[0];if(!group.bucket_id||group.private!==true)throw Error('This file group must point to a verified private bucket.');return group}
export function validateFile(file,target,group){
 if(!file||typeof file.name!=='string'||!file.name.trim())throw Error('Choose a file.');
 if(!Number.isSafeInteger(file.size)||file.size<=0)throw Error('Choose a non-empty file.');
 if(file.size>(group.max_bytes||DEFAULT_FILE_LIMIT))throw Error('This file exceeds the allowed size.');
 if(!target.mime.includes(file.type))throw Error('Use a supported PDF, JPEG, PNG or WebP file for this field.');
 if(file.name.length>240||[...file.name].some(char=>char.charCodeAt(0)<32||char.charCodeAt(0)===127))throw Error('Use a shorter filename without control characters.');
 return {filename:file.name,mime_type:file.type,file_size:String(file.size)};
}
export function validateRecordId(value,live=false){const id=String(value??'');if(live?!/^[1-9]\d*$/.test(id):!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(id))throw Error('Save the record before attaching a file.');return id}
export function objectPath(target,recordId,objectId){
 validateRecordId(recordId);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(objectId))throw Error('The server must allocate a random file identifier.');
 return `${target.table}/${recordId}/${target.slot}/${objectId}`;
}
export function prettyBytes(value){const n=Number(value);if(!Number.isFinite(n)||n<0)return 'Unknown size';return n>=MB?`${(n/MB).toFixed(1)} MB`:`${Math.max(1,Math.round(n/1024))} KB`}
export function updateBucketSettings(registry,{groupKey,description,bucketId,maxBytes,expectedVersion},{isAdministrator,attachments=[],buckets=[]}){
 if(!isAdministrator)throw Error('Administrator access is required to edit bucket settings.');
 const current=resolveGroup(registry,groupKey);
 if(expectedVersion!==(current.version||1))throw Error('Bucket settings changed. Reload before saving.');
 if(typeof description!=='string'||description.trim().length>500)throw Error('Use a description up to 500 characters.');
 if(!Number.isSafeInteger(maxBytes)||maxBytes<=0||maxBytes>DEFAULT_FILE_LIMIT)throw Error('Choose an upload limit up to 10 MB.');
 const bucket=buckets.find(b=>b.id===bucketId);if(!bucket||bucket.private!==true)throw Error('Choose an existing verified private bucket.');
 if(registry.some(r=>r.group!==groupKey&&r.bucket_id===bucketId))throw Error('This bucket is already registered to another group.');
 if(bucketId!==current.bucket_id&&attachments.some(a=>String(a.bucket_group_id)===String(current.id)))throw Error('This group already has attachments. Keep its bucket or use a reviewed migration that preserves old file locations.');
 return registry.map(r=>r.group===groupKey?{...r,description:description.trim(),bucket_id:bucketId,max_bytes:maxBytes,version:(r.version||1)+1}:r);
}
