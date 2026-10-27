export function initialProduction(){return {
 item:[{id:'prod-item-1',style_code:'SC-101',brand_id:'br1',story:'Everyday essentials',season:'AW26',product_type_list_id:'prod-type-1',product_description:'Crew neck tee',base_price:299,image_attachment:null}],
 part_list:[{id:'prod-part-body',part:'Body'},{id:'prod-part-sleeve',part:'Sleeve'}],
 item_part:[{id:'prod-ip-1',item_id:'prod-item-1',part_list_id:'prod-part-body'},{id:'prod-ip-2',item_id:'prod-item-1',part_list_id:'prod-part-sleeve'}],
 gender:[{id:'prod-gender-1',name:'Unisex'}],product_type_list:[{id:'prod-type-1',product_type:'T-shirt',gender_id:'prod-gender-1'}],
 size_list:[{id:'prod-size-s',size:'S',sort_order:1},{id:'prod-size-m',size:'M',sort_order:2},{id:'prod-size-l',size:'L',sort_order:3}],
 item_size_list:[{id:'prod-is-s',item_id:'prod-item-1',size_list_id:'prod-size-s'},{id:'prod-is-m',item_id:'prod-item-1',size_list_id:'prod-size-m'},{id:'prod-is-l',item_id:'prod-item-1',size_list_id:'prod-size-l'}],
 design:[{id:'prod-design-1',design_name:'Plain',share_weight:1},{id:'prod-design-2',design_name:'Chest print',share_weight:1}],
 stage_type:[{id:'prod-st-1',name:'Production'}],
 stage:[{id:'prod-stage-cut',name:'Cutting',abbr:'CUT',sort_order:1,stage_type_id:'prod-st-1',track_pieces:true},{id:'prod-stage-print',name:'Printing',abbr:'PRT',sort_order:2,stage_type_id:'prod-st-1',track_pieces:true},{id:'prod-stage-stitch',name:'Stitching',abbr:'STI',sort_order:3,stage_type_id:'prod-st-1',track_pieces:true}],
 item_status_list:[{id:'prod-status-1',status:'Yet to start'},{id:'prod-status-2',status:'In process'},{id:'prod-status-3',status:'Complete'},{id:'prod-status-4',status:'Skipped'},{id:'prod-status-5',status:'Redo'}],
 job_worker:[{id:'prod-worker-1',contacts_id:'s3',contact_purpose_id:'prod-purpose-worker'}],
 job:[{id:'prod-job-cut',job_code:'SC-101-BODY-CUT',item_part_id:'prod-ip-1',stage_id:'prod-stage-cut',item_status_list_id:'prod-status-3',job_worker_id:null,start_date:'2026-10-24',due_date:'2026-10-25',complete_date:'2026-10-25',verify_employee_id:'owner'},{id:'prod-job-print',job_code:'SC-101-BODY-PRT',item_part_id:'prod-ip-1',stage_id:'prod-stage-print',item_status_list_id:'prod-status-2',job_worker_id:'prod-worker-1',start_date:'2026-10-26',due_date:'2026-10-28',complete_date:null,verify_employee_id:null}],
 design_per_job:[{id:'prod-dpj-cut',job_id:'prod-job-cut',design_id:'prod-design-1'},{id:'prod-dpj-print',job_id:'prod-job-print',design_id:'prod-design-1'}],
 stage_pieces:[{id:'prod-sp-s',design_per_job_id:'prod-dpj-cut',item_size_list_id:'prod-is-s',pieces_received:100},{id:'prod-sp-m',design_per_job_id:'prod-dpj-cut',item_size_list_id:'prod-is-m',pieces_received:120},{id:'prod-sp-l',design_per_job_id:'prod-dpj-cut',item_size_list_id:'prod-is-l',pieces_received:80}],
 challan:[],challan_job_item:[],challan_job_item_pieces:[]
}}
export function upgradeProduction(data){
 const seed=initialProduction(),next={...seed,...data};
 // Inventory introduced empty item/part collections; retain real rows and seed
 // only an entirely empty Production workspace, never overwrite linked records.
 if(!data.job&&!(data.item||[]).length){next.item=seed.item;next.item_part=seed.item_part;next.part_list=seed.part_list}
 if(!next.contact_purpose.some(p=>p.id==='prod-purpose-worker'))next.contact_purpose=[...next.contact_purpose,{id:'prod-purpose-worker',type:'Production partner'}];
 if(!data.job&&(data.item||[]).length){for(const table of ['job','design_per_job','stage_pieces','item_part','item_size_list'])if(!data[table])next[table]=[]}
 return next;
}
const dash=v=>v==null||v===''?'—':v;
export function productionSelectors(data){
 const get=(table,id)=>data[table].find(r=>r.id===id);
 const part=id=>{const row=get('item_part',id);return {row,item:get('item',row?.item_id),name:get('part_list',row?.part_list_id)?.part||'—'}};
 const worker=id=>get('contacts',get('job_worker',id)?.contacts_id)?.company_name||'In-house';
 const job=r=>{const p=part(r.item_part_id),designs=data.design_per_job.filter(d=>d.job_id===r.id),pieces=data.stage_pieces.filter(s=>designs.some(d=>d.id===s.design_per_job_id));return {p,designs,pieces,stage:get('stage',r.stage_id),status:get('item_status_list',r.item_status_list_id)?.status,worker:worker(r.job_worker_id)}};
 return {get,part,worker,job};
}
export function productionRows(data,page){
 const s=productionSelectors(data),identity=r=>({id:r.id,documentId:r.id});
 if(page==='productionItems')return data.item.map(r=>({...identity(r),name:r.style_code,brand:s.get('brand_list',r.brand_id)?.brand||'—',description:dash(r.product_description),season:dash(r.season),product:s.get('product_type_list',r.product_type_list_id)?.product_type||'—',price:r.base_price??'—',parts:data.item_part.filter(p=>p.item_id===r.id).length,jobs:data.job.filter(j=>s.part(j.item_part_id).item?.id===r.id).length}));
 if(page==='productionParts')return data.item_part.map(r=>({...identity(r),name:s.get('item',r.item_id)?.style_code,part:s.get('part_list',r.part_list_id)?.part,jobs:data.job.filter(j=>j.item_part_id===r.id).length}));
 if(page==='productionJobs')return data.job.map(r=>{const j=s.job(r),links=data.challan_job_item.filter(l=>l.job_id===r.id);return {...identity(r),name:j.p.item?.style_code,part:j.p.name,code:r.job_code,stage:j.stage?.name,stageOrder:j.stage?.sort_order,status:j.status,worker:j.worker,designs:j.designs.map(d=>s.get('design',d.design_id)?.design_name).join(', '),received:j.pieces.reduce((n,p)=>n+p.pieces_received,0),issued:data.challan_job_item_pieces.filter(p=>links.some(l=>l.id===p.challan_job_item_id)).reduce((n,p)=>n+p.issued_pieces,0),due:dash(r.due_date),complete:dash(r.complete_date)}});
 if(page==='productionWorkers')return data.job_worker.map(r=>({...identity(r),name:s.worker(r.id),purpose:s.get('contact_purpose',r.contact_purpose_id)?.type,jobs:data.job.filter(j=>j.job_worker_id===r.id).length}));
 if(page==='productionItemSizes')return data.item_size_list.map(r=>({...identity(r),name:s.get('item',r.item_id)?.style_code,size:s.get('size_list',r.size_list_id)?.size}));
 if(page==='productionDesigns')return data.design.map(r=>({...identity(r),name:r.design_name,weight:r.share_weight??'—'}));
 if(page==='productionStages')return data.stage.map(r=>({...identity(r),name:r.name,abbr:r.abbr,order:r.sort_order,type:s.get('stage_type',r.stage_type_id)?.name,track:r.track_pieces?'Yes':'No'}));
 if(page==='productionStageTypes')return data.stage_type.map(r=>({...identity(r),name:r.name}));
 if(page==='productionPartTypes')return data.part_list.map(r=>({...identity(r),name:r.part}));
 if(page==='productionSizes')return data.size_list.map(r=>({...identity(r),name:r.size,order:r.sort_order}));
 if(page==='productionProductTypes')return data.product_type_list.map(r=>({...identity(r),name:r.product_type,gender:s.get('gender',r.gender_id)?.name}));
 if(page==='productionStatuses')return data.item_status_list.map(r=>({...identity(r),name:r.status}));
 return [];
}
export function productionOptions(data,source){
 const mappings={productionItems:['item','style_code'],productionPartTypes:['part_list','part'],productionSizes:['size_list','size'],productionDesigns:['design','design_name'],productionStages:['stage','name'],productionStageTypes:['stage_type','name'],productionStatuses:['item_status_list','status'],productionGenders:['gender','name'],productionProductTypes:['product_type_list','product_type']};
 if(mappings[source]){const [table,label]=mappings[source];return data[table].map(r=>[r.id,r[label]])}
 const s=productionSelectors(data);
 if(source==='productionParts')return data.item_part.map(r=>[r.id,`${s.part(r.id).item?.style_code} / ${s.part(r.id).name}`]);
 if(source==='productionWorkers')return data.job_worker.map(r=>[r.id,s.worker(r.id)]);
 return null;
}
export function validateProduction(data){
 const links={item:{brand_id:'brand_list',product_type_list_id:'product_type_list',image_attachment:'attachments'},item_part:{item_id:'item',part_list_id:'part_list'},item_size_list:{item_id:'item',size_list_id:'size_list'},product_type_list:{gender_id:'gender'},stage:{stage_type_id:'stage_type'},job_worker:{contacts_id:'contacts',contact_purpose_id:'contact_purpose'},job:{item_part_id:'item_part',stage_id:'stage',item_status_list_id:'item_status_list',job_worker_id:'job_worker',verify_employee_id:'employee'},design_per_job:{job_id:'job',design_id:'design'},stage_pieces:{design_per_job_id:'design_per_job',item_size_list_id:'item_size_list'}};
 for(const [table,fields]of Object.entries(links))for(const row of data[table])for(const [key,target]of Object.entries(fields))if(row[key]&&!data[target].some(r=>r.id===row[key]))throw Error(`A linked production ${target.replaceAll('_',' ')} is missing.`);
 for(const [table,fields]of [['item_part',['item_id','part_list_id']],['item_size_list',['item_id','size_list_id']],['design_per_job',['job_id','design_id']],['stage_pieces',['design_per_job_id','item_size_list_id']]]){const seen=new Set();for(const row of data[table]){const key=fields.map(f=>row[f]).join('|');if(seen.has(key))throw Error('This production relationship already exists. Edit the existing record.');seen.add(key)}}
 for(const row of [...data.stage,...data.size_list])if(row.sort_order!=null&&(!Number.isInteger(row.sort_order)||row.sort_order<0))throw Error('Display order must be a whole non-negative number.');
 const s=productionSelectors(data);for(const p of data.stage_pieces){if(!Number.isInteger(p.pieces_received)||p.pieces_received<0)throw Error('Pieces must be whole non-negative numbers.');const link=s.get('design_per_job',p.design_per_job_id),job=s.get('job',link.job_id),size=s.get('item_size_list',p.item_size_list_id);if(s.part(job.item_part_id).item?.id!==size.item_id)throw Error('The size does not belong to this job’s item.')}
 for(const job of data.job){if(job.start_date&&job.due_date&&job.due_date<job.start_date)throw Error('Due date cannot be before the start date.');if(job.start_date&&job.complete_date&&job.complete_date<job.start_date)throw Error('Completion date cannot be before the start date.');}
 return true;
}
export function previousPieces(data,job,designId,sizeId){
 const s=productionSelectors(data),order=s.get('stage',job.stage_id)?.sort_order,prior=data.job.filter(j=>j.item_part_id===job.item_part_id&&s.get('stage',j.stage_id)?.sort_order<order).sort((a,b)=>s.get('stage',b.stage_id).sort_order-s.get('stage',a.stage_id).sort_order),previous=prior[0];if(!previous)return null;const design=data.design_per_job.find(d=>d.job_id===previous.id&&d.design_id===designId);return design?data.stage_pieces.find(p=>p.design_per_job_id===design.id&&p.item_size_list_id===sizeId)?.pieces_received??null:null;
}
export function saveJobPieces(data,jobId,designs){
 const next=structuredClone(data),job=next.job.find(j=>j.id===jobId);if(!job)throw Error('Job not found.');const old=next.design_per_job.filter(d=>d.job_id===jobId),seen=new Set();
 for(const entry of designs){if(!entry.design_id||seen.has(entry.design_id))throw Error('Choose each design only once.');seen.add(entry.design_id);let link=old.find(d=>d.design_id===entry.design_id);if(!link){link={id:crypto.randomUUID(),job_id:jobId,design_id:entry.design_id};next.design_per_job.push(link)}for(const [sizeId,value]of Object.entries(entry.pieces)){if(value==='')continue;const count=Number(value);if(!Number.isInteger(count)||count<0)throw Error('Pieces must be whole non-negative numbers.');const existing=next.stage_pieces.find(p=>p.design_per_job_id===link.id&&p.item_size_list_id===sizeId);if(existing)existing.pieces_received=count;else next.stage_pieces.push({id:crypto.randomUUID(),design_per_job_id:link.id,item_size_list_id:sizeId,pieces_received:count})}}
 validateProduction(next);return next;
}
