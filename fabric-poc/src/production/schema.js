// One-time migration of older browser samples. Real SQL data is migrated separately.
export function productionSchema(data){
 const next=structuredClone(data);
 if(next.design){
  const oldMappings=(next.variant||[]).filter(v=>v.item_part_id),oldLinks=next.design_per_job||[];
  next.variant=next.design.map(d=>({...d,variant_name:d.design_name,share_weight:d.share_weight??1}));
  next.variant_item=oldMappings.map(v=>({id:v.id,item_part_id:v.item_part_id,variant_id:v.design_id,lab_dip_id:null,legacy_color_map_id:v.color_map_id||null}));
  for(const link of oldLinks){const job=next.job.find(j=>j.id===link.job_id);if(!next.variant_item.some(v=>v.item_part_id===job?.item_part_id&&v.variant_id===link.design_id))next.variant_item.push({id:crypto.randomUUID(),item_part_id:job.item_part_id,variant_id:link.design_id,lab_dip_id:null})}
  next.variant_item_per_job=oldLinks.map(l=>({id:l.id,job_id:l.job_id,variant_item_id:next.variant_item.find(v=>v.item_part_id===next.job.find(j=>j.id===l.job_id)?.item_part_id&&v.variant_id===l.design_id)?.id}));
  for(const p of next.challan_job_item_pieces||[]){const jobId=next.challan_job_item.find(c=>c.id===p.challan_job_item_id)?.job_id,part=next.job.find(j=>j.id===jobId)?.item_part_id;p.variant_item_id=next.variant_item.find(v=>v.item_part_id===part&&v.variant_id===p.design_id)?.id;delete p.design_id}
  delete next.design;delete next.design_per_job;
 }
 next.variant||=[];next.variant_item||=[];next.variant_item_per_job||=[];next.job_assignees||=[];next.production_checklist||=[];next.item_cut_ratio||=[];
 next.variant=next.variant.map(v=>({...v,share_weight:1}));
 if(next.item_status_list&&!next.item_status_list.some(s=>s.status.toLowerCase()==='disputed'))next.item_status_list.push({id:'prod-status-disputed',status:'Disputed'});
 next.production_checklist=next.production_checklist.map(c=>{const {tna_acquired_status_id,...rest}=c;return {...rest,techpack_aqcuired_status_id:c.techpack_aqcuired_status_id??tna_acquired_status_id??null,ordersheet_acquired_status_id:c.ordersheet_acquired_status_id??null}});
 next.stage=(next.stage||[]).map(s=>({...s,pp_stage:s.pp_stage??false}));
 next.stage_pieces=(next.stage_pieces||[]).map(p=>{const {design_per_job_id,pieces_received,...rest}=p;return {...rest,variant_item_per_job_id:p.variant_item_per_job_id||design_per_job_id,pieces_stock_in:p.pieces_stock_in??0,pieces_stock_out:p.pieces_stock_out??pieces_received??0}});
 return next;
}
