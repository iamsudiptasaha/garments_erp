import React,{useMemo,useRef,useState,useEffect} from 'react';
import {Workbook} from '@fortune-sheet/react';
import '@fortune-sheet/react/dist/index.css';
import {buildSheet,capturePresentation,hasDataChanges,csvFor,orderedRecords} from '../fortune-state.js';
import {formattedReport} from './report.js';
const h=React.createElement;
export function FabricSheet({page,spec,records,preferences,onPreferences,onSelect,onNotice,capabilities}){
 const book=useRef(null),host=useRef(null),state=useRef(null),callbacks=useRef({onPreferences,onSelect,onNotice,capabilities});callbacks.current={onPreferences,onSelect,onNotice};
 const [revision,setRevision]=useState(0),[print,setPrint]=useState(null),[zoom,setZoom]=useState(preferences.layout?.zoomRatio||1);
 const printDialog=useRef(null);
 const initial=useMemo(()=>{
  state.current={page,title:spec.title,columns:spec.columns,records,styles:preferences.styles||{},layout:preferences.layout||{},sort:preferences.sort||{key:spec.columns[0].key,direction:'asc'}};
  return [buildSheet(state.current)];
 },[page,spec,records,preferences.sort?.key,preferences.sort?.direction,revision,zoom]);
 useEffect(()=>{if(print)printDialog.current.showModal()},[print]);
 useEffect(()=>{
  const element=host.current;
  const sheetTarget=e=>e.target instanceof Element&&!!e.target.closest('.fortune-sheet-overlay,.luckysheet-rich-text-editor');
  const reject=e=>{if(sheetTarget(e)){e.preventDefault();e.stopPropagation();callbacks.current.onNotice('Values are protected. Use the document form to make changes.')}};
  const keyboard=e=>{const modified=e.ctrlKey||e.metaKey,key=e.key.toLowerCase();if(['backspace','delete','f2','enter'].includes(key)||(!modified&&!e.altKey&&e.key.length===1)||(modified&&['v','x','d','r'].includes(key)))reject(e)};
  element.addEventListener('keydown',keyboard,true);
  for(const name of ['dblclick','beforeinput','paste','cut','drop'])element.addEventListener(name,reject,true);
  return ()=>{element.removeEventListener('keydown',keyboard,true);for(const name of ['dblclick','beforeinput','paste','cut','drop'])element.removeEventListener(name,reject,true)};
 },[]);
 function change(sheets){if(!capabilities.format)return;const sheet=sheets[0];if(!sheet)return;if(hasDataChanges(sheet,state.current)){callbacks.current.onNotice('Direct data change blocked. The original records have been restored.');setRevision(x=>x+1);return}state.current=capturePresentation(sheet,state.current);callbacks.current.onPreferences({styles:state.current.styles,layout:state.current.layout})}
 function selection(_sheet,range){const sorted=orderedRecords(state.current);callbacks.current.onSelect(range.row[0]===range.row[1]&&range.row[0]>0?sorted[range.row[0]-1]:null)}
 function zoomTo(value){const current=book.current?.getSheet();if(current&&!hasDataChanges(current,state.current))state.current=capturePresentation(current,state.current);const layout={...state.current.layout,zoomRatio:value};state.current.layout=layout;callbacks.current.onPreferences({layout});setZoom(value)}
 function download(){if(!capabilities.export){onNotice('Your role cannot export this page.');return}const url=URL.createObjectURL(new Blob(['\uFEFF'+csvFor(state.current)],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download=`fabric-${page}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);onNotice('CSV exported. CSV contains values; use Print / PDF to retain presentation.')}
 function preview(){if(!capabilities.print){onNotice('Your role cannot print this page.');return}try{setPrint(formattedReport(book.current,spec.columns,records.length));}catch(e){onNotice(e.message)}}
 useEffect(()=>{function beforePrint(){if(!capabilities.print)return;try{const report=formattedReport(book.current,spec.columns,records.length);const surface=document.getElementById('fabric-printed-table');if(surface)surface.innerHTML=report}catch{/* No active sheet to print. */}}window.addEventListener('beforeprint',beforePrint);return()=>window.removeEventListener('beforeprint',beforePrint)},[spec,records,capabilities.print]);
 return h(React.Fragment,null,h('div',{className:'sheet-exports'},h('span',null,capabilities.format?'🔒 Values protected · formatting enabled':'🔒 Read-only access'),h('label',{className:'sheet-zoom'},'Zoom ',h('select',{'aria-label':'Sheet zoom',value:zoom,onChange:e=>zoomTo(Number(e.target.value))},[.5,.75,1,1.25,1.5,2].map(value=>h('option',{key:value,value},`${Math.round(value*100)}%`)))),capabilities.export&&h('button',{onClick:download},'Export CSV'),capabilities.print&&h('button',{onClick:preview},'Print / PDF')),
 h('div',{className:'fabric-grid',ref:host},h(Workbook,{key:`${page}:${revision}:${zoom}`,ref:book,data:initial,lang:'en',allowEdit:capabilities.format,showToolbar:capabilities.format,showFormulaBar:false,showSheetTabs:false,toolbarItems:['undo','redo','|','font-size','bold','italic','underline','|','font-color','background','border','|','horizontal-align','text-wrap','|','freeze'],cellContextMenu:['copy','|','set-row-height','set-column-width'],headerContextMenu:['copy','|','set-row-height','set-column-width'],hooks:{beforeUpdateCell:()=>false,beforePaste:()=>false,beforeAddSheet:()=>false,beforeDeleteSheet:()=>false,afterSelectionChange:selection},onChange:change})),
 h('dialog',{ref:printDialog,id:'fabric-print-dialog',className:'fabric-print-dialog',onCancel:()=>setPrint(null)},h('div',{className:'no-print print-top'},h('strong',null,'Print preview'),h('button',{onClick:()=>{printDialog.current.close();setPrint(null)}},'Close')),h('section',{className:'fabric-print-surface'},h('h2',null,spec.title),h('p',null,`${records.length} rows · current sorting and formatting`),h('div',{id:'fabric-printed-table',dangerouslySetInnerHTML:{__html:print||''}})),h('div',{className:'editor-actions no-print'},h('button',{className:'primary',onClick:()=>window.print()},'Print / Save as PDF'))));
}
