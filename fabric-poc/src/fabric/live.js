import {fabricContract,fabricColumnTypes} from './live-contract.js';
export const liveFabricPage=key=>Object.hasOwn(fabricContract,key);
export function emptyLiveFabric(template){return Object.fromEntries(Object.keys(template).map(k=>[k,Array.isArray(template[k])?[]:template[k]]))}
function editable(row,fields){return Object.fromEntries(fields.filter(k=>Object.hasOwn(row,k)).map(k=>[k,row[k]]))}
export function fabricChanges(before,after,resource){
 const contract=fabricContract[resource];if(!contract)throw Error('This section is not connected for live saving.');const changes=[];
 for(const [table,fields]of Object.entries(contract)){
  const old=new Map((before[table]||[]).map(r=>[r.id,r])),current=new Map((after[table]||[]).map(r=>[r.id,r]));
  for(const r of current.values()){const previous=old.get(r.id),values=editable(r,fields);if(!previous||JSON.stringify(values)!==JSON.stringify(editable(previous,fields)))changes.push({table,id:r.id,before:previous||null,values})}
  for(const r of old.values())if(!current.has(r.id))changes.push({table,id:r.id,before:r,values:null});
 }
 return changes;
}
export function liveFabricCommands(client){
 async function rpc(name,args={}){const {data,error}=await client.rpc(name,args);if(error)throw Error(error.message);return data}
 return {load:()=>rpc('erp_fabric_snapshot'),save:({resource,root,action,before,after})=>{const changes=fabricChanges(before,after,resource);return changes.length?rpc('erp_save_fabric_document',{p_resource:resource,p_root:root,p_action:action,p_changes:changes}):rpc('erp_fabric_snapshot')}};
}
export function assertLiveIdentifiers(snapshot){for(const [table,types]of Object.entries(fabricColumnTypes))for(const row of snapshot[table]||[])for(const [key,type]of Object.entries(types))if(type==='bigint'&&row[key]!=null&&typeof row[key]!=='string')throw Error(`Unsafe identifier received for ${table}.${key}`);return snapshot}
export function fabricRoot(resource,before,after,editor){
 const contract=fabricContract[resource],tables=resource==='suppliers'?['yarn_supplier','knitter','dyer']:[Object.keys(contract)[0]];
 for(const table of tables){const added=(after[table]||[]).find(r=>!(before[table]||[]).some(old=>old.id===r.id));if(added)return {table,id:added.id,before:null}}
 let table=tables[0],id=editor.id;
 if(resource==='suppliers'){[table,id]=id.split(':')}
 const row=(before[table]||[]).find(r=>r.id===id);if(!row)throw Error('Cannot identify the record being saved. Reload and reopen it.');return {table,id,before:row};
}
