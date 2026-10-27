import React,{useEffect,useState} from 'react';
import {getAccessClient} from './client.js';
const h=React.createElement;
export function sessionAccessModel(session){
 const administrator=session.administrator===true,roleId=administrator?'admin':'session-role';
 return {version:2,revision:0,roles:[{id:roleId,name:administrator?'Administrator':'Assigned access',locked:administrator,permissions:session.permissions||{}}],users:[{id:session.actor,employeeCode:'Signed-in account',name:administrator?'Administrator':'Signed-in employee',phone:'',roleId,active:session.enabled===true}],audit:[]};
}
export function WorkspaceGate({render}){
 const [state,setState]=useState(null),[error,setError]=useState('');
 useEffect(()=>{let active=true,revision=0,client;try{client=getAccessClient()}catch(e){setError(e.message);return}
  async function load(){const ticket=++revision;try{const {data:auth,error:authError}=await client.auth.getSession();if(authError)throw authError;if(!auth.session){location.replace('/access.html');return}const {data,error}=await client.rpc('erp_access_snapshot');if(error)throw error;if(active&&ticket===revision){setState(data);setError('')}}catch(e){if(active&&ticket===revision){setState(null);setError(e.message)}}}
  void load();const {data}=client.auth.onAuthStateChange(()=>{if(active){setState(null);void load()}});const focus=()=>void load();window.addEventListener('focus',focus);return()=>{active=false;revision++;data.subscription.unsubscribe();window.removeEventListener('focus',focus)};
 },[]);
 if(error)return h('main',{className:'fabric-main'},h('h1',null,'Unable to load access'),h('p',{role:'alert'},error),h('a',{href:'/access.html'},'Return to sign in'));
 if(!state)return h('main',{className:'fabric-main'},h('p',{role:'status'},'Loading workspace…'));
 if(!state.enabled)return h('main',{className:'fabric-main'},h('h1',null,'Account awaiting activation'),h('p',null,state.reason),h('a',{href:'/access.html'},'Account settings'));
 return render(state);
}
