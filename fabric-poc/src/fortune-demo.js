import React from 'react';
import {createRoot} from 'react-dom/client';
import {Workbook} from '@fortune-sheet/react';
import '@fortune-sheet/react/dist/index.css';
import './fortune-demo.css';
import {formattedReport} from './fabric/report.js';
import {defaultState,columns,orderedRecords,buildSheet,capturePresentation,hasDataChanges,saveRecord,csvFor} from './fortune-state.js';
import {validate} from './model.js';
const STORE='garments-fortune-protected-v1';
let state=defaultState(),storageReady=true;
try{const saved=JSON.parse(localStorage.getItem(STORE)||'null');if(saved?.version===1&&!validate(saved.data))state={...state,...saved}}catch{storageReady=false}
const rootElement=document.getElementById('fortune-root'),root=createRoot(rootElement),ref=React.createRef();
let generation=0,selectedId=null,restoring=false;
const $=id=>document.getElementById(id);
function notify(message,error=false){$('sheet-status').textContent=message;$('sheet-status').classList.toggle('error',error)}
function persist(){try{localStorage.setItem(STORE,JSON.stringify(state));storageReady=true;$('save-state').textContent='Saved on this browser'}catch{storageReady=false;$('save-state').textContent='Storage unavailable — changes are temporary'}}
function syncPresentation(){const sheet=ref.current?.getSheet();if(sheet&&!hasDataChanges(sheet,state))state=capturePresentation(sheet,state)}
function render(){
 generation++;const gen=generation;selectedId=null;$('edit-record').disabled=true;$('selection-label').textContent='Select a record to edit';
 root.render(React.createElement(Workbook,{
 key:generation,ref,lang:'en',showFormulaBar:false,showSheetTabs:false,
 toolbarItems:['undo','redo','|','font-size','bold','italic','underline','|','font-color','background','border','|','horizontal-align','text-wrap','|','freeze'],
 cellContextMenu:['copy','|','set-row-height','set-column-width'],headerContextMenu:['copy','|','set-row-height','set-column-width'],
 data:[buildSheet(state)],
 hooks:{beforeUpdateCell:()=>{notify('Data is protected. Use Edit record to change a value.');return false},beforePaste:()=>{notify('Paste is disabled. Use Add record or Edit record.');return false},beforeAddSheet:()=>false,beforeDeleteSheet:()=>false,
 afterSelectionChange:(_id,s)=>{const records=orderedRecords(state);const single=s.row[0]===s.row[1]&&s.row[0]>0;selectedId=single?records[s.row[0]-1]?.id:null;$('edit-record').disabled=!selectedId;$('selection-label').textContent=selectedId?`Selected: ${records.find(r=>r.id===selectedId).bill} · ${records.find(r=>r.id===selectedId).fabricName}`:'Select one record to edit'}},
 onChange:sheets=>{
  if(gen!==generation||restoring)return;const sheet=sheets[0];if(!sheet)return;
  if(hasDataChanges(sheet,state)){restoring=true;notify('Data change blocked. Use Add record or Edit record.',true);queueMicrotask(()=>{restoring=false;render()});return}
  state=capturePresentation(sheet,state);persist();
 }
 }));
 $('sort-field').value=state.sort.key;$('sort-direction').value=state.sort.direction;
 $('record-count').textContent=`${state.data.knitting.length} records`;
}
// App-level input policy. Keep FortuneSheet's native formatting and navigation.
// Hooks and authoritative reconciliation backstop document-level shortcuts/drag mutations.
function isSheetTarget(target){return target instanceof Element&&!!target.closest('.fortune-sheet-overlay,.luckysheet-rich-text-editor,.luckysheet-cell-input')}
rootElement.addEventListener('dblclick',e=>{if(isSheetTarget(e.target)){e.preventDefault();e.stopPropagation();notify('Data is protected. Select the row, then click Edit record.')}},true);
for(const event of ['paste','cut','beforeinput','drop'])rootElement.addEventListener(event,e=>{if(isSheetTarget(e.target)){e.preventDefault();e.stopPropagation();notify('Direct data changes are disabled. Use the record buttons.')}},true);
rootElement.addEventListener('keydown',e=>{
 if(!isSheetTarget(e.target))return;
 const modifier=e.ctrlKey||e.metaKey;const key=e.key.toLowerCase();
 if(['backspace','delete','f2','enter'].includes(key)||(!modifier&&!e.altKey&&e.key.length===1)||(modifier&&['v','x','d','r'].includes(key))){e.preventDefault();e.stopPropagation();notify('Data is protected. Use Add record or Edit record.')}
},true);
function openForm(id){
 syncPresentation();const row=state.data.knitting.find(r=>r.id===id);$('record-form').reset();$('form-error').textContent='';$('record-form').dataset.id=id||'';
 $('form-title').textContent=row?'Edit knitting record':'Add knitting record';
 const yarn=$('field-yarnId');yarn.replaceChildren(...state.data.yarn.map(y=>new Option(`${y.bill} · ${y.type} · ${y.quantity} kg`,y.id)));
 for(const key of ['bill','date','knitter','yarnId','fabric','gsm','consumption','quantity','rolls','rate'])if(row)$(`field-${key}`).value=row[key];
 if(!row){$('field-date').value=new Date().toISOString().slice(0,10);$('field-fabric').value='Sinker'}
 updateName();$('record-dialog').showModal();
}
function updateName(){const yarn=state.data.yarn.find(y=>y.id===$('field-yarnId').value);$('derived-name').textContent=`Fabric name: ${yarn?.count||'—'} ${$('field-fabric').value||'—'} (automatic)`}
$('field-yarnId').addEventListener('change',updateName);$('field-fabric').addEventListener('input',updateName);
$('add-record').onclick=()=>openForm(null);$('edit-record').onclick=()=>{if(selectedId)openForm(selectedId)};
$('cancel-record').onclick=()=>$('record-dialog').close();
$('record-form').onsubmit=e=>{
 e.preventDefault();const input=Object.fromEntries(new FormData(e.target));for(const k of ['gsm','consumption','quantity','rolls','rate'])input[k]=Number(input[k]);
 try{syncPresentation();state=saveRecord(state,input,e.target.dataset.id||null);persist();render();$('record-dialog').close();notify('Record saved. Linked stock checks passed.')}catch(error){$('form-error').textContent=error.message}
};
function sortRows(){syncPresentation();state.sort={key:$('sort-field').value,direction:$('sort-direction').value};persist();render();notify('Sorted complete records. Cell formatting follows each record.')}
$('sort-field').replaceChildren(...columns.map(c=>new Option(c.label,c.key)));$('sort-field').onchange=sortRows;$('sort-direction').onchange=sortRows;
$('export-csv').onclick=()=>{const blob=new Blob(['\uFEFF'+csvFor(state)],{type:'text/csv;charset=utf-8;'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='knitting-bills.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('CSV exported with the current row order. CSV does not contain colours or fonts.')};
function preparePrint(){
 syncPresentation();
 try{$('print-table').innerHTML=formattedReport(ref.current,columns,state.data.knitting.length)}catch(error){notify(error.message,true);return false}
 $('print-meta').textContent=`${state.data.knitting.length} records · sorted by ${columns.find(c=>c.key===state.sort.key)?.label} · ${state.sort.direction==='asc'?'ascending':'descending'}`;return true;
}
$('preview-print').onclick=()=>{if(preparePrint())$('print-dialog').showModal()};$('close-print').onclick=()=>$('print-dialog').close();$('print-now').onclick=()=>{if(preparePrint())window.print()};
window.addEventListener('beforeprint',preparePrint);
render();$('save-state').textContent=storageReady?'Browser-local saving enabled':'Storage unavailable — changes are temporary';
notify('Protected sheet: format cells freely. Add or change data with the record buttons.');
