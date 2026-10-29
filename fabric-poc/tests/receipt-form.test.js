import test from 'node:test';
import assert from 'node:assert/strict';
import {initialFabric} from '../src/fabric/domain.js';
import {pages} from '../src/fabric/catalog.js';
import {receiptFields,switchReceiptMode,updateReceipt} from '../src/inventory/receipts.js';
test('receipt path switches clear dependent values and item choices are scoped to the order',()=>{
 const data=initialFabric(),old=data.raw_material_check_in[0];const cleared=switchReceiptMode(old,'fabric');for(const key of ['purchase_order_id','raw_material_item_id','dyed_fabric_item_id','raw_material_supplier_list_id'])assert.equal(cleared[key],null);
 const fields=receiptFields(pages.materialReceipts,data,'order',old).header;assert.deepEqual(fields.find(f=>f.key==='raw_material_supplier_list_id').options.map(([id])=>id),['ms1']);assert.equal(fields.find(f=>f.key==='raw_material_item_id').options.map(([id])=>id).join(','),'mat1,mat2');
 const changed=updateReceipt(data,old,'purchase_order_id','mp2');assert.equal(changed.raw_material_item_id,null);assert.equal(changed.raw_material_supplier_list_id,null);
 const selected=updateReceipt(data,old,'raw_material_item_id','mat2');assert.equal(selected.raw_material_item_id,'mat2');
 const fabricFields=receiptFields(pages.materialReceipts,data,'fabric',cleared).header;assert.ok(fabricFields.some(f=>f.key==='dyed_fabric_item_id'));assert.ok(!fabricFields.some(f=>['purchase_order_id','raw_material_supplier_list_id','raw_material_item_id'].includes(f.key)));
});
