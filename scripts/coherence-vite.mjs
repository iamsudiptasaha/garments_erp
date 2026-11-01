import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
export function coherenceGuard(run = ()=>spawnSync(process.execPath,['scripts/check-coherence.mjs'],{cwd:root,encoding:'utf8',timeout:20000})){
 let failed='';
 function check(){
  const r=run();
  failed=r.status===0?'':(r.stderr||r.stdout||r.error?.message||'Coherence validation failed');
  if(failed)throw Error(failed);
 }
 return {name:'erp-db-coherence',enforce:'pre',
  buildStart(){check();},
  configureServer(server){
   const paths=['fabric-poc/src','database/contracts','database/catalogue','database/schema','supabase/functions','supabase/migrations','server','scripts'].map(p=>root+p);
   server.watcher.add(paths);
   const changed=path=>paths.some(p=>path.startsWith(p+'/'));
   function validate(path){if(!changed(path))return;try{check();server.config.logger.info('DB/UI coherence passed');server.ws.send({type:'full-reload'});}catch(e){server.config.logger.error(e.message);server.ws.send({type:'error',err:{message:e.message,stack:''}});}}
   server.watcher.on('add',validate).on('change',validate).on('unlink',validate);
   server.middlewares.use((req,res,next)=>{if(failed&&/\.(?:js|jsx|ts|tsx)(?:\?|$)/.test(req.url||'')){res.statusCode=503;res.end('DB/UI coherence validation failed. See the development console.');return;}next();});
   server.httpServer?.once('close',()=>{server.watcher.off('add',validate).off('change',validate).off('unlink',validate);});
  },
  handleHotUpdate(){check();},
 };
}
