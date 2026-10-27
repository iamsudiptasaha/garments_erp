import test from 'node:test';
import assert from 'node:assert/strict';
import {readEnvironment} from '../src/foundation/environment.js';

test('demo configuration requires no credentials',()=>{
  assert.deepEqual(readEnvironment(),{mode:'demo'});
});

test('browser configuration rejects secret keys and credential-bearing URLs',()=>{
  const env={VITE_DATA_MODE:'supabase',VITE_SUPABASE_URL:'https://example.supabase.co',VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_sample'};
  assert.equal(readEnvironment(env).schema,'garments_erp');
  assert.throws(()=>readEnvironment({...env,VITE_SUPABASE_PUBLISHABLE_KEY:'sb_secret_do-not-use'}),/publishable/);
  assert.throws(()=>readEnvironment({...env,VITE_SUPABASE_URL:'https://user:password@example.supabase.co'}),/without credentials/);
  assert.throws(()=>readEnvironment({...env,VITE_SUPABASE_URL:'http://example.supabase.co'}),/HTTPS/);
});
