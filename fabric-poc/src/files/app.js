import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {FILE_GROUPS,FILE_TARGETS,initialBucketRegistry,resolveGroup,updateBucketSettings} from './model.js';
import {createDemoFileStore,createIndexedFileRepository} from './adapter.js';
import {BucketSettings} from './settings.js';
import '../admin/styles.css';
import {FilePanel} from './panel.js';
import '../fabric/styles.css';
import './styles.css';
const h=React.createElement,registry=initialBucketRegistry();
let store=null,storageError='';try{store=createDemoFileStore({registry,repository:createIndexedFileRepository(window.indexedDB)})}catch(e){storageError=e.message}
function FilesApp(){
 const [groupKey,setGroupKey]=useState('fabric_bills'),[targetKey,setTargetKey]=useState('knittingBill');
 const group=resolveGroup(registry,groupKey),targets=FILE_TARGETS.filter(t=>t.group===groupKey),selected=targets.find(t=>t.key===targetKey)||targets[0];
 function chooseGroup(key){setGroupKey(key);setTargetKey(FILE_TARGETS.find(t=>t.group===key).key)}
 return h('main',{className:'files-workspace'},h('header',null,h('p',{className:'eyebrow'},'FILE STORAGE · LOCAL REVIEW'),h('h1',null,'One place for every attachment'),h('p',null,'Bills, item images and employee documents, organised by their registered file group.')),h('p',{className:'files-boundary'},'This review uses browser storage. Live buckets, upload commands and file-access policies are not activated.'),h('section',{className:'file-groups'},FILE_GROUPS.map(g=>h('button',{key:g.key,'aria-pressed':groupKey===g.key,onClick:()=>chooseGroup(g.key)},h('span',{className:'file-group-icon','aria-hidden':true},g.key==='employee'?'ID':g.key==='items'?'▧':'▤'),h('strong',null,g.label),h('small',null,g.description)))),h('div',{className:'file-context'},h('label',null,'Attachment field',h('select',{'aria-label':'Attachment field',value:selected.key,onChange:e=>setTargetKey(e.target.value)},targets.map(t=>h('option',{value:t.key,key:t.key},t.label)))),h('p',null,'Example saved record · ',h('strong',null,selected.key==='knittingBill'?'KB-026':`${selected.label} · sample`))),storageError?h('p',{role:'alert',className:'form-error'},storageError):h(FilePanel,{store,registry,targetKey:selected.key,recordId:'example-'+selected.key,recordLabel:selected.key==='knittingBill'?'KB-026':`${selected.label} · sample`,canRead:true,canWrite:true}),h('details',{className:'file-registry'},h('summary',null,'Bucket registry'),h('p',null,'The group resolves its bucket through bucket_group. A group name is not used as a hardcoded bucket address.'),h('dl',null,h('dt',null,'Group'),h('dd',null,group.group),h('dt',null,'Registered private bucket'),h('dd',null,group.bucket_id),h('dt',null,'Attachment relation'),h('dd',null,'attachments.bucket_group_id → bucket_group.id'))));
}
function FilesAdmin(){
 const [configured,setConfigured]=useState(registry),[notice,setNotice]=useState('');
 const buckets=[...registry.map(g=>({id:g.bucket_id,private:true})),{id:'garments-fabric-bills-next',private:true}];
 async function save(input){const attachments=(await Promise.all(FILE_TARGETS.map(target=>store.list(target.key,'example-'+target.key)))).flat();setConfigured(updateBucketSettings(configured,input,{isAdministrator:true,attachments,buckets}));setNotice('Settings changed in this isolated preview only. No Supabase buckets were changed.')}
 return h('main',{className:'files-workspace'},h('header',null,h('p',{className:'eyebrow'},'ADMINISTRATION · LOCAL REVIEW'),h('h1',null,'Private file storage')),h('p',{className:'files-boundary'},'Administrator-only configuration design preview. This page simulates an Administrator; live server authorisation is not activated.'),notice&&h('p',{role:'status',className:'file-notice'},notice),h(BucketSettings,{registry:configured,buckets,isAdministrator:true,onSave:save}));
}
const adminRoot=document.getElementById('file-admin-root');
createRoot(adminRoot||document.getElementById('files-root')).render(h(adminRoot?FilesAdmin:FilesApp));
