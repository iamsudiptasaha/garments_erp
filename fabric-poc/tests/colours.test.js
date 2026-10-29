import test from 'node:test';
import assert from 'node:assert/strict';
import {initialFabric} from '../src/fabric/domain.js';
import {upgradeColours,saveLabDip,labClosed,labRows,versionsFor} from '../src/colours/domain.js';
const input=()=>({color_map_by_brand_id:'co1',dyer_id:'dy1',date:'2026-10-29',lab_dip_status_id:'ld-at-dyer',shade_card_no:'A01',comments:'First attempt'});
test('legacy references gain unknown-status editions without fabric or mapping ID changes',()=>{const d=initialFabric();assert.ok(d.lab_dip.length);assert.ok(d.lab_dip_version.every(v=>v.lab_dip_status_id===null&&v.updated_at===null));assert.equal(labRows(d)[0].status,'Status not recorded');assert.deepEqual(upgradeColours(d),d)});
test('edition creation, redo versions and all accepted outcomes follow terminal lifecycle',()=>{
 for(const status of ['ld-approved','ld-comments','ld-swatch']){const original=initialFabric();let d=saveLabDip(original,input());const lab=d.lab_dip.at(-1);assert.equal(lab.edition,2);assert.equal(versionsFor(d,lab.id)[0].version,1);
 d=saveLabDip(d,{...input(),id:lab.id,mode:'update',lab_dip_status_id:'ld-failed'});d=saveLabDip(d,{...input(),id:lab.id,mode:'version',lab_dip_status_id:'ld-awaiting'});assert.equal(labRows(d).find(r=>r.id===lab.id).status,'Redo 2 · Awaiting buyer comments');
 d=saveLabDip(d,{...input(),id:lab.id,mode:'update',lab_dip_status_id:status});assert.ok(labClosed(d,lab.id));assert.equal(versionsFor(d,lab.id).at(-1).attached_swatch,status==='ld-swatch');assert.throws(()=>saveLabDip(d,{...input(),id:lab.id,mode:'version'}),/completed/);assert.throws(()=>saveLabDip(d,{...input(),id:lab.id,mode:'update'}),/completed/);
 const next=saveLabDip(d,input());assert.equal(next.lab_dip.at(-1).edition,3);assert.equal(versionsFor(next,next.lab_dip.at(-1).id)[0].version,1);assert.equal(original.lab_dip.length,initialFabric().lab_dip.length);
 }
});
test('lab dip rejects missing mappings, invalid dates, status and attachment references',()=>{const d=initialFabric();assert.throws(()=>saveLabDip(d,{...input(),color_map_by_brand_id:'bad'}),/mapping and dyer/);assert.throws(()=>saveLabDip(d,{...input(),date:''}),/date/);assert.throws(()=>saveLabDip(d,{...input(),lab_dip_status_id:'bad'}),/status/);assert.throws(()=>saveLabDip(d,{...input(),shade_card_image_attachment:'bad'}),/attachment/)});
