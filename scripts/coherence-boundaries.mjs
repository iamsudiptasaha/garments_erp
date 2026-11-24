import {contactReleaseSchema} from './contact-primary-contract.mjs';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {employeeLinks,employeeFields,employeeRelations} from '../fabric-poc/src/hr/model.js';
import {productionContract} from '../fabric-poc/src/production-task-board/live-contract.js';
import {fabricContract} from '../fabric-poc/src/fabric/live-contract.js';
import {contactSections} from '../fabric-poc/src/miscellaneous/contact-model.js';
const root=fileURLToPath(new URL('../',import.meta.url));
export function sqlFunctions(sql){
 const functions=new Map();
 const pattern=/create\s+(?:or\s+replace\s+)?function\s+([\w.]+)\s*\([\s\S]*?\bas\s+(\$\w*\$)([\s\S]*?)\2\s*;/gi;
 for(const m of sql.matchAll(pattern))functions.set(m[1].toLowerCase(),m[3]);
 return functions;
}
export function inspectBoundaries({schema,catalogue,policy,functions,links=employeeLinks,fields=employeeFields,relations=employeeRelations,sections=contactSections}){
 const errors=[];
 for (const [screen, contract] of Object.entries(policy.readOnlyScreens || {})) {
  if (!functions.has(contract.readFunction)) errors.push(`${screen}: missing read function ${contract.readFunction}`);
  for (const mapping of catalogue.mappings.filter(m => m.resource_key === screen)) {
   if (mapping.can_create || mapping.can_edit) errors.push(`${screen}: read-only screen cannot write ${mapping.table_name}`);
   if (!contract.referenceTables.includes(mapping.table_name)) errors.push(`${screen}: unreviewed read mapping to ${mapping.table_name}`);
  }
 }
 const documents = policy.productionDocuments;
 if (documents) {
  const read = functions.get(documents.readFunction);
  const save = functions.get(documents.saveFunction);
  const writes = code => [...(code || '').matchAll(/\b(?:insert\s+into|update|delete\s+from)\s+garments_erp\.(\w+)/gi)].map(match => match[1]);
  const hasResources = code => documents.resources.every(resource => code?.includes("'" + resource + "'"));
  if (!hasResources(read) || !read.includes("has_screen_permission(resource,'view')") || writes(read).length)
   errors.push('Production documents: unreviewed read boundary');
  if (!hasResources(save) || !save.includes('has_screen_permission(resource,p_action)') || /\bexecute\b/i.test(save) ||
      writes(save).some(table => !documents.writableTables.includes(table)))
   errors.push('Production documents: unreviewed write boundary');
 }
 const finished = policy.finishedGoodsCatalogue;
 if (finished) {
  const read = functions.get(finished.readFunction);
  const save = functions.get(finished.saveFunction);
  const permission = action => `garments_access.has_screen_permission('${finished.permissionScreen}', '${action}')`;
  const writes = code => [...(code || '').matchAll(/\b(?:insert\s+into|update|delete\s+from)\s+garments_erp\.(\w+)/gi)].map(match => match[1]);
  if (!read?.includes(permission('view')) || writes(read).length) errors.push('Finished Goods: catalogue read boundary differs from its reviewed contract');
  if (!save?.includes(permission('create')) || /\bexecute\b/i.test(save) ||
      writes(save).some(table => !finished.writableTables.includes(table))) {
   errors.push('Finished Goods: catalogue write boundary differs from its reviewed contract');
  }
 }
 const purpose = policy.contactPurpose;
 if (purpose) {
  const read = functions.get(purpose.readFunction);
  const save = functions.get(purpose.saveFunction);
  const permission = action => `has_screen_permission('${purpose.permissionScreen}', ${action})`;
  const writes = code => [...(code || '').matchAll(/\b(insert\s+into|update|delete\s+from)\s+(?:garments_erp|garments_access|public)\.(\w+)/gi)];
  const mapping = catalogue.mappings.filter(entry => entry.resource_key === purpose.permissionScreen);
  if (!read?.includes(permission("'view'")) || writes(read).length)
   errors.push('Contact Purpose: unreviewed read boundary');
  if (!save?.includes(permission("'view'")) ||
      !save.includes(permission("case when p_id is null then 'create' else 'edit' end")) ||
      /\bexecute\b/i.test(save) || writes(save).length !== 2 ||
      writes(save).some(([, action, table]) => /delete/i.test(action) || table !== purpose.writableTable) ||
      mapping.length !== 1 || mapping[0].table_name !== purpose.writableTable || mapping[0].can_delete)
   errors.push('Contact Purpose: unreviewed write boundary');
 }
 for (const [name, contract] of Object.entries(policy.billingPortal || {})) {
  const entry = functions.get(name);
  if (!entry?.includes(`garments_erp.billing_employee('${contract.permissionScreen}')`))
   errors.push(`${name}: Billing page guard differs from its reviewed contract`);
  const visited = new Set();
  const check = routine => {
   if (visited.has(routine)) return;
   visited.add(routine);
   const body = functions.get(routine);
   if (!body) return;
   if (/\bexecute\b/i.test(body)) errors.push(`${name}: ${routine} uses dynamic SQL`);
   for (const [, table] of body.matchAll(/\b(?:insert\s+into|update|delete\s+from)\s+(?:garments_erp|garments_access)\.(\w+)/gi))
    if (!contract.writableTables.includes(table)) errors.push(`${name}: unreviewed write to ${table}`);
   for (const [, called] of body.matchAll(/\b((?:garments_erp|garments_access|public)\.\w+)\s*\(/g))
    check(called);
  };
  check(name);
 }
 for(const [screen,c]of Object.entries(policy.screens)){
  for(const table of Object.keys(relations))if(!c.writableTables.includes(table))errors.push(`${screen}: ${table} is linked data, not an owned write table`);
  for(const m of catalogue.mappings.filter(m=>m.resource_key===screen&&(m.can_create||m.can_edit)))if(![...c.writableTables,...c.maintenanceTables].includes(m.table_name))errors.push(`${screen}: forbidden writable mapping to ${m.table_name}`);
  for(const link of links){
   if(c.links[link.key]!==link.source)errors.push(`${screen}: ${link.key} selector targets the wrong relation`);
   if(!schema.foreign_keys.some(f=>f.schema==='garments_erp'&&f.table===c.root&&f.definition.includes(`FOREIGN KEY (${link.key}) REFERENCES garments_erp.${link.source}(id)`)))errors.push(`${screen}: ${link.key} has no matching database foreign key`);
  }
  for(const key of Object.keys(c.links))if(!links.some(l=>l.key===key))errors.push(`${screen}: missing link selector ${key}`);
  const body=functions.get(c.saveFunction);
  if(!body){errors.push(`${screen}: missing save function ${c.saveFunction}`);continue;}
  if(/\bexecute\b/i.test(body))errors.push(`${screen}: dynamic SQL needs a separately reviewed write boundary`);
  const visited=new Set();
  function check(name){
   if(visited.has(name))return;visited.add(name);const code=functions.get(name);if(!code)return;
   if(/\bexecute\b/i.test(code)&&!['garments_access.employee_snapshot','garments_access.fabric_json'].includes(name))errors.push(`${screen}: ${name} uses dynamic SQL without a reviewed boundary`);
   for(const m of code.matchAll(/\b(?:insert\s+into|update|delete\s+from)\s+"?garments_erp"?\s*\.\s*"?(\w+)"?/gi))if(!c.writableTables.includes(m[1].toLowerCase()))errors.push(`${screen}: ${name} writes linked table ${m[1]}`);
   for(const m of code.matchAll(/\b(garments_access\.\w+)\s*\(/g))check(m[1]);
  }
  check(c.saveFunction);
  const allowed=body.match(/jsonb_object_keys\(d->'employee'\)[\s\S]*?array\[([^\]]+)\]/i);
  const backend=allowed?Array.from(allowed[1].matchAll(/'([^']+)'/g),m=>m[1]).sort():[];
  const frontend=[...links.map(l=>l.key),...fields.map(([key])=>key)].sort();
  if(JSON.stringify(backend)!==JSON.stringify(frontend))errors.push(`${screen}: UI fields and backend writable fields differ`);
 }
 for(const [table,owner]of Object.entries(policy.ownership))if(!catalogue.mappings.some(m=>m.resource_key===owner&&m.table_name===table&&m.relation_type==='primary'))errors.push(`${table}: declared owner ${owner} has no primary mapping`);
 for(const [screen,contract]of Object.entries(policy.aggregates||{})){
  if(contract.mode==='local-preview'&&Object.hasOwn(fabricContract,screen))errors.push(`${screen}: live saving requires a reviewed database command, not a preview adapter`);
  if(contract.mode==='live-command'){
   const body=functions.get(contract.saveFunction);
   if(!body)errors.push(`${screen}: missing save function ${contract.saveFunction}`);
   else{
    const writable=[contract.root,...contract.children.map(child=>child.table)];
    if(/\bexecute\b/i.test(body))errors.push(`${screen}: aggregate writes must name their tables explicitly`);
    for(const match of body.matchAll(/\b(?:insert\s+into|update|delete\s+from)\s+garments_erp\.(\w+)/gi))
     if(!writable.includes(match[1]))errors.push(`${screen}: aggregate writes outside its ownership to ${match[1]}`);
    if(/\bsupporting_documents\s*=|insert\s+into\s+garments_erp\.contact_bank_account\s*\([^)]*\bsupporting_documents\b/i.test(body))
     errors.push(`${screen}: supporting documents must be written through Files`);
   }
  }
  for(const section of sections){
   const expected=contract.children.find(c=>c.table===section.table);
   if(!expected||expected.resource!==section.resource||expected.foreign!==section.foreign||expected.optional!==section.optional)errors.push(`${screen}: unreviewed child ownership for ${section.table}`);
   if(!schema.foreign_keys.some(f=>f.schema==='garments_erp'&&f.table===section.table&&f.definition.includes(`FOREIGN KEY (${section.foreign}) REFERENCES garments_erp.${contract.root}(id)`)))errors.push(`${screen}: ${section.table} must link to the contact root`);
   for(const field of section.fields){
    const column=schema.columns.find(c=>c.table_schema==='garments_erp'&&c.table_name===section.table&&c.column_name===field.key);
    if(!column)errors.push(`${screen}: missing child field ${section.table}.${field.key}`);
    else if((field.required!==false)!==(column.is_nullable==='NO'&&!column.column_default))errors.push(`${screen}: ${section.table}.${field.key} input nullability differs from DB`);
    if(field.type==='select'){
     const target=contract.selectorSources?.[field.source];
     if(!target||!schema.foreign_keys.some(f=>f.schema==='garments_erp'&&f.table===section.table&&f.definition.includes(`FOREIGN KEY (${field.key}) REFERENCES garments_erp.${target}(id)`)))errors.push(`${screen}: ${section.table}.${field.key} selector does not match its database FK`);
    }
   }
  }
  for(const child of contract.children)if(!sections.some(s=>s.table===child.table))errors.push(`${screen}: missing section ${child.table}`);
 }
 const fabric=functions.get('garments_erp.fabric_contract')??functions.get('garments_access.fabric_contract');
 if(fabric){const literal=fabric.match(/select\s+'((?:[^']|'')*)'::jsonb/i);if(!literal)errors.push('Fabric: SQL contract is not inspectable');else if(JSON.stringify(JSON.parse(literal[1].replaceAll("''","'")))!==JSON.stringify(fabricContract))errors.push('Fabric: backend writable contract differs from UI contract');}
 const production=functions.get('garments_erp.production_setup_contract')??functions.get('garments_access.production_setup_contract');
 if(production){const literal=production.match(/select\s+'((?:[^']|'')*)'::jsonb/i);if(!literal)errors.push('Production: SQL contract is not inspectable');else if(JSON.stringify(JSON.parse(literal[1].replaceAll("''","'")))!==JSON.stringify(productionContract))errors.push('Production: backend writable contract differs from UI contract');}
 return [...new Set(errors)];
}
export function checkBoundaries(){
 const json=path=>JSON.parse(readFileSync(resolve(root,path),'utf8'));
 const files=['database/ci/baseline.sql',...readdirSync(resolve(root,'supabase/migrations')).filter(f=>f.endsWith('.sql')).sort().map(f=>'supabase/migrations/'+f)];
 const functions=new Map();for(const file of files)for(const [name,body]of sqlFunctions(readFileSync(resolve(root,file),'utf8')))functions.set(name,body);
 const policy=json('database/contracts/ownership.json');
 const receiptCategory=policy.reviewedReceiptCategory;
 const receiptCatalog='fabric-poc/src/inventory/catalog.js';
 const receiptField="      select('material_category_id', 'Material category', 'materialCategories', false),\n";
 const receiptSource=readFileSync(resolve(root,receiptCatalog),'utf8');
 const receiptLayout='          { ...byKey.material_category_id, disabled: locked },\n';
 const receiptLayoutPath='fabric-poc/src/inventory/receipts.js';
 const receiptSql=functions.get(receiptCategory?.command);
 const receiptAdapter=readFileSync(resolve(root,'fabric-poc/src/fabric/inventory-live.js'),'utf8');
 const receiptReviewed=receiptCategory?.owner==='materialReceipts' &&
  receiptCategory.column==='material_category_id' && receiptCategory.selector==='materialCategories' &&
  receiptCategory.references==='garments_erp.category_list(id)' && receiptCategory.nullable===true && receiptSource.split(receiptField).length===2 &&
  readFileSync(resolve(root,receiptLayoutPath),'utf8').split(receiptLayout).length===2 &&
  receiptSql?.includes("'verified_by_employee_id','material_category_id'") &&
  receiptSql.includes('receipt.verified_by_employee_id, receipt.material_category_id') &&
  receiptSql.includes("material_category_id = case when p_values ? 'material_category_id'") &&
  receiptAdapter.includes("material_category_id: 'material_category_id'");
 const checkout=policy.reviewedCheckoutStage;
 const checkoutField="      select('stage_id', 'Stage', 'checkoutStages', false),\n";
 const checkoutOptions="    checkoutStages: ['stage', 'name'],\n";
 const checkoutReviewed=checkout?.owner==='materialIssues' && checkout.column==='stage_id' &&
  checkout.selector==='checkoutStages' && checkout.references==='garments_erp.stage(id)' &&
  checkout.nullable===true && receiptSource.split(checkoutField).length===2 &&
  readFileSync(resolve(root,'fabric-poc/src/inventory/domain.js'),'utf8').split(checkoutOptions).length===2 && receiptSql?.includes("'remarks','reconciliation','stage_id'") &&
  receiptSql.includes('issue.reconciliation, issue.stage_id') &&
  receiptSql.includes("stage_id = case when p_values ? 'stage_id'") &&
  receiptAdapter.includes("'stage_id',") &&
  functions.get('garments_erp.raw_material_transaction_snapshot')?.includes("if can_issue then tables := tables || array['stage'];");
 const transferable=policy.transferableInventory;
 if(!transferable || transferable.root!=='raw_material_check_in' || transferable.history!=='transferable_item_movement' ||
  transferable.foreignKeys?.item_id!=='item' || transferable.foreignKeys?.job_worker_id!=='job_worker' ||
  !functions.get(transferable.saveFunction)?.includes("has_screen_permission('transferableMaterials','create')") ||
  !functions.get('garments_erp.guard_transferable_movement')?.includes('garments_erp.transferable_actions(') ||
  !functions.get(transferable.readFunction)?.includes("'transferable_receipt_state',garments_erp.transferable_receipt_projection()"))
   throw Error('Transferable Materials: receipt ownership, linked records or guarded command differs');
 const errors=inspectBoundaries({schema:contactReleaseSchema(json('database/schema/live-schema.json')),catalogue:json('database/catalogue/screen-table-map.json'),policy,functions});
 if(!checkoutReviewed)errors.push('Stock outward: stage selector and transaction write contract differ');
 if(!receiptReviewed)errors.push('Stock receipts: category selector and transaction write contract differ');
 for(const [folder,baseline]of Object.entries(policy.unreviewedModules||{})){
  const current=readdirSync(resolve(root,folder),{recursive:true,withFileTypes:true}).filter(e=>e.isFile()).map(e=>resolve(e.parentPath,e.name));
  const paths=new Set(current.map(p=>p.slice(root.length)));
  for(const file of Object.keys(baseline))paths.add(file);
  for(const file of paths){let hash;try{let content=readFileSync(resolve(root,file),'utf8');
   // Preserve the frozen baseline for every byte outside this reviewed selector.
   if(file===receiptCatalog&&receiptReviewed&&content.split(receiptField).length===2)
    content=content.replace(receiptField,'');
   if(receiptReviewed&&file===receiptLayoutPath)content=content.replace(receiptLayout,'');
   if(checkoutReviewed&&file===receiptCatalog&&content.split(checkoutField).length===2)
    content=content.replace(checkoutField,'');
   if(checkoutReviewed&&file==='fabric-poc/src/inventory/domain.js'&&content.split(checkoutOptions).length===2)
    content=content.replace(checkoutOptions,'');
   hash=createHash('sha256').update(content).digest('hex');}catch{hash=null;}
   if(hash!==baseline[file] && !(policy.reviewedLocalItemEditionRemoval?.authoritativeTable==='item_part_fabric' && policy.reviewedLocalItemEditionRemoval?.authoritativeColumn==='lab_dip_id' && hash===policy.reviewedLocalItemEditionRemoval?.files?.[file]))errors.push(`${file}: this module needs an ownership review before further changes; do not refresh its baseline to bypass review`);
  }
 }
 if(errors.length)throw Error('DB/UI coherence blocked:\n'+errors.join('\n'));
 return 'DB/UI ownership, foreign-key selectors and backend field contracts passed';
}
if(process.argv[1]===fileURLToPath(import.meta.url)){try{console.log(checkBoundaries());}catch(e){console.error(e.message);process.exitCode=1;}}
