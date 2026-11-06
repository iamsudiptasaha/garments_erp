import {contactReleaseSchema} from './contact-primary-contract.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inspectBoundaries,sqlFunctions,checkBoundaries} from './coherence-boundaries.mjs';
import {employeeLinks} from '../fabric-poc/src/hr/model.js';
import {contactSections} from '../fabric-poc/src/miscellaneous/contact-model.js';
const json=p=>JSON.parse(readFileSync(new URL('../'+p,import.meta.url),'utf8'));
const schema=contactReleaseSchema(json('database/schema/live-schema.json')),catalogue=json('database/catalogue/screen-table-map.json'),policy=json('database/contracts/ownership.json');
const sql=readFileSync(new URL('../supabase/migrations/20261031191218_employee_hr_workspace.sql',import.meta.url),'utf8');
const fixture=()=>({schema,catalogue,policy,functions:sqlFunctions(sql)});
test('reviewed ownership and backend contracts pass',()=>assert.match(checkBoundaries(),/passed/));
test('contact child fields cannot become mandatory when their DB columns are nullable',()=>{
 const f=fixture();f.sections=structuredClone(contactSections);f.sections[0].fields.find(x=>x.key==='name').required=true;assert.ok(inspectBoundaries(f).some(e=>e.includes('input nullability differs from DB')));
});
test('contact child collections stay optional and linked to their parent',()=>{
 const f=fixture();f.sections=structuredClone(contactSections);f.sections[0].optional=false;assert.ok(inspectBoundaries(f).some(e=>e.includes('unreviewed child ownership')));
 f.sections[0].optional=true;f.sections[0].foreign='employee_id';assert.ok(inspectBoundaries(f).some(e=>e.includes('must link to the contact root')));
});
test('rejects the former Employee-owned bank editor even when all columns exist',()=>{
 const f=fixture();f.relations={employee:[],contact_bank_account:['account_number']};assert.ok(inspectBoundaries(f).some(e=>e.includes('not an owned write table')));
});
test('rejects writable linked-table grants',()=>{
 const f=fixture();f.catalogue=structuredClone(catalogue);f.catalogue.mappings.push({resource_key:'employees',table_name:'contacts',can_edit:true});assert.ok(inspectBoundaries(f).some(e=>e.includes('forbidden writable mapping')));
});
test('rejects wrong selector sources despite existing columns',()=>{
 const f=fixture();f.links=employeeLinks.map(l=>l.key==='contacts_id'?{...l,source:'employee'}:l);assert.ok(inspectBoundaries(f).some(e=>e.includes('wrong relation')));
});
test('rejects backend writes to linked Contacts, including called helper functions',()=>{
 const f=fixture();const name=policy.screens.employees.saveFunction;f.functions.set(name,f.functions.get(name)+'; perform garments_access.bad_helper();');f.functions.set('garments_access.bad_helper','update garments_erp.contacts set company_name=$1');assert.ok(inspectBoundaries(f).some(e=>e.includes('writes linked table contacts')));
});
test('rejects backend writable fields absent from the UI contract',()=>{
 const f=fixture();const name=policy.screens.employees.saveFunction;f.functions.set(name,f.functions.get(name).replace("array['contacts_id'","array['invented_field','contacts_id'"));assert.ok(inspectBoundaries(f).some(e=>e.includes('backend writable fields differ')));
});

test('contact primary migration cannot lose its database uniqueness guarantee',()=>{
 const migration=readFileSync(new URL('../supabase/migrations/20261031201306_contact_primary_selections.sql',import.meta.url),'utf8');
 assert.throws(()=>contactReleaseSchema(json('database/schema/live-schema.json'),migration.replace('create unique index contact_items_one_primary_phone','create index contact_items_one_primary_phone')),/unique-index contract/);
});

test('Production setup fields cannot drift from the reviewed backend contract',()=>{
 const f=fixture();const migration=readFileSync(new URL('../supabase/migrations/20261106054224_connect_production_workspace.sql',import.meta.url),'utf8');
 const functions=sqlFunctions(migration);f.functions.set('garments_access.production_setup_contract',functions.get('garments_access.production_setup_contract').replace('"batch_number"','"invented_field"'));
 assert.ok(inspectBoundaries(f).some(e=>e.includes('Production: backend writable contract differs')));
});
