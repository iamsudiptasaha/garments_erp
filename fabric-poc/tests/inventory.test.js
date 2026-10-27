import test from 'node:test';
import assert from 'node:assert/strict';
import {initialFabric,upgradeFabric,validateFabric,fabricRows,saveDocument,documentFor,optionsFor} from '../src/fabric/domain.js';
const receipt=(extra={})=>({header:{sku:'NEW-001',date:'2026-10-27',raw_material_item_id:'mat1',dyed_fabric_item_id:'',quantity:50,price:1.5,raw_material_supplier_list_id:'ms1',purchase_order_id:'mp1',invoice_number:'NEW-BILL',verified_by_employee_id:'owner',...extra}});
const issue=(extra={})=>({header:{raw_material_check_in_id:'mi1',date:'2026-10-27',quantity:50,check_out_type_id:'issue-production',item_part_id:'',employee_id:'sample-production',issue_by_employee_id:'owner',remarks:'Production',...extra}});
test('inventory reconciles source receipts and records unsigned movements with direction and unit',()=>{
 const data=initialFabric();assert.equal(validateFabric(data),true);const [stock]=fabricRows(data,'materialStock');assert.deepEqual([stock.received,stock.issued,stock.left,stock.unit],[1500,200,1300,'pieces']);const movement=fabricRows(data,'materialMovements');assert.equal(movement.length,2);assert.deepEqual(new Set(movement.map(r=>r.direction)),new Set(['Received','Issued']));assert.ok(movement.every(r=>r.unit==='pieces'));
});
test('receipt and issue forms preserve numeric types and update balances without mutating input',()=>{
 const data=initialFabric(),next=saveDocument(data,'materialReceipts',receipt({quantity:'100'})),r=next.raw_material_check_in.find(r=>r.sku==='NEW-001');assert.equal(r.quantity,100);assert.equal(r.dyed_fabric_item_id,null);const issued=saveDocument(next,'materialIssues',issue({raw_material_check_in_id:r.id,quantity:'25'}));assert.equal(fabricRows(issued,'materialStock').find(s=>s.id===r.id).left,75);assert.equal(data.raw_material_check_in.length,1);
});
test('receipt source is exactly one material or fabric and batches cannot be received twice beyond final quantity',()=>{
 const data=initialFabric();assert.throws(()=>saveDocument(data,'materialReceipts',receipt({dyed_fabric_item_id:'df1'})),/exactly one/);assert.throws(()=>saveDocument(data,'materialReceipts',receipt({raw_material_item_id:''})),/exactly one/);
 const fabric=saveDocument(data,'materialReceipts',receipt({raw_material_item_id:'',dyed_fabric_item_id:'df1',purchase_order_id:'',quantity:285}));const stock=fabricRows(fabric,'materialStock').find(r=>r.sku==='NEW-001');assert.equal(stock.unit,'kg');assert.equal(stock.batch,'B-104');assert.equal(stock.name,'30S Sinker');assert.throws(()=>saveDocument(fabric,'materialReceipts',receipt({sku:'NEW-002',raw_material_item_id:'',dyed_fabric_item_id:'df1',purchase_order_id:'',quantity:1})),/exceed the final quantity/);
});
test('issues cannot exceed stock; editing receipt quantity cannot invalidate existing issues',()=>{
 const data=initialFabric();assert.throws(()=>saveDocument(data,'materialIssues',issue({quantity:1301})),/exceeds the stock/);const d=documentFor(data,'materialReceipts','mi1');d.header.quantity=199;assert.throws(()=>saveDocument(data,'materialReceipts',d),/exceeds the stock/);assert.throws(()=>saveDocument(data,'materialIssues',issue({quantity:0})),/positive/);
});
test('purchase orders save many lines under one parent and match receipts by material',()=>{
 const data=initialFabric(),draft={header:{purchase_order_number:'MPO-002',raw_material_supplier_list_id:'ms1',employee_id:''},lines:[{raw_material_item_id:'mat1',quantity:100,price:1,description:''},{raw_material_item_id:'mat2',quantity:200,price:0.5,description:'Labels'}]};const next=saveDocument(data,'materialOrders',draft);const rows=fabricRows(next,'materialOrders').filter(r=>r.bill==='MPO-002');assert.equal(rows.length,2);assert.equal(new Set(rows.map(r=>r.documentId)).size,1);assert.equal(next.raw_material_purchase_order.find(p=>p.purchase_order_number==='MPO-002').employee_id,null);assert.throws(()=>saveDocument(data,'materialReceipts',receipt({raw_material_item_id:'mat2',purchase_order_id:'mp-missing'})),/linked raw material purchase order/);assert.throws(()=>saveDocument(next,'materialOrders',{...draft,header:{...draft.header,purchase_order_number:'MPO-003'},lines:[draft.lines[0],draft.lines[0]]}),/Combine repeated materials/);
});
test('reconciliation consumes the exact remaining balance, retains history and cannot silently be edited',()=>{
 const data=initialFabric(),draft=issue({quantity:1300,check_out_type_id:'',remarks:'Physical stock verified empty'});draft.reconciliation=true;const next=saveDocument(data,'materialIssues',draft);assert.equal(fabricRows(next,'materialStock')[0].left,0);assert.equal(next.raw_material_check_in[0].quantity,1500);assert.equal(next.raw_material_check_out.length,2);const closing=next.raw_material_check_out.find(r=>r.reconciliation);assert.equal(closing.quantity,1300);assert.throws(()=>saveDocument(next,'materialIssues',documentFor(next,'materialIssues',closing.id)),/cannot be edited/);assert.throws(()=>saveDocument(data,'materialIssues',{...draft,header:{...draft.header,quantity:1200}}),/Stock changed/);assert.throws(()=>saveDocument(data,'materialIssues',{...draft,header:{...draft.header,remarks:''}}),/reason/);
});
test('stock source and units cannot change after linked quantities exist',()=>{
 const data=initialFabric(),r=documentFor(data,'materialReceipts','mi1');r.header.raw_material_item_id='mat2';assert.throws(()=>saveDocument(data,'materialReceipts',r),/cannot change its material|does not match this material/);const m=documentFor(data,'materials','mat1');m.header.unit_of_measure_id='u-metre';assert.throws(()=>saveDocument(data,'materials',m),/Keep its unit/);
});
test('existing local Fabric data upgrades without losing IDs or records',()=>{
 const data=initialFabric();for(const key of ['raw_material_item','raw_material_check_in','raw_material_check_out'])delete data[key];const next=upgradeFabric(data);assert.equal(next.knitting_bill_item[0].id,'ki1');assert.equal(next.raw_material_check_in[0].id,'mi1');assert.ok(optionsFor(next,'stockReceipts')[0][1].includes('1300 pieces'));assert.equal(validateFabric(next),true);
});

test('receipt supplier and material must belong to its purchase order; SKUs are unique',()=>{
 const data=initialFabric();assert.throws(()=>saveDocument(data,'materialReceipts',receipt({sku:'trim-001'})),/SKU already exists/);
 const next=saveDocument(data,'materials',{header:{name:'Elastic tape',category_list_id:'cat-trim',unit_of_measure_id:'u-metre',raw_material_supplier_list_id:'ms1',description:''}});const elastic=next.raw_material_item.find(m=>m.name==='Elastic tape');assert.throws(()=>saveDocument(next,'materialReceipts',receipt({raw_material_item_id:elastic.id})),/not on the selected purchase order/);
});

test('order receipts resolve the exact ordered item and fabric receipts clear supplier and purchase order',()=>{
 const data=initialFabric();const next=saveDocument(data,'materialReceipts',receipt({raw_material_item_id:'',raw_material_purchase_order_item_id:'mpl2'}));const added=next.raw_material_check_in.find(r=>r.sku==='NEW-001');assert.equal(added.raw_material_item_id,'mat2');assert.equal(added.raw_material_purchase_order_item_id,'mpl2');
 const fabric=saveDocument(data,'materialReceipts',receipt({raw_material_item_id:'',dyed_fabric_item_id:'df1',raw_material_purchase_order_item_id:'mpl1',quantity:50}));const f=fabric.raw_material_check_in.find(r=>r.sku==='NEW-001');assert.equal(f.raw_material_supplier_list_id,null);assert.equal(f.purchase_order_id,null);assert.equal(f.raw_material_purchase_order_item_id,null);
 assert.throws(()=>saveDocument(data,'materialReceipts',receipt({purchase_order_id:''})),/purchase order or a fabric batch/);assert.throws(()=>saveDocument(data,'materialReceipts',receipt({raw_material_supplier_list_id:''})),/Select the supplier/);
 const auto=saveDocument(data,'materialReceipts',receipt({sku:''}));assert.match(auto.raw_material_check_in.at(-1).sku,/^RCV-\d{6}$/);
});
