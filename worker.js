// Good Plate Hunting: tiny API for shared hunt groups.
// Static files are served by Cloudflare assets; only /api/* runs this code.
// Storage: one KV entry per group ("g:<CODE>"). Photos and videos are never sent here.

/*MERGE*/
function mergeDocs(a,b){
  const mx=(x,y)=>{const o={};for(const m of[x||{},y||{}])for(const k in m)o[k]=Math.max(o[k]||0,+m[k]||0);return o};
  const A=a||{},B=b||{};
  const rmE=[...new Set([...(A.rmE||[]),...(B.rmE||[])])];
  const gone=new Set(rmE),seen=new Map();
  for(const e of[...(A.events||[]),...(B.events||[])])if(e&&e.id&&!gone.has(e.id)&&!seen.has(e.id))seen.set(e.id,e);
  const events=[...seen.values()].sort((x,y)=>(x.ts-y.ts)||(x.id<y.id?-1:1));
  const aT=A.numT||0,bT=B.numT||0;
  const la=(A.nums||[]).length,lb=(B.nums||[]).length;
  const pickA=aT>bT||(aT===bT&&(la>lb||(la===lb&&JSON.stringify(A.nums||[])>=JSON.stringify(B.nums||[]))));
  return{pt:mx(A.pt,B.pt),rt:mx(A.rt,B.rt),nums:(pickA?A.nums:B.nums)||[],numT:Math.max(aT,bT),cs:(pickA?A.cs:B.cs)||0,ce:(pickA?A.ce:B.ce)||0,rmE,events};
}
/*ENDMERGE*/

const CODE_RE=/^[A-Z2-9]{10}$/;
const ALPHA="ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const MAX_BODY=400000, MAX_PHOTO=500000, MAX_PHOTOS=40, TTL=60*60*24*365;
const ID_RE=/^[A-Za-z0-9_-]{6,40}$/, IMG_RE=/^data:image\/jpeg;base64,[A-Za-z0-9+\/=]+$/;
const json=(o,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{"content-type":"application/json","cache-control":"no-store"}});
const str=(v,n)=>typeof v==="string"?v.replace(/[\u0000-\u001f<>]/g,"").slice(0,n):"";
const num=v=>Number.isFinite(+v)?+v:0;

function cleanMap(m){const o={};if(m&&typeof m==="object")for(const k of Object.keys(m).slice(0,60)){const n=str(k,24).trim();if(n)o[n]=num(m[k])}return o}
function cleanEvent(e){
  if(!e||typeof e!=="object")return null;
  const id=str(e.id,40);if(!/^[A-Za-z0-9_-]{6,40}$/.test(id))return null;
  if(e.t==="spot"){
    const r={id,t:"spot",who:str(e.who,24),num:str(e.num,8),plate:str(e.plate,12),h:str(e.h,70),ah:typeof e.ah==="string"&&/^[01]{1,128}$/.test(e.ah)?e.ah:null,ts:num(e.ts)};
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
    events:(Array.isArray(d.events)?d.events:[]).slice(0,2000).map(cleanEvent).filter(Boolean),
    photos:[]}}

function newCode(){const b=crypto.getRandomValues(new Uint8Array(10));return[...b].map(x=>ALPHA[x%ALPHA.length]).join("")}

async function api(req,env,url){
  if(!env.GROUPS)return json({error:"storage"},500);
  const p=url.pathname.replace(/\/+$/,"").split("/").filter(Boolean); // ["api","g",CODE?,"sync"?]
  if(p[1]!=="g")return json({error:"not found"},404);
  if(p.length===2){
    if(req.method!=="POST")return json({error:"method"},405);
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
    if(req.method==="DELETE"){for(const x of(stored.photos||[]))await env.GROUPS.delete("ph:"+code+":"+x.id);await env.GROUPS.delete(key);return json({ok:true})}
    return json({error:"method"},405)}
  if(p.length===4&&p[3]==="sync"&&req.method==="POST"){
    const text=await req.text();if(text.length>MAX_BODY)return json({error:"too big"},413);
    let body;try{body=JSON.parse(text)}catch(_){return json({error:"bad json"},400)}
    const merged=clean(mergeDocs(stored,clean(body)));merged.photos=stored.photos||[];
    const out=JSON.stringify(merged);
    if(out.length>MAX_BODY*2)return json({error:"group full"},413);
    if(out!==raw)await env.GROUPS.put(key,out,{expirationTtl:TTL});
    return json({doc:merged})}
  if(p[3]==="photo"){
    const photos=stored.photos||[];
    if(p.length===4&&req.method==="POST"){
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
  async fetch(req,env){
    const url=new URL(req.url);
    if(url.pathname.startsWith("/api/")){try{return await api(req,env,url)}catch(e){return json({error:"server"},500)}}
    return env.ASSETS.fetch(req)}
};
