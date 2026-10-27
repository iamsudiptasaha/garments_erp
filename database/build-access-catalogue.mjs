import {writeFileSync} from 'node:fs';
import {pages} from '../fabric-poc/src/fabric/catalog.js';
const fabricChain=['contacts','yarn_supplier','yarn_type','yarn_purchase_order','yarn_purchase_order_item','yarn_bill','yarn_bill_item','knitter','fabric_type','knitting_bill','knitting_bill_item'];
const dyeChain=[...fabricChain,'dyer','dyeing_program','dyeing_program_item','color_map','color_map_by_brand','brand_list','dyed_fabric_bill','dyed_fabric_item'];
const stockChain=['raw_material_check_in','raw_material_check_out','raw_material_item','category_list','unit_of_measure','raw_material_supplier_list','contacts','raw_material_purchase_order','raw_material_purchase_order_item',...dyeChain];
const definitions={
 productionItems:{write:['item'],read:['brand_list','product_type_list','attachments','item_part','job']},
 productionJobs:{write:['job','design_per_job','stage_pieces'],read:['item','item_part','part_list','stage','stage_type','item_status_list','job_worker','contacts','employee','design','item_size_list','size_list','challan_job_item','challan_job_item_pieces']},
 productionWorkers:{write:['job_worker'],read:['contacts','contact_purpose','job']},
 productionParts:{write:['item_part'],read:['item','part_list','job']},
 productionItemSizes:{write:['item_size_list'],read:['item','size_list']},
 productionDesigns:{write:['design']},productionStages:{write:['stage'],read:['stage_type']},
 productionStageTypes:{write:['stage_type']},productionPartTypes:{write:['part_list']},productionSizes:{write:['size_list']},
 productionProductTypes:{write:['product_type_list'],read:['gender']},productionStatuses:{write:['item_status_list']},
 yarnTypes:{write:['yarn_type'],read:['yarn_purchase_order_item']},fabricTypes:{write:['fabric_type'],read:['knitting_bill_item','dyeing_program_item']},brands:{write:['brand_list'],read:['color_map_by_brand']},
 colours:{write:['color_map'],read:['color_map_by_brand']},colourMappings:{write:['color_map_by_brand'],read:['color_map','brand_list','dyer','contacts']},
 suppliers:{write:['contacts','yarn_supplier','knitter','dyer'],read:['contact_purpose','yarn_purchase_order','knitting_bill','dyeing_program']},
 orders:{write:['yarn_purchase_order','yarn_purchase_order_item'],read:['yarn_supplier','contacts','yarn_type','yarn_bill_item']},
 yarn:{write:['yarn_bill','yarn_bill_item'],read:['yarn_purchase_order','yarn_purchase_order_item','yarn_supplier','contacts','yarn_type','knitting_bill_item']},
 knitting:{write:['knitting_bill','knitting_bill_item'],read:[...fabricChain,'dyed_fabric_item','fabric_status_list','view_knitted_fabric_name']},
 programs:{write:['dyeing_program','dyeing_program_item'],read:['dyer','contacts','fabric_type','color_map','color_map_by_brand','brand_list','dyed_fabric_item']},
 dyeBills:{write:['dyed_fabric_bill','dyed_fabric_item'],read:dyeChain},
 dyed:{report:dyeChain},yarnLeft:{report:fabricChain},greige:{report:dyeChain},batches:{report:dyeChain},
 materials:{write:['raw_material_item'],read:['category_list','unit_of_measure','raw_material_supplier_list','contacts','raw_material_purchase_order_item','raw_material_check_in']},
 materialSuppliers:{write:['raw_material_supplier_list'],read:['contacts','contact_purpose','transporter','raw_material_purchase_order']},
 materialOrders:{write:['raw_material_purchase_order','raw_material_purchase_order_item'],read:['raw_material_supplier_list','contacts','raw_material_item','unit_of_measure','employee','raw_material_check_in']},
 materialReceipts:{write:['raw_material_check_in'],read:[...stockChain,'employee','attachments']},
 materialIssues:{write:['raw_material_check_out'],read:[...stockChain,'employee','check_out_type','item','item_part','part_list']},
 materialStock:{report:stockChain},materialMovements:{report:[...stockChain,'employee','check_out_type','item','item_part','part_list']},
 materialContacts:{write:['contacts'],read:['contact_items','contact_extra']},contactPeople:{write:['contact_items'],read:['contacts']},contactDetails:{write:['contact_extra'],read:['contacts']},contactBankAccounts:{write:['contact_bank_account'],read:['contacts','bank_account_type','attachments']},contactCategories:{write:['contact_purpose']},bankAccountTypes:{write:['bank_account_type']},materialCategories:{write:['category_list']},materialUnits:{write:['unit_of_measure']},materialIssueTypes:{write:['check_out_type']},
 employees:{write:['employee','contacts'],read:['contact_purpose','gender','blood_group','type_of_employment','attachments']},
 adminAccess:{write:['garments_access.app_user','garments_access.app_user_role'],read:['employee','contacts','garments_access.app_role']},
 adminRoles:{write:['garments_access.app_role','garments_access.app_role_resource_permission'],read:['garments_access.app_resource','garments_access.app_resource_table','garments_access.app_db_table','garments_access.app_user','garments_access.app_user_role']},
 adminAudit:{report:['garments_access.app_activity_log','garments_access.app_user','employee','contacts','garments_access.app_resource']}
};
for(const key of Object.keys(pages))if(!definitions[key])throw Error(`Missing reviewed table mapping for ${key}`);
const sections=[['fabric','Fabric'],['colours','Colours'],['production','Production'],['inventory','Raw Material Inventory'],['miscellaneous','Miscellaneous'],['hr','Employee / HR'],['admin','Administration']];
const resources=sections.map(([key,name],sort_order)=>({key:'section:'+key,name,resource_type:'section',parent:null,route:null,sort_order,admin_only:key==='admin'}));
const plannedMisc={materialContacts:'Contacts',contactPeople:'Contact people',contactDetails:'Contact details',contactBankAccounts:'Bank accounts',contactCategories:'Contact categories',bankAccountTypes:'Bank account types'};
const currentPages={...pages,yarnTypes:{...pages.yarnTypes,section:undefined},fabricTypes:{...pages.fabricTypes,section:undefined},brands:{...pages.brands,section:'production'},...Object.fromEntries(Object.entries(plannedMisc).map(([key,title])=>[key,{...pages[key],title,section:'miscellaneous'}]))};
const screenEntries=[...Object.entries(currentPages).filter(([key])=>definitions[key]),['employees',{title:'Employees',section:'hr'}],['adminAccess',{title:'Account permissions',section:'admin'}],['adminRoles',{title:'Roles & permissions',section:'admin'}],['adminAudit',{title:'Activity log',section:'admin'}]];
for(const [key,p] of screenEntries)resources.push({key,name:p.title,resource_type:'screen',parent:'section:'+(p.section||'fabric'),route:'/fabric.html#'+(key==='adminAccess'?'adminRoles':key),sort_order:resources.length,admin_only:p.section==='admin'});
const mappings=[];for(const [key]of screenEntries){const def=definitions[key],seen=new Set();for(const [kind,tables] of [['write',def.write||[]],['read',def.read||[]],['report',def.report||[]]])for(const [i,t]of tables.entries()){if(seen.has(t))continue;seen.add(t);const [schema_name,table_name]=t.includes('.')?t.split('.'):['garments_erp',t];mappings.push({resource_key:key,schema_name,table_name,relation_type:kind==='write'?(i===0?'primary':'detail'):kind==='report'?'report_source':'lookup',can_view:true,can_create:kind==='write',can_edit:kind==='write',can_delete:false});}}
const tables=[...new Map(mappings.map(m=>[m.schema_name+'.'+m.table_name,{schema_name:m.schema_name,table_name:m.table_name}])).values()];
const catalogue={resources,tables,mappings};
writeFileSync(new URL('./catalogue/screen-table-map.json',import.meta.url),JSON.stringify(catalogue,null,2)+'\n');
const literal=v=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb";
const sql=`-- Configuration seed only: no users, roles, policy grants or business data changes.\nbegin;\n`+
`do $validate$ begin\n if exists (select 1 from jsonb_to_recordset(${literal(tables)}) as t(schema_name text,table_name text) where to_regclass(format('%I.%I',t.schema_name,t.table_name)) is null) then raise exception 'Catalogue references a missing database relation'; end if;\nend $validate$;\n`+
`insert into garments_access.app_resource(key,name,resource_type,route,sort_order,admin_only)\nselect key,name,resource_type,route,sort_order,admin_only from jsonb_to_recordset(${literal(resources)}) as r(key text,name text,resource_type text,route text,sort_order integer,admin_only boolean)\non conflict (key) do update set name=excluded.name,route=excluded.route,sort_order=excluded.sort_order,admin_only=excluded.admin_only;\n`+
`update garments_access.app_resource child set parent_resource_id=parent.id from jsonb_to_recordset(${literal(resources)}) as r(key text,parent text),garments_access.app_resource parent where child.key=r.key and parent.key=r.parent;\n`+
`update garments_access.app_resource set is_active=false where key='section:reference';\n`+
`delete from garments_access.app_resource old where old.key='section:reference' and not exists(select 1 from garments_access.app_resource child where child.parent_resource_id=old.id) and not exists(select 1 from garments_access.app_role_resource_permission p where p.app_resource_id=old.id) and not exists(select 1 from garments_access.app_resource_table m where m.app_resource_id=old.id);\n`+
`insert into garments_access.app_db_table(schema_name,table_name) select schema_name,table_name from jsonb_to_recordset(${literal(tables)}) as t(schema_name text,table_name text) on conflict(schema_name,table_name) do nothing;\n`+
`delete from garments_access.app_resource_table m using garments_access.app_resource r,garments_access.app_db_table t where m.app_resource_id=r.id and m.app_db_table_id=t.id and r.key='materialContacts' and t.schema_name='garments_erp' and t.table_name='contact_bank_account';\n`+
`insert into garments_access.app_resource_table(app_resource_id,app_db_table_id,relation_type,can_view,can_create,can_edit,can_delete)\nselect r.id,t.id,m.relation_type,m.can_view,m.can_create,m.can_edit,m.can_delete from jsonb_to_recordset(${literal(mappings)}) as m(resource_key text,schema_name text,table_name text,relation_type text,can_view boolean,can_create boolean,can_edit boolean,can_delete boolean) join garments_access.app_resource r on r.key=m.resource_key join garments_access.app_db_table t on t.schema_name=m.schema_name and t.table_name=m.table_name\non conflict(app_resource_id,app_db_table_id) do update set relation_type=excluded.relation_type,can_view=excluded.can_view,can_create=excluded.can_create,can_edit=excluded.can_edit,can_delete=excluded.can_delete;\ncommit;\n`;
writeFileSync(new URL('./catalogue/register-screen-table-mappings.sql',import.meta.url),sql);
console.log(JSON.stringify({sections:sections.length,screens:screenEntries.length,tables:tables.length,mappings:mappings.length}));
