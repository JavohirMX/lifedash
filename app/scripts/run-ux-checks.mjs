// Isolated sample-data UX regression runner. Never reuses a pre-existing server.
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
const port=process.env.UX_TEST_PORT??'4183',url=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',port,'--strictPort'],{stdio:['ignore','pipe','pipe']});let output='';let child;
server.stdout.on('data',c=>output+=c);server.stderr.on('data',c=>output+=c);
try{
 for(let i=0;i<100&&!output.includes('Local:');i++){if(server.exitCode!==null)throw Error(output);await delay(100)}
 if(!output.includes('Local:'))throw Error(output);
 for(const script of process.env.UX_ONLY ? process.env.UX_ONLY.split(',') : ['journal-highlight-recovery-smoke.mjs','note-create-recovery-smoke.mjs','note-title-recovery-smoke.mjs','project-edit-recovery-smoke.mjs','blocker-layout-smoke.mjs','project-create-recovery-smoke.mjs','subtask-recovery-smoke.mjs','checklist-conversion-smoke.mjs','journal-create-race-smoke.mjs','attachment-recovery-smoke.mjs','goal-habit-recovery-smoke.mjs','editor-recovery-identity-smoke.mjs','capture-recovery-smoke.mjs','save-recovery-smoke.mjs','feedback-recovery-smoke.mjs','google-mounted-smoke.mjs','google-panel-smoke.mjs','font-default-smoke.mjs','font-options-smoke.mjs','surfaces-ux-smoke.mjs','settings-navigation-smoke.mjs','settings-appearance-smoke.mjs','personalization-smoke.mjs','home-ux-smoke.mjs','workflow-ux-smoke.mjs']){
  const code=await new Promise((resolve,reject)=>{child=spawn(process.execPath,[`scripts/${script}`],{stdio:'inherit',env:{...process.env,BASE_URL:url}});child.on('error',reject);child.on('exit',code=>resolve(code))});if(code!==0)throw Error(`${script} failed`);
 }
}finally{child?.kill('SIGTERM');server.kill('SIGTERM');if(server.exitCode===null)await new Promise(r=>server.once('exit',r))}
