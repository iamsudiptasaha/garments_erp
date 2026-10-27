import {normaliseReceipt} from './receipts.js';
export function initialInventory(){return {
 category_list:[{id:'cat-trim',type:'Raw material',name:'Trims',description:'',type_abbr:'TR',series:1}],
 unit_of_measure:[{id:'u-piece',unit:'pieces',description:'Individual pieces'},{id:'u-metre',unit:'metres',description:'Length'},{id:'u-kg',unit:'kg',description:'Weight'}],
 contact_purpose:[{id:'purpose-material',type:'Raw material supplier'}],transporter:[],
 raw_material_supplier_list:[{id:'ms1',contacts_id:'s7',contact_purpose_id:'purpose-material',preferred_transport_id:null}],
 raw_material_item:[{id:'mat1',name:'Navy button 18L',category_list_id:'cat-trim',unit_of_measure_id:'u-piece',raw_material_supplier_list_id:'ms1',description:'Four-hole button'},{id:'mat2',name:'Care label',category_list_id:'cat-trim',unit_of_measure_id:'u-piece',raw_material_supplier_list_id:'ms1',description:'Printed care label'}],
 raw_material_purchase_order:[{id:'mp1',purchase_order_number:'MPO-001',raw_material_supplier_list_id:'ms1',employee_id:'owner'}],
 raw_material_purchase_order_item:[{id:'mpl1',raw_material_purchase_order_id:'mp1',raw_material_item_id:'mat1',quantity:2000,price:1.5,description:''},{id:'mpl2',raw_material_purchase_order_id:'mp1',raw_material_item_id:'mat2',quantity:1000,price:0.8,description:''}],
 raw_material_check_in:[{id:'mi1',sku:'TRIM-001',date:'2026-10-27',raw_material_item_id:'mat1',dyed_fabric_item_id:null,quantity:1500,price:1.5,purchase_order_id:'mp1',raw_material_purchase_order_item_id:'mpl1',invoice_number:'MAT-001',raw_material_supplier_list_id:'ms1',verified_by_employee_id:'owner',bill_attachment:null}],
 raw_material_check_out:[{id:'mo1',raw_material_check_in_id:'mi1',date:'2026-10-27',quantity:200,reconciliation:false,issue_by_employee_id:'owner',employee_id:'sample-production',item_part_id:null,check_out_type_id:'issue-production',remarks:'Issued to production'}],
 check_out_type:[{id:'issue-production',name:'Production assigned',remarks:'Materials issued for production'},{id:'issue-reconcile',name:'Stock reconciliation',remarks:'Close remaining stock after physical reconciliation'}],
 employee:[{id:'owner',name:'Workspace owner',employeeCode:'ADMIN-001'},{id:'sample-production',name:'Production preview',employeeCode:'DEMO-003'}],item:[],item_part:[],part_list:[]
}}
export function upgradeInventory(data){
 const next=data.raw_material_check_in?{...data}:{...initialInventory(),...data,contacts:data.contacts.some(c=>c.id==='s7')?data.contacts:[...data.contacts,{id:'s7',company_name:'Trim House'}]};
 next.check_out_type=next.check_out_type.map(r=>r.id==='issue-production'&&r.name==='Production issue'?{...r,name:'Production assigned'}:r);
 next.raw_material_check_in=next.raw_material_check_in.map(r=>{if(r.dyed_fabric_item_id)return {...r,purchase_order_id:null,raw_material_purchase_order_item_id:null,raw_material_supplier_list_id:null};if(r.raw_material_purchase_order_item_id)return r;const lines=next.raw_material_purchase_order_item.filter(l=>l.raw_material_purchase_order_id===r.purchase_order_id&&l.raw_material_item_id===r.raw_material_item_id);return {...r,raw_material_purchase_order_item_id:lines.length===1?lines[0].id:null}});
 return next;
}
function lookups(data,s){
 const get=(table,id)=>data[table]?.find(r=>r.id===id);
 const supplier=id=>{const row=get('raw_material_supplier_list',id);return get('contacts',row?.contacts_id)?.company_name||'—'};
 const employee=id=>get('employee',id)?.name||'—';
 const part=id=>{const p=get('item_part',id);return p?[get('item',p.item_id)?.style_code,get('part_list',p.part_list_id)?.part].filter(Boolean).join(' / '):'—'};
 const receipt=r=>{const m=get('raw_material_item',r.raw_material_item_id),fabric=get('dyed_fabric_item',r.dyed_fabric_item_id);return {name:m?.name||(fabric?s.dyed(fabric).k.name:'—'),batch:fabric?.batch_no||'—',unit:m?get('unit_of_measure',m.unit_of_measure_id)?.unit:'kg',category:m?get('category_list',m.category_list_id)?.name:'Dyed fabric'}};
 return {get,supplier,employee,part,receipt};
}
export function inventoryRows(data,page,s){
 const {get,supplier,employee,part,receipt}=lookups(data,s);
 const identity=r=>({id:r.id,documentId:r.id});
 const receipts=()=>data.raw_material_check_in.map(r=>{const issued=data.raw_material_check_out.filter(o=>o.raw_material_check_in_id===r.id).reduce((n,o)=>n+o.quantity,0);return {...identity(r),...receipt(r),sku:r.sku||`Receipt ${r.id}`,date:r.date,quantity:r.quantity,price:r.price??'—',supplier:supplier(r.raw_material_supplier_list_id),order:get('raw_material_purchase_order',r.purchase_order_id)?.purchase_order_number||'—',invoice:r.invoice_number||'—',employee:employee(r.verified_by_employee_id),attachment:r.bill_attachment??'—',received:r.quantity,issued,left:r.quantity-issued}});
 const issues=()=>data.raw_material_check_out.map(r=>{const source=get('raw_material_check_in',r.raw_material_check_in_id);return {...identity(r),...receipt(source),sku:source.sku||`Receipt ${source.id}`,date:r.date,quantity:r.quantity,type:r.reconciliation?'Reconciliation':get('check_out_type',r.check_out_type_id)?.name||'—',part:part(r.item_part_id),recipient:employee(r.employee_id),issuer:employee(r.issue_by_employee_id),reconciliation:r.reconciliation?'Marked reconciled':'Not reconciled',remarks:r.remarks||'—'}});
 if(page==='materials')return data.raw_material_item.map(r=>({...identity(r),name:r.name,category:get('category_list',r.category_list_id)?.name,unit:get('unit_of_measure',r.unit_of_measure_id)?.unit,supplier:supplier(r.raw_material_supplier_list_id),description:r.description||'—'}));
 if(page==='materialSuppliers')return data.raw_material_supplier_list.map(r=>({...identity(r),name:supplier(r.id),purpose:get('contact_purpose',r.contact_purpose_id)?.type,transport:get('transporter',r.preferred_transport_id)?.name||'—',orders:data.raw_material_purchase_order.filter(p=>p.raw_material_supplier_list_id===r.id).length}));
 if(page==='materialOrders')return data.raw_material_purchase_order_item.map(r=>{const header=get('raw_material_purchase_order',r.raw_material_purchase_order_id),m=get('raw_material_item',r.raw_material_item_id),received=data.raw_material_check_in.filter(i=>i.raw_material_purchase_order_item_id?i.raw_material_purchase_order_item_id===r.id:i.purchase_order_id===header.id&&i.raw_material_item_id===m.id).reduce((n,i)=>n+i.quantity,0),ordered=data.raw_material_purchase_order_item.filter(l=>l.raw_material_purchase_order_id===header.id&&l.raw_material_item_id===m.id).reduce((n,l)=>n+l.quantity,0);return {id:r.id,documentId:header.id,bill:header.purchase_order_number,supplier:supplier(header.raw_material_supplier_list_id),name:m.name,unit:get('unit_of_measure',m.unit_of_measure_id)?.unit,quantity:r.quantity,price:r.price,received,pending:Math.max(ordered-received,0),excess:Math.max(received-ordered,0),description:r.description||'—'}});
 if(['materialStock','materialReceipts'].includes(page))return receipts();
 if(page==='materialIssues')return issues();
 if(page==='materialMovements')return [...receipts().map(r=>({...r,id:'in:'+r.id,direction:'Received',party:r.supplier,part:'—',reference:r.invoice,remarks:'—'})),...issues().map(r=>({...r,id:'out:'+r.id,direction:'Issued',party:r.recipient,reference:r.type}))].sort((a,b)=>String(b.date).localeCompare(String(a.date)));
 if(page==='materialCategories')return data.category_list.map(r=>({...identity(r),name:r.name,type:r.type||'—',description:r.description||'—',abbreviation:r.type_abbr||'—',series:r.series??'—'}));
 if(page==='materialUnits')return data.unit_of_measure.map(r=>({...identity(r),name:r.unit,description:r.description||'—'}));
 if(page==='materialIssueTypes')return data.check_out_type.map(r=>({...identity(r),name:r.name,remarks:r.remarks||'—'}));
 return [];
}
export function inventoryOptions(data,source,s){
 const {supplier,employee,part,receipt}=lookups(data,s);
 const mappings={materials:['raw_material_item','name'],materialCategories:['category_list','name'],materialUnits:['unit_of_measure','unit'],materialOrders:['raw_material_purchase_order','purchase_order_number'],issueTypes:['check_out_type','name'],contacts:['contacts','company_name'],contactPurposes:['contact_purpose','type'],transports:['transporter','name']};
 if(mappings[source]){const [table,label]=mappings[source];return data[table].map(r=>[r.id,r[label]])}
 if(source==='materialSuppliers')return data.raw_material_supplier_list.map(r=>[r.id,supplier(r.id)]);
 if(source==='employees')return data.employee.map(r=>[r.id,`${r.employeeCode||r.id} · ${employee(r.id)}`]);
 if(source==='itemParts')return data.item_part.map(r=>[r.id,part(r.id)]);
 if(source==='dyedBatches')return data.dyed_fabric_item.map(r=>[r.id,`${r.batch_no} · ${s.dyed(r).k.name} · ${s.dyed(r).color.name}`]);
 if(source==='stockReceipts')return data.raw_material_check_in.map(r=>{const issued=data.raw_material_check_out.filter(o=>o.raw_material_check_in_id===r.id).reduce((n,o)=>n+o.quantity,0),details=receipt(r);return [r.id,`${r.sku||r.id} · ${details.name} · ${r.quantity-issued} ${details.unit} available`]});
 return null;
}
export function validateInventory(data){
 const exists=(table,id)=>data[table].some(r=>r.id===id);
 const link=(row,key,table,required=false)=>{if(row[key]==null||row[key]===''){if(required)throw Error(`Choose ${key.replaceAll('_',' ')}.`);return}if(!exists(table,row[key]))throw Error(`The linked ${table.replaceAll('_',' ')} is missing.`)};
 const number=(value,label,positive=false)=>{if(typeof value!=='number'||!Number.isFinite(value)||(positive?value<=0:value<0))throw Error(`${label} must be a ${positive?'positive':'non-negative'} number.`)};
 for(const r of data.raw_material_supplier_list){link(r,'contacts_id','contacts',true);link(r,'contact_purpose_id','contact_purpose',true);link(r,'preferred_transport_id','transporter')}
 for(const r of data.raw_material_item){link(r,'category_list_id','category_list',true);link(r,'unit_of_measure_id','unit_of_measure',true);link(r,'raw_material_supplier_list_id','raw_material_supplier_list')}
 for(const r of data.raw_material_purchase_order){link(r,'raw_material_supplier_list_id','raw_material_supplier_list',true);link(r,'employee_id','employee')}
 const categoryKeys=new Set();for(const r of data.category_list){const key=(r.type||'')+'|'+r.name.trim().toLowerCase();if(categoryKeys.has(key))throw Error('This category already exists for the selected type.');categoryKeys.add(key)}
 const pairs=new Set();for(const r of data.raw_material_purchase_order_item){link(r,'raw_material_purchase_order_id','raw_material_purchase_order',true);link(r,'raw_material_item_id','raw_material_item',true);number(r.quantity,'Ordered quantity',true);number(r.price,'Price');const key=r.raw_material_purchase_order_id+'|'+r.raw_material_item_id;if(pairs.has(key))throw Error('Combine repeated materials into one purchase order line so receipts can be matched clearly.');pairs.add(key)}
 const skus=new Set();for(const r of data.raw_material_check_in){if(Boolean(r.raw_material_item_id)===Boolean(r.dyed_fabric_item_id))throw Error('Choose exactly one material or dyed-fabric batch.');link(r,'raw_material_item_id','raw_material_item');link(r,'dyed_fabric_item_id','dyed_fabric_item');link(r,'purchase_order_id','raw_material_purchase_order');link(r,'raw_material_supplier_list_id','raw_material_supplier_list');link(r,'verified_by_employee_id','employee');number(r.quantity,'Received quantity',true);if(r.price!=null)number(r.price,'Price');if(r.sku){if(skus.has(r.sku.toLowerCase()))throw Error('This SKU already exists. Use a unique receipt SKU.');skus.add(r.sku.toLowerCase())}
  if(r.raw_material_purchase_order_item_id){link(r,'raw_material_purchase_order_item_id','raw_material_purchase_order_item');const line=data.raw_material_purchase_order_item.find(l=>l.id===r.raw_material_purchase_order_item_id);if(line.raw_material_purchase_order_id!==r.purchase_order_id||line.raw_material_item_id!==r.raw_material_item_id)throw Error('Receipt order item does not match its purchase order and material.');}
  if(r.purchase_order_id){const po=data.raw_material_purchase_order.find(p=>p.id===r.purchase_order_id);if(!data.raw_material_purchase_order_item.some(l=>l.raw_material_purchase_order_id===po.id&&l.raw_material_item_id===r.raw_material_item_id))throw Error('The material is not on the selected purchase order.');if(r.raw_material_supplier_list_id&&r.raw_material_supplier_list_id!==po.raw_material_supplier_list_id)throw Error('Receipt supplier must match the purchase order supplier.')}
 }
 for(const r of data.raw_material_check_out){link(r,'raw_material_check_in_id','raw_material_check_in',true);link(r,'item_part_id','item_part');link(r,'check_out_type_id','check_out_type');if(!r.reconciliation&&!r.check_out_type_id)throw Error('Choose an issue type.');link(r,'employee_id','employee');link(r,'issue_by_employee_id','employee');number(r.quantity,'Issued quantity',true)}
 for(const r of data.raw_material_check_in){const issued=data.raw_material_check_out.filter(o=>o.raw_material_check_in_id===r.id).reduce((n,o)=>n+o.quantity,0);if(issued>r.quantity+1e-8)throw Error('Issued quantity exceeds the stock available on its source receipt.')}
 for(const fabric of data.dyed_fabric_item){const received=data.raw_material_check_in.filter(r=>r.dyed_fabric_item_id===fabric.id).reduce((n,r)=>n+r.quantity,0);if(received>fabric.final_quantity+1e-8)throw Error('Stock receipts exceed the final quantity of the dyed-fabric batch.')}
 return true;
}
// One receipt retains the unit and source identity used by all its issues.
export function prepareInventoryEdit(data,page,header,draft){
 if(page==='materialIssues'){const old=data.raw_material_check_out.find(r=>r.id===header.id);if(old?.reconciliation)throw Error('Reconciliation entries are retained as closing records and cannot be edited.');header.reconciliation=false;
  if(draft.reconciliation){if(old)throw Error('Create a new reconciliation entry.');const receipt=data.raw_material_check_in.find(r=>r.id===header.raw_material_check_in_id);if(!receipt)throw Error('Choose a valid receipt.');const issued=data.raw_material_check_out.filter(r=>r.raw_material_check_in_id===receipt.id).reduce((n,r)=>n+r.quantity,0),left=receipt.quantity-issued;if(left<=0)throw Error('This stock is already closed.');if(header.quantity!==left)throw Error('Stock changed. Reopen reconciliation to use the remaining quantity.');if(!header.remarks||!header.issue_by_employee_id)throw Error('Enter a reason and the employee recording this reconciliation.');header.reconciliation=true;}
 }
 if(page==='materialReceipts'){normaliseReceipt(data,header);const old=data.raw_material_check_in.find(r=>r.id===header.id);if(old&&data.raw_material_check_out.some(r=>r.raw_material_check_in_id===old.id)&&['raw_material_item_id','dyed_fabric_item_id'].some(k=>(old[k]||null)!==(header[k]||null)))throw Error('A receipt with issues cannot change its material or fabric source.')}
 if(page==='materials'){const old=data.raw_material_item.find(r=>r.id===header.id);if(old&&old.unit_of_measure_id!==header.unit_of_measure_id&&(data.raw_material_check_in.some(r=>r.raw_material_item_id===old.id)||data.raw_material_purchase_order_item.some(r=>r.raw_material_item_id===old.id)))throw Error('This material already has quantities recorded. Keep its unit or create a separate material.')}
}
