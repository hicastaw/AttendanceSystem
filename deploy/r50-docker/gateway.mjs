import http from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';

export class FrameBuffer {
  constructor(clock=Date.now){this.clock=clock;this.sequence=0;this.latest=null;}
  put(data,session,capturedAt){
    const now=this.clock();
    if(!/^[a-f0-9-]{36}$/.test(session)||!Number.isFinite(capturedAt)||now-capturedAt< -500||now-capturedAt>1500)
      throw Object.assign(new Error('Camera frame is stale or session is invalid'),{status:400});
    if(this.latest&&now-this.latest.at<2000&&this.latest.session!==session)
      throw Object.assign(new Error('Another browser tab owns the active camera; stop it first'),{status:409});
    this.latest={data:Buffer.from(data),session,at:now,capturedAt:Math.min(now,capturedAt),sequence:++this.sequence};
  }
  next(after){
    if(this.latest&&this.clock()-this.latest.capturedAt>1500)this.latest=null;
    if(!this.latest||this.latest.sequence<=after)return null;
    return {...this.latest,age:this.clock()-this.latest.capturedAt};
  }
}

export function createGateway({backendUrl,deviceKey,frames=new FrameBuffer()}) {
  return http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    if(!req.url.startsWith('/')||req.url.startsWith('//')){res.writeHead(400);return res.end();}
    const route=new URL(req.url,'http://local');
    try {
      if(route.pathname==='/__browser-camera/next') {
        const supplied=Buffer.from(req.headers['x-device-key']||''),expected=Buffer.from(deviceKey);
        if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected)){res.writeHead(401);return res.end();}
        if(req.method!=='GET'){res.writeHead(405);return res.end();}
        const after=Number(route.searchParams.get('after'));
        if(!Number.isSafeInteger(after)||after<0){res.writeHead(400);return res.end();}
        const frame=frames.next(after);
        if(!frame){res.writeHead(204);return res.end();}
        res.writeHead(200,{'Content-Type':'image/jpeg','X-Frame-Sequence':String(frame.sequence),'X-Frame-Age-Ms':String(frame.age),'X-Camera-Session':frame.session});
        return res.end(frame.data);
      }
      if(route.pathname==='/__browser-camera/frame') {
        if(req.method!=='POST'){res.writeHead(405);return res.end();}
        if(req.headers.origin!==`http://${req.headers.host}`)throw Object.assign(new Error('Use the same localhost origin'),{status:403});
        const auth=await fetch(backendUrl+'/api/cpu-test/admin-scope',{headers:{Authorization:req.headers.authorization||''},signal:AbortSignal.timeout(3000)});
        if(!auth.ok){res.writeHead(auth.status);return res.end();}
        if(req.headers['content-type']!=='image/jpeg')throw Object.assign(new Error('Expected JPEG frame'),{status:415});
        let bytes=0;const chunks=[];
        for await(const chunk of req){bytes+=chunk.length;if(bytes>512*1024)throw Object.assign(new Error('Frame exceeds 512 KiB'),{status:413});chunks.push(chunk);}
        const data=Buffer.concat(chunks);
        if(data.length<4||data[0]!==255||data[1]!==216)throw Object.assign(new Error('Invalid JPEG frame'),{status:400});
        frames.put(data,req.headers['x-camera-session']||'',Number(req.headers['x-captured-at']));
        res.writeHead(204);return res.end();
      }
      if(req.method==='GET'&&['/','/docker-demo.html','/docker-demo.js','/docker-demo.css'].includes(route.pathname)) {
        const name=route.pathname==='/'?'docker-demo.html':route.pathname.slice(1);
        const type=name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html; charset=utf-8';
        res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; media-src 'self' blob:; img-src 'self' blob: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
        res.setHeader('Content-Type',type);return res.end(await readFile(new URL('./public/'+name,import.meta.url)));
      }
      // The guarded backend remains bound to loopback. Only this gateway is published.
      const peer=http.request(new URL(req.url,backendUrl),{method:req.method,headers:req.headers},reply=>{
        res.writeHead(reply.statusCode,reply.headers);reply.pipe(res);
      });
      peer.setTimeout(8000,()=>peer.destroy(new Error('Backend timed out')));
      peer.on('error',()=>{if(!res.headersSent)res.writeHead(503);res.end('Local backend unavailable');});
      req.on('aborted',()=>peer.destroy());req.pipe(peer);
    } catch(error) {
      if(!res.headersSent)res.writeHead(error.status||503,{'Content-Type':'application/json'});
      res.end(JSON.stringify({status:'error',message:error.status?error.message:'Local service unavailable'}));
    }
  });
}
