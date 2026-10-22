import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../output/cyber-rooftop/web');
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.esscene':'application/json','.wasm':'application/wasm','.png':'image/png','.css':'text/css'};
const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');let relative;
    try{relative=decodeURIComponent(url.pathname).replace(/^\/+/, '')||'index.html';}catch{res.writeHead(400).end();return;}
    const file=path.resolve(root,relative);const inside=path.relative(root,file);
    if(inside.startsWith('..')||path.isAbsolute(inside)){res.writeHead(403).end();return;}
    try{const bytes=await readFile(file);res.writeHead(200,{'content-type':types[path.extname(file)]||'application/octet-stream'}).end(bytes);}
    catch{res.writeHead(404).end('Export this project first.');}
});
server.listen(Number(process.env.PORT||5186),'127.0.0.1',()=>console.log('Cyber Rooftop: http://127.0.0.1:'+server.address().port));
