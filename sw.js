/* Good Plate Hunting service worker: network first, falls back to the last saved copy when offline. */
const C="gph-v3";
self.addEventListener("install",e=>{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>c.addAll(["/","/manifest.webmanifest","/icon-192.png","/icon-512.png"])).catch(()=>{}))});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C&&x!=="gph-meta").map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener("fetch",e=>{const r=e.request,u=new URL(r.url);
 if(r.method!=="GET"||u.origin!==location.origin||u.pathname.startsWith("/api/"))return;
 /* Opening the app: use the network, but if it takes longer than 3 s (slow wifi) show the saved copy; the fresh page is still saved for next time. */
 if(r.mode==="navigate"){const net=fetch(r).then(res=>{if(res.ok){const cp=res.clone();caches.open(C).then(c=>c.put(r,cp)).catch(()=>{})}return res});
  e.respondWith(new Promise(ok=>{let done=false;const fin=x=>{if(!done&&x){done=true;ok(x)}};
   const t=setTimeout(()=>caches.match(r).then(m=>fin(m||null)),3000);
   net.then(res=>{clearTimeout(t);fin(res)}).catch(()=>caches.match(r).then(m=>m||caches.match("/")).then(m=>fin(m||Response.error())));
   net.then(()=>{},()=>{});
   setTimeout(()=>net.then(fin,()=>{}),3000)}));
  e.waitUntil(net.then(()=>{},()=>{}));return}
 e.respondWith(fetch(r).then(res=>{if(res.ok){const cp=res.clone();caches.open(C).then(c=>c.put(r,cp))}return res}).catch(()=>caches.match(r).then(m=>m||caches.match("/"))))});

/* Push alerts: the server sends an empty push when a group member logs a plate. The text is chosen here, in the language the app saved. */
const NT={"en":["🚨 Good Plate Hunting","Someone in your group just spotted the number! Tap to see the photo."],"es":["🚨 Good Plate Hunting","¡Alguien de tu grupo acaba de encontrar el número! Toca para ver la foto."],"ca":["🚨 Good Plate Hunting","Algú del teu grup acaba de trobar el número! Toca per veure la foto."],"nl":["🚨 Good Plate Hunting","Iemand in je groep heeft net het nummer gespot! Tik om de foto te zien."],"id":["🚨 Good Plate Hunting","Seseorang di grupmu baru saja menemukan nomornya! Ketuk untuk melihat fotonya."],"ar":["🚨 Good Plate Hunting","أحد أفراد مجموعتك وجد الرقم للتو! اضغط لرؤية الصورة."],"fr":["🚨 Good Plate Hunting","Quelqu'un de ton groupe vient de repérer le numéro ! Touche pour voir la photo."],"de":["🚨 Good Plate Hunting","Jemand in deiner Gruppe hat gerade die Nummer entdeckt! Tippe, um das Foto zu sehen."],"it":["🚨 Good Plate Hunting","Qualcuno del tuo gruppo ha appena avvistato il numero! Tocca per vedere la foto."],"pt":["🚨 Good Plate Hunting","Alguém do seu grupo acabou de encontrar o número! Toque para ver a foto."],"tr":["🚨 Good Plate Hunting","Grubundan biri numarayı az önce buldu! Fotoğrafı görmek için dokun."],"ja":["🚨 Good Plate Hunting","グループの誰かが数字を見つけました！タップして写真を見よう。"],"ko":["🚨 Good Plate Hunting","그룹 멤버가 방금 숫자를 찾았어요! 눌러서 사진을 확인하세요."],"zh":["🚨 Good Plate Hunting","小组里有人刚刚发现了号码！点击查看照片。"]};
self.addEventListener("push",e=>{e.waitUntil((async()=>{let l="en";try{const c=await caches.open("gph-meta"),r=await c.match("/lang");if(r)l=await r.text()}catch(_){}
 const d=NT[l]||NT.en;await self.registration.showNotification(d[0],{body:d[1],icon:"/icon-192.png",badge:"/icon-192.png",tag:"gph-found",renotify:true,vibrate:[200,100,200,100,500]})})())});
self.addEventListener("notificationclick",e=>{e.notification.close();e.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(l=>{for(const c of l){if("focus"in c)return c.focus()}return clients.openWindow("/")}))});
