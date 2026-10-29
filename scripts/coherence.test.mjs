import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspect} from './check-coherence.mjs';
const columns=[{table_schema:'garments_erp',table_name:'variant',column_name:'variant_name'}];
test('blocks UI rename when database still has old relation',()=>{
 const errors=inspect({columns:columns.map(c=>({...c,table_name:'design'}))},{tables:[]},{variants:{entity:'variant',header:[{key:'variant_name'}]}});
 assert.ok(errors.some(e=>e.includes('missing database relation garments_erp.variant')));
});
test('blocks stale field names',()=>{
 const errors=inspect({columns},{tables:[]},{variants:{entity:'variant',header:[{key:'design_name'}]}});
 assert.ok(errors.some(e=>e.includes('variant.design_name')));
});
test('accepts matching database identifiers despite a different visible label',()=>{
 assert.deepEqual(inspect({columns},{tables:[]},{variants:{title:'Variants',entity:'variant',header:[{key:'variant_name',label:'Name'}]}}),[]);
});
test('blocks master forms missing mandatory database relationships',()=>{
 const schema={columns:[{table_schema:'garments_erp',table_name:'brand_list',column_name:'brand'},{table_schema:'garments_erp',table_name:'brand_list',column_name:'contacts_id',is_nullable:'NO',column_default:null}]};
 assert.ok(inspect(schema,{tables:[]},{brands:{entity:'brand_list',header:[{key:'brand'}]}}).some(e=>e.includes('contacts_id has no form input')));
});
