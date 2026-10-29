import test from 'node:test';
import assert from 'node:assert/strict';
import {initialFabric,validateFabric,fabricRows,fabricTotals,documentFor,saveDocument,saveSupplier,upgradeFabric,optionsFor,batchesForMapping} from '../src/fabric/domain.js';
import {buildSheet,capturePresentation,hasDataChanges} from '../src/fortune-state.js';
import {pages} from '../src/fabric/catalog.js';
test('fabric seed satisfies schema-shaped relationships and reconciles balances',()=>{const data=initialFabric();assert.equal(validateFabric(data),true);assert.deepEqual(fabricTotals(data),{yarnLeft:880,greigeLeft:196,dyed:663,batches:4});assert.equal(fabricRows(data,'knitting').filter(r=>r.documentId==='kb1').length,2)});
test('one header is saved with many lines atomically and edits retain line identities',()=>{
 const data=initialFabric(),draft=documentFor(data,'knitting','kb1');draft.header.invoice_number='KB-026-EDIT';draft.header.knitter_id='kn2';draft.lines[0].consumption=520;
 const next=saveDocument(data,'knitting',draft),rows=fabricRows(next,'knitting').filter(r=>r.documentId==='kb1');
 assert.equal(next.knitting_bill.length,2);assert.equal(rows.length,2);assert.ok(rows.every(r=>r.bill==='KB-026-EDIT'&&r.supplier==='Metro Knitting'));assert.deepEqual(draft.lines.map(l=>l.id),['ki1','ki2']);assert.equal(fabricTotals(next).yarnLeft,860);assert.equal(data.knitting_bill[0].invoice_number,'KB-026');
 const failed=structuredClone(draft);failed.lines[1].consumption=600;assert.throws(()=>saveDocument(data,'knitting',failed),/exceeds the yarn available/);assert.equal(data.knitting_bill_item[0].consumption,500);
});
test('new multi-line knitting bill creates one parent and prevents duplicate invoice parents',()=>{
 const data=initialFabric(),line={yarn_bill_item_id:'ybi2',fabric_type_id:'ft1',greige_gsm:180,billed_rate:12,consumption:50,billed_quantity:48,billed_rolls:2};
 const draft={header:{invoice_number:'KB-030',invoice_date:'2026-10-27',knitter_id:'kn1'},lines:[line,{...line,fabric_type_id:'ft2',consumption:20,billed_quantity:19}]};
 const next=saveDocument(data,'knitting',draft),parent=next.knitting_bill.find(b=>b.invoice_number==='KB-030');assert.equal(next.knitting_bill.length,3);assert.equal(next.knitting_bill_item.filter(l=>l.knitting_bill_id===parent.id).length,2);assert.equal(fabricTotals(next).yarnLeft,810);assert.throws(()=>saveDocument(next,'knitting',draft),/already exists/);
});
test('removing a consumed source or stealing line identities fails without partial writes',()=>{const data=initialFabric(),draft=documentFor(data,'knitting','kb1');draft.lines=draft.lines.slice(1);assert.throws(()=>saveDocument(data,'knitting',draft),/linked knitting bill item is missing/);draft.lines[0].id='ki3';assert.throws(()=>saveDocument(data,'knitting',draft),/moved from another document/)});
test('colour sections preserve comments per line and one program header',()=>{
 const data=initialFabric(),draft=documentFor(data,'programs','dp1');draft.lines.filter(l=>l.color_map_by_brand_id==='co1').forEach(l=>l.comments='Revised navy instructions');const next=saveDocument(data,'programs',draft);assert.equal(next.dyeing_program.length,2);assert.equal(next.dyeing_program_item.filter(l=>l.comments==='Revised navy instructions').length,2);
});
test('batch trace joins the full chain and bill view excludes final-price column',()=>{const data=initialFabric(),row=fabricRows(data,'batches').find(r=>r.batch==='B-104');assert.deepEqual([row.yarnBill,row.knitBill,row.program,row.bill,row.color],['YB-014','KB-026','DP-031','DF-031','Navy']);assert.equal(row.wastage,4);assert.equal(fabricRows(data,'dyed').find(r=>r.batch==='B-104').price,298.48);assert.equal(pages.dyeBills.columns.some(c=>c.key==='price'),false)});
test('greige report has one row per bill and fabric and comma-separated dyers',()=>{const rows=fabricRows(initialFabric(),'greige');assert.equal(rows.length,3);const sinker=rows.find(r=>r.bill==='KB-026'&&r.name==='30S Sinker');assert.equal(sinker.left,85);assert.equal(sinker.dyers,'River Dyeing, City Processors')});
test('shared sheet adapter protects new page values and preserves hidden-row styles',()=>{const data=initialFabric(),rows=fabricRows(data,'yarnLeft'),state={records:rows,columns:pages.yarnLeft.columns,styles:{hidden:{name:{bl:1}}},layout:{},page:'yarnLeft',title:'Yarn left',sort:{key:'left',direction:'desc'}};const sheet=buildSheet(state);assert.equal(hasDataChanges(sheet,state),false);const next=capturePresentation(sheet,state);assert.equal(next.styles.hidden.name.bl,1);sheet.celldata.find(c=>c.r===1&&c.c===6).v.v=100000;assert.equal(hasDataChanges(sheet,state),true)});
test('suppliers add to the correct role and contact collection',()=>{const data=initialFabric(),next=saveSupplier(data,{name:'New Knitter',kind:'knitter'});assert.equal(next.knitter.length,3);assert.equal(data.knitter.length,2);assert.ok(fabricRows(next,'suppliers').some(s=>s.name==='New Knitter'&&s.kind==='Knitter'))});
test('supplier editing keeps its role identity and duplicate creation is rejected',()=>{const data=initialFabric();const next=saveSupplier(data,{id:'knitter:kn1',kind:'knitter',name:'Sri Knits Updated'});assert.equal(next.knitter.length,2);assert.equal(fabricRows(next,'knitting').find(r=>r.id==='ki1').supplier,'Sri Knits Updated');assert.throws(()=>saveSupplier(data,{kind:'knitter',name:'Sri Knits'}),/already has/)});

test('colour library and brand mappings keep approval metadata on lab dips',()=>{
 const data=initialFabric();const colour=saveDocument(data,'colours',{header:{name:'Coral',pantone_code:'16-1546'},lines:[]});
 const coral=colour.color_map.find(c=>c.name==='Coral');
 const mapped=saveDocument(colour,'colourMappings',{header:{color_map_id:coral.id,brand_list_id:'br1'},lines:[]});
 const mapping=mapped.color_map_by_brand.find(m=>m.color_map_id===coral.id);assert.equal(mapping.dyer_id,undefined);assert.ok(optionsFor(mapped,'colors','dy1').some(([id])=>id===mapping.id));
 assert.equal(fabricRows(mapped,'colours').find(c=>c.id===coral.id).mappings,1);
 assert.throws(()=>saveDocument(mapped,'colourMappings',{header:{color_map_id:coral.id,brand_list_id:'br1'}}),/already exists/);
});
test('colour rename propagates to programs and batch trace without changing mapping identity',()=>{
 const data=initialFabric();const next=saveDocument(data,'colours',{header:{...data.color_map[0],name:'Deep Navy'},lines:[]});
 assert.equal(fabricRows(next,'batches').find(r=>r.batch==='B-104').color,'Deep Navy');assert.equal(next.dyeing_program_item[0].color_map_by_brand_id,'co1');
 assert.throws(()=>saveDocument(data,'colourMappings',{header:{color_map_id:'missing',brand_list_id:'br1'},lines:[]}),/linked color map is missing/);
});
test('legacy local colours upgrade preserves all existing document and mapping IDs',()=>{
 const data=initialFabric();delete data.color_map;delete data.brand_list;data.color_map_by_brand=[{id:'co1',name:'Navy',brand:'Core'},{id:'co2',name:'Sage',brand:'Core'}];
 const next=upgradeFabric(data);assert.deepEqual(next.dyeing_program_item,data.dyeing_program_item);assert.deepEqual(next.knitting_bill,data.knitting_bill);assert.equal(validateFabric(next),true);assert.equal(fabricRows(next,'batches')[0].color,'Navy');assert.equal(next.brand_list.length,1);assert.equal(next.color_map.length,2);
});

test('batch choices follow exact colour mapping IDs, not shared colour names',()=>{
 const data=initialFabric();assert.deepEqual(batchesForMapping(data,'co1'),['B-104','B-106']);assert.deepEqual(batchesForMapping(data,'co2'),['B-105','B-109']);assert.deepEqual(batchesForMapping(data,''),[]);
 data.brand_list.push({id:'br2',brand:'Another brand'});data.color_map_by_brand.push({id:'co3',color_map_id:'cm1',brand_list_id:'br2',dyer_id:null});
 assert.deepEqual(batchesForMapping(data,'co3'),[]);data.dyeing_program_item.find(r=>r.id==='di2').color_map_by_brand_id='co3';
 assert.deepEqual(batchesForMapping(data,'co1'),['B-104']);assert.deepEqual(batchesForMapping(data,'co3'),['B-106']);
});
test('program save requires mapping, permits null batch and rejects a batch from another mapping',()=>{
 const data=initialFabric(),draft=documentFor(data,'programs','dp1');draft.lines[0].batch_no='B-104';draft.lines[1].batch_no=null;
 const saved=saveDocument(data,'programs',draft);assert.equal(saved.dyeing_program_item.find(l=>l.id==='di1').batch_no,'B-104');assert.equal(saved.dyeing_program_item.find(l=>l.id==='di2').batch_no,null);
 draft.lines[0].batch_no='B-105';assert.throws(()=>saveDocument(data,'programs',draft),/does not belong to this colour mapping/);
 draft.lines[0].batch_no=null;draft.lines[0].color_map_by_brand_id='';assert.throws(()=>saveDocument(data,'programs',draft),/Colour mapping is required/);
});
test('colour master and mapping forms do not expose obsolete swatch or shade fields',()=>{
 assert.deepEqual(pages.colourMappings.header.map(f=>f.key),['color_map_id','brand_list_id']);
 assert.ok(!pages.colours.header.some(f=>f.key==='attached_swatch'));
 assert.ok(!pages.colourMappings.columns.some(c=>c.key==='swatch'));
});

test('colour mapping labels display colour before brand consistently',()=>{
 const data=initialFabric();assert.equal(optionsFor(data,'colors').find(([id])=>id==='co1')[1],'Navy / Core');
 assert.equal(fabricRows(data,'programs').find(row=>row.id==='di1').mapping,'Navy / Core');
});

test('reference edits preserve IDs and propagate to linked choices and derived fabrics',()=>{
 const data=initialFabric();
 const next=saveDocument(data,'yarnTypes',{header:{id:'yt1',name:'32S Shivam CCH',yarn_count:'32S'}});
 assert.equal(fabricRows(next,'knitting').find(r=>r.id==='ki1').name,'32S Sinker');
 assert.equal(optionsFor(next,'yarnTypes').find(([id])=>id==='yt1')[1],'32S Shivam CCH');
 assert.equal(data.yarn_type[0].yarn_count,'30S');
 const renamed=saveDocument(next,'brands',{header:{id:'br1',brand:'Essential'}});
 assert.match(optionsFor(renamed,'colors')[0][1],/Navy \/ Essential/);
 assert.equal(fabricRows(renamed,'brands')[0].mappings,2);
 const fabric=saveDocument(renamed,'fabricTypes',{header:{id:'ft1',name:'Single jersey'}});
 assert.equal(fabricRows(fabric,'batches')[0].name,'32S Single jersey');
 assert.equal(fabricRows(fabric,'fabricTypes').find(r=>r.id==='ft1').knitting,2);
});
test('reference masters reject duplicate names, missing counts and stale edit identities',()=>{
 const data=initialFabric();
 assert.throws(()=>saveDocument(data,'fabricTypes',{header:{name:' sinker '}}),/already exists/);
 assert.throws(()=>saveDocument(data,'yarnTypes',{header:{name:'New yarn',yarn_count:''}}),/Yarn count is required/);
 assert.throws(()=>saveDocument(data,'brands',{header:{id:'deleted',brand:'New'}}),/no longer exists/);
 const next=saveDocument(data,'brands',{header:{brand:'Summer'}});
 assert.equal(next.brand_list.length,2);assert.equal(data.brand_list.length,1);
 assert.ok(optionsFor(next,'brands').some(([,name])=>name==='Summer'));
});
