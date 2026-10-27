import {createUniver,LocaleType,mergeLocales,defaultTheme} from '@univerjs/presets';
import {UniverSheetsCorePreset} from '@univerjs/preset-sheets-core';
import CoreEnUS from '@univerjs/preset-sheets-core/locales/en-US';
import {UniverSheetsFilterPreset} from '@univerjs/preset-sheets-filter';
import FilterEnUS from '@univerjs/preset-sheets-filter/locales/en-US';
import {UniverSheetsSortPreset} from '@univerjs/preset-sheets-sort';
import SortEnUS from '@univerjs/preset-sheets-sort/locales/en-US';
import '@univerjs/preset-sheets-core/lib/index.css';
import '@univerjs/preset-sheets-filter/lib/index.css';
import '@univerjs/preset-sheets-sort/lib/index.css';
import {seed,clone,pages,validate} from './model.js';
import {buildWorkbook,readSourceChanges} from './workbook.js';
const $=s=>document.querySelector(s),STORAGE='fabric-univer-v1';let initial,legacy;try{initial=JSON.parse(localStorage.getItem(STORAGE));legacy=JSON.parse(localStorage.getItem('garments-fabric-grid-v1'))}catch{/* Invalid browser storage falls back to the sample below. */}
let source=initial?.source||legacy?.data||clone(seed);try{if(validate(source))source=clone(seed)}catch{source=clone(seed)}
let page='knitting',view='sheet',savedTimer,started=false;
function message(text,error=false){$('#message').textContent=text;$('#message').className=error?'error':'';$('#message').setAttribute('role',error?'alert':'status')}
const {univerAPI}=createUniver({locale:LocaleType.EN_US,locales:{[LocaleType.EN_US]:mergeLocales(CoreEnUS,FilterEnUS,SortEnUS)},theme:defaultTheme,presets:[UniverSheetsCorePreset({container:'univer',header:true,toolbar:true,formulaBar:true,footer:true,ribbonType:'classic',sheets:{protectedRangeShadow:false}}),UniverSheetsFilterPreset(),UniverSheetsSortPreset()]});
const workbook=univerAPI.createWorkbook(initial?.workbook||buildWorkbook(source));
function persist(){if(!started)return;try{localStorage.setItem(STORAGE,JSON.stringify({workbook:workbook.save(),source}));$('#saved').textContent='Saved in this browser'}catch{message('Browser storage is unavailable; changes remain in this tab only.',true)}}
function saveSoon(){if(!started)return;$('#saved').textContent='Saving…';clearTimeout(savedTimer);savedTimer=setTimeout(persist,500)}
function active(){return workbook.getActiveSheet()}
function updateShell(){const sheet=active();const key=sheet?.getSheetId();if(pages[key])page=key;$('#title').textContent=pages[page].title;$('#subtitle').textContent=pages[page].subtitle;$('#pages').querySelectorAll('button').forEach(b=>b.setAttribute('aria-current',b.dataset.page===page?'page':'false'));$('#overview').setAttribute('aria-pressed',String(view==='overview'));$('#sheet').setAttribute('aria-pressed',String(view==='sheet'));$('#sheet-shell').hidden=view!=='sheet';$('#overview-content').hidden=view!=='overview';if(view==='overview')renderOverview()}
function renderOverview(){const root=$('#overview-content');root.replaceChildren();const values=active().getRange(1,0,Math.min(50,active().getMaxRows()-1),pages[page].columns.length).getValues();values.filter(row=>row[0]).forEach(row=>{const card=document.createElement('article');card.className='card';const title=document.createElement('h2');title.textContent=row[page==='knitting'?3:page==='dyed'?1:page==='yarn'?1:1]||row[0];const label=document.createElement('small');label.textContent=row[0];card.append(label,title);const index=page==='knitting'?6:page==='dyed'?7:6;const strong=document.createElement('strong');strong.className='measure';strong.textContent=fmt(row[index])+' kg';const p=document.createElement('p');p.textContent=page==='knitting'?'Knitted output':page==='dyed'?'Final fabric':'Remaining';card.append(strong,p);const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent='See record details';details.append(summary);pages[page].columns.forEach((c,i)=>{const line=document.createElement('p');line.textContent=c.label+': '+fmt(row[i]);details.append(line)});card.append(details);root.append(card)})}
const fmt=v=>typeof v==='number'?v.toLocaleString(undefined,{maximumFractionDigits:2}):v??'—';
Object.entries(pages).forEach(([key,config])=>{const b=document.createElement('button');b.textContent=config.title;b.dataset.page=key;b.onclick=()=>{workbook.setActiveSheet(key);updateShell()};$('#pages').append(b)});
$('#overview').onclick=()=>{view='overview';updateShell()};$('#sheet').onclick=()=>{view='sheet';updateShell();window.dispatchEvent(new Event('resize'))};
$('#validate').onclick=()=>{try{const next=readSourceChanges(workbook.save(),source);const error=validate(next);if(error)throw Error(error);source=next;persist();message('Source values passed validation. Linked balances use native spreadsheet formulas.')}catch(e){message('Validation: '+e.message+' Use the library Undo to correct the source values.',true)}};
$('#capabilities').onclick=()=>$('#capability-dialog').showModal();
$('#access').onchange=async e=>{await workbook.getWorkbookPermission().setMode(e.target.value==='read'?'viewer':'editor');message(e.target.value==='read'?'Library viewer mode enabled.':'Library editor mode enabled. Derived columns remain protected.')};
$('#reset').onclick=()=>{if($('#access').value==='read'){message('Switch to Editor before resetting sample data.',true);return}if(confirm('Reset the library workbook and its formatting to the original sample?')){localStorage.removeItem(STORAGE);localStorage.removeItem('garments-fabric-grid-v1');location.reload()}};
$('#print-info').onclick=()=>{message('Native sheet printing is a Univer Pro feature and is not installed. No canvas-to-print workaround is being used.');$('#capability-dialog').showModal()};
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='p'&&view==='sheet'){e.preventDefault();message('Native sheet printing requires Univer Pro. See “Features & limits”.')}});
univerAPI.addEvent(univerAPI.Event.ActiveSheetChanged,()=>{updateShell();saveSoon()});
univerAPI.addEvent(univerAPI.Event.CommandExecuted,saveSoon);
univerAPI.addEvent(univerAPI.Event.SheetValueChanged,()=>{saveSoon();if(view==='overview')renderOverview()});
// Local-only native range protection. Production still needs server authorization.
async function protectDerived(){
 for(const [key,config] of Object.entries(pages)){
  const sheet=workbook.getSheetBySheetId(key);const maxCol=key==='knitting'?13:key==='dyed'?15:key==='yarn'?10:7;
  const ranges=[];ranges.push(sheet.getRange(0,0,1,maxCol));
  for(let col=0;col<maxCol;col++)if(!config.columns[col]?.editable)ranges.push(sheet.getRange(1,col,199,1));
  const permission=sheet.getWorksheetPermission();const existing=await permission.listRangeProtectionRules();for(const rule of existing)await rule.remove();
  if(key==='yarn'||key==='greige'){
   await permission.protect({name:'Calculated balance sheet'});
   await permission.setPoint(univerAPI.Enum.WorksheetPermissionPoint.Edit,true);
   await permission.setPoint(univerAPI.Enum.WorksheetPermissionPoint.SetCellValue,false);
   await permission.setPoint(univerAPI.Enum.WorksheetPermissionPoint.SetCellStyle,true);
   await permission.setPoint(univerAPI.Enum.WorksheetPermissionPoint.Sort,true);
   await permission.setPoint(univerAPI.Enum.WorksheetPermissionPoint.Filter,true);
   continue;
  }
  const [rule]=await permission.protectRanges([{ranges,options:{name:'Calculated values and source identity',allowViewByOthers:true}}]);
  if(rule)await rule.setPoint(univerAPI.Enum.RangePermissionPoint.Edit,false);
 }
}
async function start(){try{await protectDerived()}catch(e){message('Native range protection did not initialise: '+e.message,true)}started=true;workbook.setActiveSheet(page);updateShell();persist()}
start();
// No custom cell rendering, selection, formatting, copy/paste, sorting or freeze code.
