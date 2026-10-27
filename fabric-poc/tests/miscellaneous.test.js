import test from 'node:test';
import assert from 'node:assert/strict';
import {initialFabric,upgradeFabric,validateFabric,saveDocument,fabricRows,optionsFor,documentFor} from '../src/fabric/domain.js';
import {initialAccess,allowed} from '../src/admin/model.js';
import {pages} from '../src/fabric/catalog.js';
test('central Contacts retains its old key and updates suppliers without replacing other contact fields',()=>{
 const data=initialFabric();data.contacts.find(r=>r.id==='s1').gst='DEMO-GST';const draft=documentFor(data,'materialContacts','s1');draft.header.company_name='Shivam Yarns Updated';draft.header.search_term='Shivam';const next=saveDocument(data,'materialContacts',draft);
 assert.equal(next.contacts.length,data.contacts.length);assert.equal(next.contacts.find(r=>r.id==='s1').gst,'DEMO-GST');assert.equal(fabricRows(next,'yarn')[0].supplier,'Shivam Yarns Updated');assert.equal(optionsFor(next,'contacts').find(([id])=>id==='s1')[1],'Shivam Yarns Updated');assert.equal(pages.materialContacts.section,'miscellaneous');
});
test('contact people and extra details reference one shared company and retain phone strings',()=>{
 const data=initialFabric(),people=saveDocument(data,'contactPeople',{header:{contact_id:'s1',name:'Preview person',phone:'+91 00000 00000',address:'Sample office'}});
 const next=saveDocument(people,'contactDetails',{header:{contact_id:'s1',key:'Delivery instruction',value:'Use office entrance'}});const row=fabricRows(next,'materialContacts').find(r=>r.id==='s1');assert.equal(row.people,1);assert.equal(row.details,1);assert.equal(fabricRows(next,'contactPeople')[0].phone,'+91 00000 00000');assert.equal(fabricRows(next,'contactDetails')[0].company,'Shivam Yarns');assert.throws(()=>saveDocument(next,'contactDetails',{header:{contact_id:'s1',key:' delivery instruction ',value:'Duplicate'}}),/already exists/);
 assert.throws(()=>saveDocument(data,'contactPeople',{header:{contact_id:'missing',name:'Person',phone:'',address:''}}),/existing company/);assert.equal(data.contact_items.length,0);
});
test('bank records preserve leading zeros and stay outside the general Contacts projection',()=>{
 const data=initialFabric(),draft={header:{contact_id:'s1',account_holder_name:'Preview company',name:'Sample bank',account_number:'0000123400',branch:'Sample branch',ifsc_code:'',bank_account_type_id:'bank-type-current',address:'',supporting_documents:''}};
 const next=saveDocument(data,'contactBankAccounts',draft),row=fabricRows(next,'contactBankAccounts')[0];assert.equal(row.number,'0000123400');assert.equal(row.type,'Current');assert.equal(next.contact_bank_account[0].bank_account_type_id,'bank-type-current');assert.equal(next.contact_bank_account[0].supporting_documents,null);assert.ok(!Object.hasOwn(fabricRows(next,'materialContacts')[0],'accounts'));assert.ok(!pages.materialContacts.columns.some(c=>c.key==='accounts'));assert.throws(()=>saveDocument(next,'contactBankAccounts',draft),/account number already exists/);assert.throws(()=>saveDocument(data,'contactBankAccounts',{header:{...draft.header,bank_account_type_id:'missing'}}),/account type no longer exists/);assert.equal(data.contact_bank_account.length,0);
});
test('contact categories and account types update shared choices and reject duplicate names',()=>{
 const data=initialFabric(),next=saveDocument(data,'contactCategories',{header:{type:'Preview buyer'}});assert.ok(optionsFor(next,'contactPurposes').some(([,label])=>label==='Preview buyer'));assert.throws(()=>saveDocument(next,'contactCategories',{header:{type:'preview buyer'}}),/already exists/);
 const types=saveDocument(next,'bankAccountTypes',{header:{name:'Preview account type'}});assert.ok(optionsFor(types,'bankAccountTypes').some(([,label])=>label==='Preview account type'));assert.equal(validateFabric(types),true);
});
test('legacy workspace upgrade preserves contacts and linked business IDs',()=>{
 const data=initialFabric();delete data.contact_items;delete data.contact_extra;delete data.contact_bank_account;delete data.bank_account_type;delete data.attachments;const next=upgradeFabric(data);assert.equal(next.contacts[0].id,data.contacts[0].id);assert.equal(next.knitting_bill_item[0].id,'ki1');assert.equal(next.contact_items.length,0);assert.equal(validateFabric(next),true);
});
test('new Miscellaneous screens are separately permissioned without automatic Viewer or Accounts access',()=>{
 const access=initialAccess();for(const page of ['materialContacts','contactPeople','contactDetails','contactBankAccounts','contactCategories','bankAccountTypes']){assert.equal(allowed(access,'owner',page,'edit'),true);assert.equal(allowed(access,'sample-viewer',page,'view'),false);assert.equal(allowed(access,'sample-accounts',page,'view'),false)}
});
