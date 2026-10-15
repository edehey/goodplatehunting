// Good Plate Hunting: tiny API for shared hunt groups.
// Static files are served by Cloudflare assets; only /api/* runs this code.
// Storage: one KV entry per group ("g:<CODE>"). Photos and videos are never sent here.

/*MERGE*/
function mergeDocs(a,b){
  const mx=(x,y)=>{const o={};for(const m of[x||{},y||{}])for(const k in m)o[k]=Math.max(o[k]||0,+m[k]||0);return o};
  const A=a||{},B=b||{};
  const rmE=[...new Set([...(A.rmE||[]),...(B.rmE||[])])],hid=[...new Set([...(A.hid||[]),...(B.hid||[])])];
  const gone=new Set(rmE),seen=new Map();
  for(const e of[...(A.events||[]),...(B.events||[])])if(e&&e.id&&!gone.has(e.id)&&!seen.has(e.id))seen.set(e.id,e);
  const events=[...seen.values()].sort((x,y)=>(x.ts-y.ts)||(x.id<y.id?-1:1));
  const aT=A.numT||0,bT=B.numT||0;
  const la=(A.nums||[]).length,lb=(B.nums||[]).length;
  const pickA=aT>bT||(aT===bT&&(la>lb||(la===lb&&JSON.stringify(A.nums||[])>=JSON.stringify(B.nums||[]))));
  return{pt:mx(A.pt,B.pt),rt:mx(A.rt,B.rt),nums:(pickA?A.nums:B.nums)||[],numT:Math.max(aT,bT),cs:(pickA?A.cs:B.cs)||0,ce:(pickA?A.ce:B.ce)||0,rmE,hid,events};
}
/*ENDMERGE*/

const CODE_RE=/^[A-Z2-9]{10}$/;
const ALPHA="ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const MAX_BODY=400000, MAX_PHOTO=500000, MAX_PHOTOS=100, TTL=60*60*24*365;
const ID_RE=/^[A-Za-z0-9_-]{6,40}$/, IMG_RE=/^data:image\/jpeg;base64,[A-Za-z0-9+\/=]+$/;
const json=(o,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{"content-type":"application/json","cache-control":"no-store"}});
const str=(v,n)=>typeof v==="string"?v.replace(/[\u0000-\u001f<>]/g,"").slice(0,n):"";
const num=v=>Number.isFinite(+v)?+v:0;

function cleanMap(m){const o={};if(m&&typeof m==="object")for(const k of Object.keys(m).slice(0,12)){const n=str(k,24).trim();if(n)o[n]=num(m[k])}return o}
function cleanEvent(e){
  if(!e||typeof e!=="object")return null;
  const id=str(e.id,40);if(!/^[A-Za-z0-9_-]{6,40}$/.test(id))return null;
  if(e.t==="spot"){
    const r={id,t:"spot",who:str(e.who,24),num:str(e.num,8),plate:str(e.plate,12),h:str(e.h,70),cc:/^[A-Z]{2}$/.test(e.cc)?e.cc:null,ah:typeof e.ah==="string"&&/^[01]{1,128}$/.test(e.ah)?e.ah:null,ts:num(e.ts)};
    if(!r.who||!r.h)return null;
    if(e.pc&&typeof e.pc==="object")r.pc={s:["ok","old","ed","no"].includes(e.pc.s)?e.pc.s:"no",d:typeof e.pc.d==="number"?e.pc.d:(typeof e.pc.d==="string"?str(e.pc.d,40):null),sw:e.pc.sw?str(e.pc.sw,40):null};else r.pc=null;
    return r}
  if(e.t==="msg"){const r={id,t:"msg",who:str(e.who,24),text:str(e.text,200),ts:num(e.ts)};return r.who&&r.text?r:null}
  if(e.t==="paid"){const r={id,t:"paid",from:str(e.from,24),to:str(e.to,24),ts:num(e.ts)};return r.from&&r.to?r:null}
  return null}
function clean(d){
  d=d&&typeof d==="object"?d:{};
  const nums=(Array.isArray(d.nums)?d.nums:[]).slice(0,1).map(x=>str(x,8).toUpperCase().replace(/[^A-Z0-9]/g,"")).filter(Boolean);
  return{pt:cleanMap(d.pt),rt:cleanMap(d.rt),nums,numT:num(d.numT),cs:num(d.cs),ce:num(d.ce),
    rmE:(Array.isArray(d.rmE)?d.rmE:[]).slice(0,3000).map(x=>str(x,40)).filter(Boolean),
    hid:(Array.isArray(d.hid)?d.hid:[]).slice(-500).map(x=>str(x,40)).filter(Boolean),
    events:(Array.isArray(d.events)?d.events:[]).slice(0,2000).map(cleanEvent).filter(Boolean),
    photos:[]}}

const b64u=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const enc=s=>new TextEncoder().encode(s);
// Web Push (VAPID, no payload): the keys are created once and kept in KV, never in the repository.
async function vapid(env){
  const v=await env.GROUPS.get("vapid");if(v)return JSON.parse(v);
  const kp=await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},true,["sign","verify"]);
  const o={priv:await crypto.subtle.exportKey("jwk",kp.privateKey),pub:b64u(await crypto.subtle.exportKey("raw",kp.publicKey))};
  await env.GROUPS.put("vapid",JSON.stringify(o));return o}
async function vapidAuth(env,ep){
  const v=await vapid(env),h=b64u(enc(JSON.stringify({typ:"JWT",alg:"ES256"}))),
    p=b64u(enc(JSON.stringify({aud:new URL(ep).origin,exp:Math.floor(Date.now()/1000)+12*3600,sub:"mailto:hello@goodplatehunting.com"})));
  const key=await crypto.subtle.importKey("jwk",v.priv,{name:"ECDSA",namedCurve:"P-256"},false,["sign"]);
  const sig=b64u(await crypto.subtle.sign({name:"ECDSA",hash:"SHA-256"},key,enc(h+"."+p)));
  return"vapid t="+h+"."+p+"."+sig+", k="+v.pub}
async function pushGroup(env,code,skipDv){
  const k="ps:"+code,raw=await env.GROUPS.get(k);if(!raw)return;
  const subs=JSON.parse(raw),keep=[];
  await Promise.all(subs.map(async s=>{
    if(s.dv&&s.dv===skipDv){keep.push(s);return}
    try{const r=await fetch(s.ep,{method:"POST",headers:{TTL:"3600",Urgency:"high",Authorization:await vapidAuth(env,s.ep)}});
      if(r.status===404||r.status===410)return}catch(_){}
    keep.push(s)}));
  if(keep.length!==subs.length)await env.GROUPS.put(k,JSON.stringify(keep),{expirationTtl:TTL})}

// Best-effort rate limit per IP (memory of this Worker instance): stops simple flooding.
const RL=new Map();
function limited(req,k,max,ms){const ip=req.headers.get("cf-connecting-ip")||"x",key=k+"|"+ip,now=Date.now();let a=(RL.get(key)||[]).filter(t=>now-t<ms);a.push(now);RL.set(key,a);if(RL.size>5000)for(const [kk,v] of RL)if(!v.length||now-v[v.length-1]>ms)RL.delete(kk);return a.length>max}
const too=()=>json({error:"slow down"},429);
const EVS=["open","spot","gnew","gjoin","share","report"];
async function stat(env,e){const k="st:"+new Date().toISOString().slice(0,10);let o={};try{o=JSON.parse(await env.GROUPS.get(k)||"{}")}catch(_){}o[e]=(o[e]||0)+1;await env.GROUPS.put(k,JSON.stringify(o),{expirationTtl:60*60*24*400})}

function newCode(){const b=crypto.getRandomValues(new Uint8Array(10));return[...b].map(x=>ALPHA[x%ALPHA.length]).join("")}

async function api(req,env,url,ctx){
  if(!env.GROUPS)return json({error:"storage"},500);
  const p=url.pathname.replace(/\/+$/,"").split("/").filter(Boolean); // ["api","g",CODE?,"sync"?]
  if(p[1]==="ev"&&req.method==="POST"){
    if(limited(req,"ev",60,600000))return too();
    let b={};try{b=JSON.parse((await req.text()).slice(0,200))}catch(_){}
    if(EVS.includes(b.e))await stat(env,b.e);return json({ok:true})}
  if(p[1]==="stats"&&req.method==="GET"){
    if(!env.STATS_KEY||url.searchParams.get("k")!==env.STATS_KEY)return json({error:"not found"},404);
    const l=await env.GROUPS.list({prefix:"st:"}),o={};for(const x of l.keys)o[x.name.slice(3)]=JSON.parse(await env.GROUPS.get(x.name)||"{}");return json(o)}
  if(p[1]==="vapid"&&req.method==="GET")return json({pub:(await vapid(env)).pub});
  if(p[1]!=="g")return json({error:"not found"},404);
  if(p.length===2){
    if(req.method!=="POST")return json({error:"method"},405);
    if(limited(req,"new",10,3600000))return too();
    for(let i=0;i<5;i++){const c=newCode();if(await env.GROUPS.get("g:"+c)===null){
      const d=clean({});await env.GROUPS.put("g:"+c,JSON.stringify(d),{expirationTtl:TTL});return json({code:c,doc:d},201)}}
    return json({error:"busy"},503)}
  const code=(p[2]||"").toUpperCase();
  if(!CODE_RE.test(code))return json({error:"bad code"},400);
  const key="g:"+code,raw=await env.GROUPS.get(key);
  if(raw===null)return json({error:"not found"},404);
  const stored=JSON.parse(raw);
  if(p.length===3){
    if(req.method==="GET")return json({doc:stored});
    if(req.method==="DELETE"){for(const x of(stored.photos||[]))await env.GROUPS.delete("ph:"+code+":"+x.id);await env.GROUPS.delete(key);await env.GROUPS.delete("ps:"+code);return json({ok:true})}
    return json({error:"method"},405)}
  if(p.length===4&&p[3]==="sync"&&req.method==="POST"){
    if(limited(req,"sync",300,600000))return too();
    const text=await req.text();if(text.length>MAX_BODY)return json({error:"too big"},413);
    let body;try{body=JSON.parse(text)}catch(_){return json({error:"bad json"},400)}
    const oldIds=new Set((stored.events||[]).map(e=>e.id));
    const merged=clean(mergeDocs(stored,clean(body)));merged.photos=stored.photos||[];
    const out=JSON.stringify(merged);
    if(out.length>MAX_BODY*2)return json({error:"group full"},413);
    if(out!==raw)await env.GROUPS.put(key,out,{expirationTtl:TTL});
    const fresh=merged.events.filter(e=>e.t==="spot"&&!oldIds.has(e.id)&&Date.now()-e.ts<10*60*1000);
    if(fresh.length&&ctx)ctx.waitUntil(pushGroup(env,code,str(body&&body.dv,40)));
    return json({doc:merged})}
  if(p.length===4&&p[3]==="report"&&req.method==="POST"){
    if(limited(req,"rp",20,3600000))return too();
    let b;try{b=JSON.parse((await req.text()).slice(0,500))}catch(_){return json({error:"bad json"},400)}
    const id=str(b&&b.id,40);if(!ID_RE.test(id))return json({error:"bad"},400);
    stored.hid=[...new Set([...(stored.hid||[]),id])].slice(-500);
    stored.photos=(stored.photos||[]).filter(x=>x.id!==id);
    await env.GROUPS.delete("ph:"+code+":"+id);
    await env.GROUPS.put(key,JSON.stringify(stored),{expirationTtl:TTL});return json({ok:true})}
  if(p.length===4&&p[3]==="push"&&(req.method==="POST"||req.method==="DELETE")){
    const text=await req.text();if(text.length>2000)return json({error:"too big"},413);
    let b;try{b=JSON.parse(text)}catch(_){return json({error:"bad json"},400)}
    const ep=typeof b.ep==="string"?b.ep:"";if(!/^https:\/\/[^\s]{10,600}$/.test(ep))return json({error:"bad"},400);
    const k="ps:"+code;let subs=[];try{subs=JSON.parse(await env.GROUPS.get(k)||"[]")}catch(_){}
    subs=subs.filter(s=>s.ep!==ep);
    if(req.method==="POST")subs.push({ep,dv:str(b.dv,40),ts:Date.now()});
    await env.GROUPS.put(k,JSON.stringify(subs.slice(-40)),{expirationTtl:TTL});return json({ok:true})}
  if(p[3]==="photo"){
    const photos=stored.photos||[];
    if(p.length===4&&req.method==="POST"){
      if(limited(req,"photo",40,600000))return too();
      const text=await req.text();if(text.length>MAX_PHOTO)return json({error:"too big"},413);
      let b;try{b=JSON.parse(text)}catch(_){return json({error:"bad json"},400)}
      const id=str(b&&b.id,40),img=b&&b.img;
      if(!ID_RE.test(id)||typeof img!=="string"||!IMG_RE.test(img))return json({error:"bad photo"},400);
      if(photos.some(x=>x.id===id))return json({doc:stored});
      if(photos.length>=MAX_PHOTOS)return json({error:"too many photos"},413);
      await env.GROUPS.put("ph:"+code+":"+id,JSON.stringify({img,cap:str(b.cap,120)}),{expirationTtl:TTL});
      stored.photos=[...photos,{id,cap:str(b.cap,120),ts:Date.now()}];
      await env.GROUPS.put(key,JSON.stringify(stored),{expirationTtl:TTL});
      return json({doc:stored})}
    const pid=p[4]||"";
    if(p.length===5&&ID_RE.test(pid)){
      if(req.method==="GET"){const v=await env.GROUPS.get("ph:"+code+":"+pid);return v===null?json({error:"not found"},404):new Response(v,{headers:{"content-type":"application/json","cache-control":"no-store"}})}
      if(req.method==="DELETE"){await env.GROUPS.delete("ph:"+code+":"+pid);stored.photos=photos.filter(x=>x.id!==pid);await env.GROUPS.put(key,JSON.stringify(stored),{expirationTtl:TTL});return json({ok:true})}}}
  return json({error:"not found"},404)}

export default{
  async fetch(req,env,ctx){
    const url=new URL(req.url);
    if(url.pathname.startsWith("/api/")){try{return await api(req,env,url,ctx)}catch(e){return json({error:"server"},500)}}
    return env.ASSETS.fetch(req)}
};
