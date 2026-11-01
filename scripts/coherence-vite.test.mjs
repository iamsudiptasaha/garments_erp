import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {coherenceGuard} from './coherence-vite.mjs';
test('build and hot updates stop on coherence failure',()=>{
 let ok=true;const plugin=coherenceGuard(()=>ok?{status:0}:{status:1,stderr:'Wrong ownership'});plugin.buildStart();ok=false;
 assert.throws(()=>plugin.buildStart(),/Wrong ownership/);assert.throws(()=>plugin.handleHotUpdate(),/Wrong ownership/);
});
test('backend changes trigger revalidation and block module loading until fixed',()=>{
 let ok=true;const watcher=new EventEmitter();let paths;watcher.add=p=>{paths=p;};let middleware;const sent=[];
 const plugin=coherenceGuard(()=>ok?{status:0}:{status:1,stderr:'Invalid database link'});
 plugin.configureServer({watcher,middlewares:{use:fn=>{middleware=fn;}},ws:{send:m=>sent.push(m)},config:{logger:{info(){},error(){}}}});
 ok=false;watcher.emit('change',paths.find(p=>p.endsWith('supabase/migrations'))+'/test.sql');assert.equal(sent.at(-1).type,'error');
 const response={statusCode:200,end(value){this.body=value;}};middleware({url:'/src/app.js'},response,()=>assert.fail('invalid module must not load'));assert.equal(response.statusCode,503);
 ok=true;watcher.emit('change',paths[0]+'/hr/editor.js');let next=false;middleware({url:'/src/app.js'},{},()=>{next=true;});assert.equal(next,true);assert.equal(sent.at(-1).type,'full-reload');
});
