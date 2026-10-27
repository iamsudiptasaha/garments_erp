import React,{useEffect,useRef,useState} from 'react';
import {actions,resources,allowed,isAdministrator,saveAccountAccess,saveRole} from './model.js';
import './styles.css';
const h=React.createElement;
export const adminPages={adminRoles:'Roles & permissions',adminAudit:'Activity log'};
function Editor({access,actor,type,record,onSave,onClose}){
 const dialog=useRef(null),expectedRevision=useRef(access.revision),[error,setError]=useState('');
 const [draft,setDraft]=useState(()=>structuredClone(record||(type==='access'?{roleId:'viewer',active:false}:{name:'',description:'',permissions:{}})));
 useEffect(()=>{dialog.current.showModal()},[]);
 function input(key,label,extra={}){return h('label',{key},h('span',null,label),h('input',{value:draft[key]||'',onChange:e=>setDraft(d=>({...d,[key]:e.target.value})),...extra}))}
 function toggle(resource,action,checked){setDraft(d=>{const next=structuredClone(d);next.permissions[resource]||={};next.permissions[resource][action]=checked;if(action==='view'&&!checked)next.permissions[resource]={};return next})}
 function submit(e){e.preventDefault();try{const next=type==='access'?saveAccountAccess(access,actor,draft,expectedRevision.current):saveRole(access,actor,draft,expectedRevision.current);onSave(next);onClose()}catch(e){setError(e.message)}}
 const accountFields=type==='access'&&h('div',{className:'fabric-fields'},
  h('p',null,`${record.name} · ${record.employeeCode}`),
  h('label',null,h('span',null,'Role'),h('select',{'aria-label':'Role',value:draft.roleId,onChange:e=>setDraft(d=>({...d,roleId:e.target.value}))},access.roles.map(r=>h('option',{value:r.id,key:r.id},r.name)))),
  h('label',{className:'access-check'},h('input',{type:'checkbox',checked:draft.active,onChange:e=>setDraft(d=>({...d,active:e.target.checked}))}),'Account access enabled'));
 const matrixRows=type==='role'&&resources.filter(r=>r.group!=='Administration').map(r=>h('tr',{key:r.id},
  h('th',null,h('span',null,r.group),r.label),
  actions.map(a=>h('td',{key:a},r.actions.includes(a)?h('input',{
   type:'checkbox','aria-label':`${r.label}: ${a}`,checked:!!draft.permissions?.[r.id]?.[a],
   disabled:a!=='view'&&!draft.permissions?.[r.id]?.view,onChange:e=>toggle(r.id,a,e.target.checked)
  }):'—'))));
 const roleFields=type==='role'&&h(React.Fragment,null,
  h('div',{className:'fabric-fields'},input('name','Role name',{required:true}),input('description','Description')),
  h('div',{className:'permission-scroll'},h('table',{className:'permission-table'},
   h('thead',null,h('tr',null,h('th',null,'Page'),actions.map(a=>h('th',{key:a},a[0].toUpperCase()+a.slice(1))))),
   h('tbody',null,matrixRows))));
 return h('dialog',{ref:dialog,className:'fabric-dialog access-editor',onCancel:onClose},
  h('div',{className:'editor-heading'},h('div',null,h('small',null,'ADMINISTRATION'),h('h2',null,`${record?'Edit':'New'} ${type==='access'?'account permissions':'role'}`)),h('button',{onClick:onClose},'Close')),
  h('p',{className:'editor-note'},type==='access'?'Assign a role and account access here. Employee details are managed in Employee / HR. This preview does not create a real login.':'Set access per page. View is required before other actions. Administration is reserved for Administrator accounts.'),
  error&&h('p',{className:'form-error',role:'alert'},error),
  h('form',{onSubmit:submit},accountFields,roleFields,h('div',{className:'editor-actions'},h('button',{type:'button',onClick:onClose},'Cancel'),h('button',{type:'submit',className:'primary'},'Save access settings'))));

}
export function AdminPanel({page,access,actor,onSave}){
 const [editor,setEditor]=useState(null);const title=adminPages[page];
 if(!isAdministrator(access,actor)||!allowed(access,actor,page,'view'))return h('section',{className:'access-denied'},h('h1',null,'Access restricted'),h('p',null,'Your preview role cannot open this administration page. Choose the Workspace owner in the preview selector to return.'));
 const users=access.users;
 const employeeRows=users.map(u=>h('tr',{key:u.id},
  h('td',null,u.name),h('td',null,u.employeeCode),
  h('td',null,access.roles.find(r=>r.id===u.roleId)?.name),
  h('td',null,h('span',{className:u.active?'access-active':'access-paused'},u.active?'Enabled':'Disabled')),
  h('td',null,allowed(access,actor,'adminAccess','edit')&&h('button',{onClick:()=>setEditor({type:'access',record:u})},'Edit permissions'))));
 const accountPermissions=h('section',null,h('h2',null,'Account permissions'),h('p',{className:'editor-note'},'Assign roles to existing employee profiles. Add or edit employee details in Employee / HR.'),
  h('div',{className:'permission-scroll'},h('table',{className:'access-table'},h('thead',null,h('tr',null,['Account','Employee ID','Role','Access',''].map(t=>h('th',{key:t},t)))),h('tbody',null,employeeRows))));
 const roles=h(React.Fragment,null,
  h('div',{className:'fabric-actions'},h('p',{className:'editor-note'},'Starter roles are editable templates; they have not been assigned to real staff.'),allowed(access,actor,page,'create')&&h('button',{className:'primary',onClick:()=>setEditor({type:'role'})},'+ Create role')),
  h('section',{className:'overview-grid'},access.roles.map((r,i)=>h('article',{key:r.id,className:`overview-card tone-${i%4}`},
   h('span',{className:'card-kicker'},r.locked?'PROTECTED ROLE':'CUSTOMISABLE ROLE'),h('h2',null,r.name),h('p',{className:'card-subtitle'},r.description),
   h('p',null,`${access.users.filter(u=>u.roleId===r.id).length} assigned employees`),h('p',{className:'editor-note'},`${resources.filter(x=>r.permissions[x.id]?.view).length} pages available`),
   r.locked?h('small',null,'Administrator access is protected to prevent lockout.'):allowed(access,actor,page,'edit')&&h('button',{onClick:()=>setEditor({type:'role',record:r})},'Edit permissions →')))));
 const audit=h('section',{className:'audit-list'},access.audit.length?access.audit.map(event=>h('article',{key:event.id},
  h('div',null,h('strong',null,event.action),h('p',null,event.subject)),
  h('div',null,h('span',null,access.users.find(u=>u.id===event.actor)?.name||event.actor),h('small',null,new Date(event.at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}))))):
  h('div',{className:'empty-state'},h('h2',null,'No access changes yet'),h('p',null,'Role and employee changes will appear here. This browser-local log is not a production audit trail.')));
 return h(React.Fragment,null,
  h('header',{className:'fabric-page-header'},h('div',null,h('p',{className:'eyebrow'},'ADMINISTRATION'),h('h1',null,title),h('p',null,page==='adminRoles'?'One permission matrix. Consistent access across every page.':'See who changed access and when.'))),
  h('div',{className:'access-info'},'Access-design preview · saved in this browser · no real login or database permissions are changed'),
  h('section',{className:'access-metrics'},[['Accounts',access.users.length],['Enabled accounts',access.users.filter(u=>u.active).length],['Roles',access.roles.length],['Access changes',access.audit.length]].map(([label,value])=>h('div',{key:label},h('span',null,label),h('strong',null,value)))),
  page==='adminRoles'?h(React.Fragment,null,roles,accountPermissions):audit,
  editor&&h(Editor,{key:`${editor.type}:${editor.record?.id||'new'}`,access,actor,type:editor.type,record:editor.record,onSave,onClose:()=>setEditor(null)}));
}
