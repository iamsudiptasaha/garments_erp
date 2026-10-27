import React,{useEffect,useRef,useState} from 'react';
import {actions,resources,allowed,isAdministrator,saveAccountAccess,saveRole,archiveRole} from './model.js';
import './styles.css';
import {RoleMembers} from './members.js';
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
  h('label',null,h('span',null,'Role'),h('select',{'aria-label':'Role',value:draft.roleId,onChange:e=>setDraft(d=>({...d,roleId:e.target.value}))},access.roles.filter(r=>!r.archived).map(r=>h('option',{value:r.id,key:r.id},r.name)))),
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
 const [editor,setEditor]=useState(null),[memberRole,setMemberRole]=useState(null),[showArchived,setShowArchived]=useState(false),[archiveTarget,setArchiveTarget]=useState(null),[archiveError,setArchiveError]=useState('');const title=adminPages[page];
 if(!isAdministrator(access,actor)||!allowed(access,actor,page,'view'))return h('section',{className:'access-denied'},h('h1',null,'Access restricted'),h('p',null,'Your preview role cannot open this administration page. Choose the Workspace owner in the preview selector to return.'));
 const users=access.users;
 const roles=h(React.Fragment,null,
  h('div',{className:'fabric-actions'},h('p',{className:'editor-note'},'Starter roles are editable templates; they have not been assigned to real staff.'),allowed(access,actor,page,'create')&&h('button',{className:'primary',onClick:()=>setEditor({type:'role'})},'+ Create role')),
  h('label',{className:'access-check'},h('input',{type:'checkbox',checked:showArchived,onChange:e=>setShowArchived(e.target.checked)}),'Show archived roles'),archiveError&&h('p',{role:'alert',className:'form-error'},archiveError),archiveTarget&&h('section',{className:'member-confirm'},h('p',null,`Archive ${archiveTarget.name}? Its history will be retained and it will no longer be assignable.`),h('button',{onClick:()=>setArchiveTarget(null)},'Cancel'),h('button',{className:'primary',onClick:()=>{try{onSave(archiveRole(access,actor,archiveTarget.id,access.revision));setArchiveTarget(null);setArchiveError('')}catch(e){setArchiveError(e.message)}}},'Confirm archive')),
  h('section',{className:'overview-grid'},access.roles.filter(r=>showArchived||!r.archived).map((r,i)=>h('article',{key:r.id,className:`overview-card tone-${i%4}`},
   h('span',{className:'card-kicker'},r.archived?'ARCHIVED ROLE':r.locked?'PROTECTED ROLE':'CUSTOMISABLE ROLE'),h('h2',null,r.name),h('p',{className:'card-subtitle'},r.description),
   h('p',null,`${access.users.filter(u=>u.roleId===r.id).length} assigned employees`),h('p',{className:'editor-note'},`${resources.filter(x=>r.permissions[x.id]?.view).length} pages available`),
   !r.archived&&allowed(access,actor,'adminAccess','edit')&&h('button',{className:'manage-members',onClick:()=>setMemberRole(r.id)},'Manage employees →'),r.archived?h('small',null,'Archived · history retained'):r.locked?h('small',null,'Administrator access is protected to prevent lockout.'):allowed(access,actor,page,'edit')&&h('button',{onClick:()=>setEditor({type:'role',record:r})},'Edit permissions →'),!r.archived&&!r.locked&&allowed(access,actor,page,'edit')&&h('button',{disabled:access.users.some(u=>u.roleId===r.id),title:access.users.some(u=>u.roleId===r.id)?'Reassign every employee before archiving':'Archive this unassigned role',onClick:()=>{setArchiveError('');setArchiveTarget(r)}},'Archive role')))));
 const audit=h('section',{className:'audit-list'},access.audit.length?access.audit.map(event=>h('article',{key:event.id},
  h('div',null,h('strong',null,event.action),h('p',null,event.subject)),
  h('div',null,h('span',null,access.users.find(u=>u.id===event.actor)?.name||event.actor),h('small',null,new Date(event.at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}))))):
  h('div',{className:'empty-state'},h('h2',null,'No access changes yet'),h('p',null,'Role and employee changes will appear here. This browser-local log is not a production audit trail.')));
 return h(React.Fragment,null,
  h('header',{className:'fabric-page-header'},h('div',null,h('p',{className:'eyebrow'},'ADMINISTRATION'),h('h1',null,title),h('p',null,page==='adminRoles'?'One permission matrix. Consistent access across every page.':'See who changed access and when.'))),
  h('div',{className:'access-info'},'Access-design preview · saved in this browser · no real login or database permissions are changed'),
  h('section',{className:'access-metrics'},[['Accounts',access.users.length],['Enabled accounts',access.users.filter(u=>u.active).length],['Roles',access.roles.length],['Access changes',access.audit.length]].map(([label,value])=>h('div',{key:label},h('span',null,label),h('strong',null,value)))),
  page==='adminRoles'?roles:audit,
  memberRole&&h(RoleMembers,{key:memberRole,role:access.roles.find(r=>r.id===memberRole),employees:users.map(u=>({id:u.id,name:u.name,code:u.employeeCode,phone:u.phone,roles:access.roles.find(r=>r.id===u.roleId)?.name,assigned:u.roleId===memberRole,enabled:u.active,canRemove:memberRole!=='viewer'})),removeLabel:'Move to Viewer',note:'This local preview assigns one role per employee. Adding someone moves them from their current role. Removing them moves them to Viewer; login status stays unchanged.',onAdd:e=>{const u=access.users.find(u=>u.id===e.id);onSave(saveAccountAccess(access,actor,{id:u.id,roleId:memberRole,active:u.active},access.revision))},onRemove:e=>{const u=access.users.find(u=>u.id===e.id);onSave(saveAccountAccess(access,actor,{id:u.id,roleId:'viewer',active:u.active},access.revision))},onClose:()=>setMemberRole(null)}),
  editor&&h(Editor,{key:`${editor.type}:${editor.record?.id||'new'}`,access,actor,type:editor.type,record:editor.record,onSave,onClose:()=>setEditor(null)}));
}
