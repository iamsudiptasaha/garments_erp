import {pages} from '../fabric/catalog.js';
export const actions=['view','create','edit','format','export','print'];
export const resources=[...Object.entries(pages).sort(([,a],[,b])=>Number(!!a.section)-Number(!!b.section)).map(([key,p])=>({id:key,label:p.title,group:p.section==='colours'?'Colours':p.section==='production'?'Production':p.section==='inventory'?'Raw Material Inventory':p.section==='miscellaneous'?'Miscellaneous':'Fabric',actions:p.readonly?['view','format','export','print']:actions})),{id:'employees',label:'Employees',group:'Employee / HR',actions:['view','create','edit']},{id:'adminAccess',label:'Account permissions',group:'Administration',actions:['view','edit']},{id:'adminRoles',label:'Roles & permissions',group:'Administration',actions:['view','create','edit']},{id:'adminAudit',label:'Activity log',group:'Administration',actions:['view']}];
const permissions=(fn)=>Object.fromEntries(resources.map(r=>[r.id,Object.fromEntries(r.actions.filter(a=>fn(r,a)).map(a=>[a,true]))]));
export function initialAccess(){return {version:2,revision:0,roles:[
 {id:'admin',name:'Administrator',description:'Manage workspace access and all modules.',permissions:permissions(()=>true),locked:true},
 {id:'accounts',name:'Accounts',description:'Starter template: bills and purchasing. Review before live use.',permissions:permissions((r,a)=>['Fabric','Colours'].includes(r.group)&&(a==='view'||(['orders','yarn','knitting','dyeBills'].includes(r.id)&&['create','edit','format','export','print'].includes(a))))},
 {id:'production',name:'Production',description:'Starter template: dyeing programs and production visibility.',permissions:permissions((r,a)=>['Fabric','Colours'].includes(r.group)&&(a==='view'||(r.id==='programs'&&['create','edit','format','export','print'].includes(a))))},
 {id:'viewer',name:'Viewer',description:'View Fabric and Colours. No data or presentation changes.',permissions:permissions((r,a)=>['Fabric','Colours'].includes(r.group)&&a==='view')}
 ],users:[{id:'owner',employeeCode:'ADMIN-001',name:'Workspace owner',phone:'',roleId:'admin',active:true},{id:'sample-accounts',employeeCode:'DEMO-002',name:'Accounts preview',phone:'',roleId:'accounts',active:true},{id:'sample-production',employeeCode:'DEMO-003',name:'Production preview',phone:'',roleId:'production',active:true},{id:'sample-viewer',employeeCode:'DEMO-004',name:'Viewer preview',phone:'',roleId:'viewer',active:true}],audit:[]}}
export function isAdministrator(state,userId){const user=state.users.find(u=>u.id===userId);return !!user?.active&&user.roleId==='admin'&&state.roles.some(r=>r.id==='admin'&&r.locked)}
export function upgradeAccess(state){
 const next=structuredClone(state);next.version=2;
 for(const role of next.roles){if(role.id==='admin')role.permissions={...initialAccess().roles[0].permissions,...role.permissions};else for(const r of resources.filter(r=>r.group==='Administration'))delete role.permissions[r.id];
  if(role.permissions.adminUsers&&role.id!=='admin')role.permissions.employees=role.permissions.adminUsers;delete role.permissions.adminUsers;
 }return next;
}
export function allowed(state,userId,resource,action){const definition=resources.find(r=>r.id===resource&&r.actions.includes(action));if(!definition)return false;if(definition.group==='Administration'&&!isAdministrator(state,userId))return false;const user=state.users.find(u=>u.id===userId);if(!user?.active)return false;const role=state.roles.find(r=>r.id===user.roleId);return !role?.archived&&!!role?.permissions?.[resource]?.view&&!!role?.permissions?.[resource]?.[action]}
function requireAccess(state,actor,resource,action){if(!allowed(state,actor,resource,action))throw Error('Your role does not allow this action.')}
function checkRevision(state,expected){if(expected!==undefined&&state.revision!==expected)throw Error('Access settings changed. Reload the form before saving.')}
function record(next,actor,action,subject){next.revision++;next.audit.unshift({id:crypto.randomUUID(),at:new Date().toISOString(),actor,action,subject});return next}
function hasAdministrator(state){return state.users.some(u=>isAdministrator(state,u.id))}
export function saveEmployee(state,actor,input,expected){
 requireAccess(state,actor,'employees',input.id?'edit':'create');checkRevision(state,expected);
 const next=structuredClone(state),old=next.users.find(u=>u.id===input.id),name=input.name?.trim(),employeeCode=input.employeeCode?.trim(),phone=input.phone?.replace(/[\s()-]/g,'')||'';
 if(input.id&&!old)throw Error('Employee access record no longer exists.');
 if(!name||!employeeCode)throw Error('Employee name and employee ID are required.');
 if(phone&&!/^\+[1-9]\d{9,14}$/.test(phone))throw Error('Enter a phone number with country code, such as +91 followed by the mobile number.');
 if(!phone&&(!old||old.phone))throw Error('A phone number is required for this employee.');
 if((input.roleId!==undefined&&input.roleId!==(old?.roleId||'viewer'))||(input.active!==undefined&&input.active!==(old?.active||false)))throw Error('Role and login access can only be changed in Administration.');
 if(next.users.some(u=>u.id!==input.id&&(u.employeeCode.toLowerCase()===employeeCode.toLowerCase()||(phone&&u.phone===phone))))throw Error('That employee ID or phone number is already assigned.');
 const user={id:old?.id||crypto.randomUUID(),name,employeeCode,phone,roleId:old?.roleId||'viewer',active:old?.active||false};if(old)next.users[next.users.indexOf(old)]=user;else next.users.push(user);
 if(!hasAdministrator(next))throw Error('Keep at least one active administrator with access-management permissions.');
 return record(next,actor,old?'Updated employee profile':'Added employee profile',employeeCode);
}
export function saveAccountAccess(state,actor,input,expected){
 requireAccess(state,actor,'adminAccess','edit');checkRevision(state,expected);const next=structuredClone(state),user=next.users.find(u=>u.id===input.id);
 if(!user)throw Error('Employee no longer exists. Create the profile in Employee / HR first.');
 if(!next.roles.some(r=>r.id===input.roleId&&!r.archived))throw Error('Choose a valid role.');
 user.roleId=input.roleId;user.active=!!input.active;
 if(!hasAdministrator(next))throw Error('Keep at least one active administrator.');
 return record(next,actor,'Updated account permissions',user.employeeCode);
}
export function saveRole(state,actor,input,expected){
 requireAccess(state,actor,'adminRoles',input.id?'edit':'create');checkRevision(state,expected);const next=structuredClone(state),old=next.roles.find(r=>r.id===input.id),name=input.name?.trim();
 if(input.id&&!old)throw Error('Role no longer exists.');
 if(old?.archived)throw Error('Archived roles cannot be edited.');
 if(old?.locked)throw Error('The built-in Administrator role is protected. Create another role to customise access.');
 if(!name)throw Error('Enter a role name.');if(next.roles.some(r=>r.id!==input.id&&r.name.toLowerCase()===name.toLowerCase()))throw Error('A role with that name already exists.');
 const policy={};for(const r of resources){if(r.group==='Administration'&&Object.values(input.permissions?.[r.id]||{}).some(Boolean))throw Error('Administration is reserved for Administrator accounts.');policy[r.id]={};for(const action of r.actions)if(input.permissions?.[r.id]?.[action])policy[r.id][action]=true;if(!policy[r.id].view&&Object.keys(policy[r.id]).length)throw Error(`${r.label}: View must be enabled before other permissions.`)}
 const role={id:old?.id||crypto.randomUUID(),name,description:input.description?.trim()||'',permissions:policy};if(old)next.roles[next.roles.indexOf(old)]=role;else next.roles.push(role);
 if(!hasAdministrator(next))throw Error('This change would remove the last access administrator.');return record(next,actor,old?'Updated role permissions':'Created role',name);
}
export function archiveRole(state,actor,roleId,expected){
 requireAccess(state,actor,'adminRoles','edit');checkRevision(state,expected);
 const next=structuredClone(state),role=next.roles.find(r=>r.id===roleId);
 if(!role)throw Error('Role no longer exists.');
 if(role.locked||role.id==='admin')throw Error('The Administrator role cannot be archived.');
 if(next.users.some(u=>u.roleId===roleId))throw Error('Reassign all employees before archiving this role, including disabled accounts.');
 if(role.archived)throw Error('This role is already archived.');
 role.archived=true;return record(next,actor,'Archived role',role.name);
}
