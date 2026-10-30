import{writeFileSync}from'node:fs';
writeFileSync(process.env.UX_LIFECYCLE_FILE,String(process.pid));
setInterval(()=>{},1000);
