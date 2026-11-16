(function(){
"use strict";
const dataEl=document.getElementById("pvb-data");
if(!dataEl)return;
let D;
try{
const enc=dataEl.getAttribute("data-encoding");
if(enc==="base64"){
const bin=atob(dataEl.textContent.trim());
D=JSON.parse(new TextDecoder().decode(Uint8Array.from(bin,c=>c.charCodeAt(0))));
}else D=JSON.parse(dataEl.textContent);
}catch(e){
const p=document.querySelector(".pvb-vote-page");
if(p)p.innerHTML='<div class="pvb-error-page"><h1 class="pvb-error-headline">Something went wrong</h1><p class="pvb-error-body">Reload the page.</p></div>';
return;
}
const{board,items,votes,copy,shopUrl,proxyPath,askReasons,reasonChips}=D;
if(!board||!items||items.length===0)return;
// Build chip lookup from server data (active chips only) + "other" always last
const PR=Object.fromEntries((reasonChips?.pass||[]).map(c=>[c.code,c.label]));PR.other="Other";
const MR=Object.fromEntries((reasonChips?.maybe||[]).map(c=>[c.code,c.label]));MR.other="Other";
let idx=0,lv={},vh=[],busy=false,ut=null,pv=new Set();
let pg,cc,tc,ub,ts;
const CX=.28,CY=.22,CV=.6;
const rm=matchMedia("(prefers-reduced-motion:reduce)").matches;
const sk=D.storageKey&&`pvb:vote:v1:${D.storageKey}`;

function load(){if(!sk)return;try{const s=localStorage.getItem(sk);if(s)lv=JSON.parse(s).votes||{};}catch(e){/* ignore */}}
function save(){if(!sk)return;try{localStorage.setItem(sk,JSON.stringify({votes:lv}));}catch(e){/* ignore */}}
function initSrv(){if(votes&&Array.isArray(votes))for(const v of votes)if(v.boardItemId&&v.verdict)lv[v.boardItemId]=v.verdict;save();}
function findUv(){for(let i=0;i<items.length;i++)if(!lv[items[i].id])return i;return items.length;}
function esc(s){return s?s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"):"";}

function buildWelcome(){
const owner=board.ownerFirstName||"Someone",partner=board.partnerFirstName||"there",init=owner.charAt(0).toUpperCase();
const noteHtml=board.note?`<div class="pvb-welcome-note">"${esc(board.note)}"</div>`:"";
let thumbs="";const max=6,show=Math.min(items.length,max);
for(let i=0;i<show;i++)thumbs+=`<img class="pvb-welcome-thumb" src="${esc(items[i].image)}" alt="">`;
if(items.length>max)thumbs+=`<div class="pvb-welcome-more">+${items.length-max}</div>`;
return `<header class="pvb-top-bar"><p class="pvb-shop-name">${esc(D.shopName||"")}</p><div class="pvb-owner-avatar">${init}</div></header>
<div class="pvb-welcome"><div class="pvb-welcome-avatar">${init}</div>
<h1 class="pvb-welcome-greeting">Hi ${esc(partner)},</h1>
<p class="pvb-welcome-subtitle">${esc(owner)} wants your opinion on ${items.length} piece${items.length===1?"":"s"}.</p>
${noteHtml}<div class="pvb-welcome-thumbs">${thumbs}</div>
<button class="pvb-btn-primary" id="pvb-start-btn">Start Voting</button>
<p class="pvb-welcome-hint">No account needed. It takes a minute.</p></div>`;
}

function cardHtml(it,cls){
const sold=!it?.available?'<span class="pvb-sold-out">Sold out</span>':"";
return `<div class="pvb-card ${cls}"><div class="pvb-card-image">
<img src="${esc(it?.image||"")}" alt="${esc(it?.title||"")}">
<div class="pvb-card-label love">Love</div><div class="pvb-card-label pass">Pass</div><div class="pvb-card-label maybe">Maybe</div>
</div><div class="pvb-card-info"><div class="pvb-card-info-row"><h2 class="pvb-card-title">${esc(it?.title||"")}</h2></div>
<div class="pvb-card-price-row"><p class="pvb-card-price">${esc(it?.price||"")}${sold}</p>
<a href="${esc(it?.url||"#")}" class="pvb-card-info-btn" target="_blank" rel="noopener"><svg width="18" height="18" viewBox="0 0 24 24"><path d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></a></div></div></div>`;
}

function buildVotingUI(){
const item=items[idx]||items[0];
let prog="";for(let i=0;i<items.length;i++)prog+='<div class="pvb-progress-segment"></div>';
const b1=items[idx+1],b2=items[idx+2];
const init=(board.ownerFirstName||"S").charAt(0).toUpperCase();
return `<header class="pvb-top-bar"><p class="pvb-shop-name">${esc(D.shopName||"")}</p><div class="pvb-owner-avatar">${init}</div></header>
<div class="pvb-progress-row"><div class="pvb-progress">${prog}</div><span class="pvb-progress-count">${idx+1} of ${items.length}</span></div>
<div class="pvb-deck"><div class="pvb-card-container">${b2?cardHtml(b2,"behind-2"):""}${b1?cardHtml(b1,"behind-1"):""}${cardHtml(item,"")}</div></div>
<div class="pvb-undo-row"><button class="pvb-undo" id="pvb-undo">Undo</button></div>
<div class="pvb-vote-buttons">
<button class="pvb-vote-btn" data-vote="pass"><span class="pvb-vote-icon pass"><svg width="24" height="24" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" stroke="#A40713" stroke-width="2.5" stroke-linecap="round"/></svg></span><span class="pvb-vote-label">${esc(copy.stampPass||"Pass")}</span></button>
<button class="pvb-vote-btn" data-vote="maybe"><span class="pvb-vote-icon maybe"><svg width="18" height="18" viewBox="0 0 24 24"><text x="12" y="18" text-anchor="middle" fill="#82736C" font-size="20" font-weight="600">?</text></svg></span><span class="pvb-vote-label">${esc(copy.stampMaybe||"Maybe")}</span></button>
<button class="pvb-vote-btn" data-vote="love"><span class="pvb-vote-icon love"><svg width="24" height="24" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="#F9D2D2"/></svg></span><span class="pvb-vote-label">${esc(copy.stampLove||"Love")}</span></button>
</div><div class="pvb-toast"></div>`;
}

function buildDoneScreen(){
let rh="";
for(const it of items){const v=lv[it.id],tc=v==="LOVE"?"love":v==="MAYBE"?"maybe":"pass",tt=v==="LOVE"?"Loved":v==="MAYBE"?"Maybe":"Not For Us";
rh+=`<div class="pvb-recap-item"><img class="pvb-recap-thumb" src="${esc(it.image)}" alt=""><div class="pvb-recap-info"><p class="pvb-recap-title">${esc(it.title)}</p><p class="pvb-recap-price">${esc(it.price)}</p></div><span class="pvb-recap-tag ${tc}">${tt}</span></div>`;}
const lc=items.filter(it=>lv[it.id]==="LOVE").length;
return `<header class="pvb-top-bar"><p class="pvb-shop-name">${esc(D.shopName||"")}</p></header>
<div class="pvb-done"><div class="pvb-done-heart"><svg width="32" height="32" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="#F9D2D2"/></svg></div>
<h1 class="pvb-done-headline">${esc(copy.thanksHeadline||"Thanks")}</h1>
<p class="pvb-done-body">${esc(copy.thanksBody||"We'll let them know.")}</p>
<p class="pvb-done-count">You loved ${lc} of ${items.length}.</p>
<div class="pvb-recap-list">${rh}</div>
<a href="${esc(shopUrl||"/")}" class="pvb-btn-primary">Shop ${esc(D.shopName||"")}</a></div>`;
}

function renderWelcome(){pg.innerHTML=buildWelcome();document.getElementById("pvb-start-btn")?.addEventListener("click",startVoting);}
function startVoting(){pg.innerHTML=buildVotingUI();cacheEls();updProg();setupDrag();setupBtns();document.addEventListener("keydown",handleKey);}
function cacheEls(){cc=document.querySelector(".pvb-card-container");tc=cc?.querySelector(".pvb-card:not(.behind-1):not(.behind-2)");ub=document.getElementById("pvb-undo");ts=document.querySelector(".pvb-toast");}
function updProg(){document.querySelectorAll(".pvb-progress-segment").forEach((s,i)=>s.classList.toggle("done",i<idx||!!lv[items[i]?.id]));const c=document.querySelector(".pvb-progress-count");if(c)c.textContent=`${idx+1} of ${items.length}`;}
function toast(m){if(!ts)return;ts.textContent=m;ts.classList.add("visible");setTimeout(()=>ts.classList.remove("visible"),2500);}
function showUndo(){clearTimeout(ut);if(ub){ub.classList.add("visible");ut=setTimeout(()=>ub.classList.remove("visible"),4e3);}}
function hideUndo(){clearTimeout(ut);if(ub)ub.classList.remove("visible");}
function showDone(){pg.innerHTML=buildDoneScreen();if(sk)try{localStorage.removeItem(sk);}catch(e){/* ignore */}}

// Build reason sheet with piece name shown, Other text field
function buildRS(v,it,last){
const rs=v==="PASS"?PR:MR;
const t=v==="PASS"?(copy.passReasonTitle||"What's not right?"):(copy.maybeReasonTitle||"What would make it a yes?");
const h=copy.reasonHint||"Optional.";
const oh=copy.otherReasonHint||"{shopper} and TOV will see what you write.";
const owner=board.ownerFirstName||"Someone";
// Truncate title to one line (max ~50 chars)
const pn=it.title?.length>50?it.title.slice(0,47)+"...":it.title||"";
let ch="";for(const[k,l]of Object.entries(rs))ch+=`<button class="rs-ch" data-r="${k}" aria-pressed="false">${esc(l)}</button>`;
return `<div class="rs-o" role="dialog" aria-modal="true"><div class="rs-s"><h2 class="rs-t" tabindex="-1">${esc(t)}</h2><p class="rs-pn">${esc(pn)}</p><p class="rs-h">${esc(h.replace("{shopper}",owner))}</p><div class="rs-c">${ch}</div><div class="rs-tf" style="display:none"><input type="text" class="rs-ti" maxlength="120" placeholder="Tell ${esc(owner)} in a few words"><span class="rs-tc">0/120</span><p class="rs-th">${esc(oh.replace("{shopper}",owner))}</p></div><div class="rs-b"><button class="rs-sk" data-a="skip">Skip</button><button class="rs-nx" data-a="next">${last?"Finish":"Next Piece"}</button></div></div></div>`;
}

// Show reason sheet, keep voted card visible. pendingVote is the vote request to await before sending reason.
function showRS(v,it,last,pendingVote,cb){
const div=document.createElement("div");div.innerHTML=buildRS(v,it,last);const ol=div.firstChild;pg.appendChild(ol);
let pk=null,pt="";
const chips=ol.querySelectorAll(".rs-ch");
const tfWrap=ol.querySelector(".rs-tf");
const tfInput=ol.querySelector(".rs-ti");
const tfCount=ol.querySelector(".rs-tc");

chips.forEach(c=>c.addEventListener("click",e=>{
const r=e.target.dataset.r;
chips.forEach(ch=>ch.setAttribute("aria-pressed",ch.dataset.r===r?"true":"false"));
pk=r;
// Show/hide Other text field
if(r==="other"){tfWrap.style.display="";tfInput.focus();}else{tfWrap.style.display="none";pt="";}
}));

if(tfInput){
tfInput.addEventListener("input",()=>{pt=tfInput.value;tfCount.textContent=`${pt.length}/120`;});
tfInput.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();ol.querySelector(".rs-nx")?.click();}});
}

const close=()=>{ol.remove();document.removeEventListener("keydown",onK);};
ol.querySelector(".rs-b").addEventListener("click",e=>{const a=e.target.dataset.a;if(!a)return;close();if(a==="next"&&pk){(pendingVote||Promise.resolve()).then(()=>sendR(it.id,v,pk,pk==="other"?pt:null));}cb();});
const onK=e=>{if(e.key==="Escape"){e.preventDefault();close();cb();}};document.addEventListener("keydown",onK);ol.querySelector(".rs-t")?.focus();
}

function sendR(iid,v,r,rt){
const body={itemId:iid,verdict:v,reason:r};
if(rt)body.reasonText=rt;
fetch(`${proxyPath}/api/boards/${board.shareToken}/votes`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}).catch(()=>{});
}

let pid=null,sx=0,sy=0,dx=0,dy=0,lx=0,ly=0,lt=0,vx=0,vy=0,raf=null;
function setupDrag(){if(!tc)return;tc.addEventListener("pointerdown",onDown);}
function onDown(e){if(busy||e.button!==0||e.target.closest("a"))return;pid=e.pointerId;tc.setPointerCapture(pid);sx=e.clientX;sy=e.clientY;lx=e.clientX;ly=e.clientY;lt=Date.now();dx=0;dy=0;vx=0;vy=0;tc.classList.add("dragging");tc.addEventListener("pointermove",onMove);tc.addEventListener("pointerup",onUp);tc.addEventListener("pointercancel",onUp);}
function onMove(e){if(e.pointerId!==pid)return;const now=Date.now(),dt=now-lt;dx=e.clientX-sx;dy=e.clientY-sy;if(dt>0){vx=(e.clientX-lx)/dt;vy=(e.clientY-ly)/dt;}lx=e.clientX;ly=e.clientY;lt=now;if(raf===null)raf=requestAnimationFrame(updCard);}
function updCard(){raf=null;if(!tc)return;tc.style.transform=`translate(${dx}px,${Math.min(0,dy)}px) rotate(${dx*0.06}deg)`;const cW=tc.offsetWidth||320,cH=tc.offsetHeight||420;const nX=Math.abs(dx)/(cW*CX),nY=Math.abs(dy)/(cH*CY);const ll=tc.querySelector(".pvb-card-label.love"),pl=tc.querySelector(".pvb-card-label.pass"),ml=tc.querySelector(".pvb-card-label.maybe");if(dx>20){if(ll)ll.style.opacity=Math.min(1,nX);if(pl)pl.style.opacity=0;if(ml)ml.style.opacity=0;}else if(dx<-20){if(pl)pl.style.opacity=Math.min(1,nX);if(ll)ll.style.opacity=0;if(ml)ml.style.opacity=0;}else if(dy<-20){if(ml)ml.style.opacity=Math.min(1,nY);if(ll)ll.style.opacity=0;if(pl)pl.style.opacity=0;}else{if(ll)ll.style.opacity=0;if(pl)pl.style.opacity=0;if(ml)ml.style.opacity=0;}hlBtn(dx>20?"love":dx<-20?"pass":dy<-20?"maybe":null);}
function hlBtn(w){document.querySelectorAll(".pvb-vote-btn").forEach(b=>b.classList.toggle("highlight",b.dataset.vote===w));}
function onUp(e){if(e.pointerId!==pid)return;tc.releasePointerCapture(pid);tc.removeEventListener("pointermove",onMove);tc.removeEventListener("pointerup",onUp);tc.removeEventListener("pointercancel",onUp);tc.classList.remove("dragging");pid=null;hlBtn(null);const cW=tc.offsetWidth||320,cH=tc.offsetHeight||420;const tX=cW*CX,tY=cH*CY;let v=null;if(dx>tX||vx>CV)v="LOVE";else if(dx<-tX||vx<-CV)v="PASS";else if(dy<-tY||vy<-CV)v="MAYBE";if(v)vote(v);else springBack();}
function springBack(){if(!tc)return;tc.classList.add("spring-back");tc.style.transform="";tc.querySelectorAll(".pvb-card-label").forEach(l=>l.style.opacity=0);setTimeout(()=>tc?.classList.remove("spring-back"),300);}

async function vote(v){
if(busy)return;busy=true;setBD(true);hideUndo();
const it=items[idx];if(!it){busy=false;setBD(false);return;}
const vi=idx;lv[it.id]=v;save();vh.push({i:vi,id:it.id});pv.add(it.id);
const dir=v==="LOVE"?"right":v==="PASS"?"left":"up";
const nextIdx=idx+1;
const last=nextIdx>=items.length;
const sr=askReasons&&(v==="PASS"||v==="MAYBE");

// For LOVE or no-reason: submit immediately
// For PASS/MAYBE with reason sheet: vote submission happens without reason, reason sent separately
const rq=submit(it.id,v,null);

if(last){
// Last piece: animate exit, wait for vote, then show reason sheet or done
animateExit(dir,async()=>{
const r=await rq;pv.delete(it.id);setBD(false);
if(r.ok||r.locked){
if(sr){
// Show reason sheet with Finish button, pass resolved vote promise, then show done
showRS(v,it,true,rq,showDone);
}else{showDone();}
busy=false;return;
}
// Vote failed: revert
delete lv[it.id];vh.pop();save();idx=vi;rebuild();busy=false;
});
}else{
// Not last: animate exit, show reason sheet (with voted card still visible logically via sheet showing piece name)
// After sheet closes, advance to next
const go=()=>{idx=nextIdx;promote();busy=false;setBD(false);};
animateExit(dir,()=>{
if(sr)showRS(v,it,false,rq,go);else go();
});
rq.then(r=>{pv.delete(it.id);if(r.locked){showDone();return;}if(r.ok){if(vh[vh.length-1]?.id===it.id)showUndo();return;}delete lv[it.id];const hi=vh.findIndex(h=>h.id===it.id);if(hi>=0)vh.splice(hi,1);save();idx=vi;rebuild();if(!r.rl)toast("Vote didn't save. Try again.");}).catch(()=>{});
}}
function setBD(d){document.querySelectorAll(".pvb-vote-btn").forEach(b=>b.disabled=d);}
function animateExit(dir,cb){if(!tc){cb();return;}if(rm){tc.style.opacity="0";setTimeout(cb,50);return;}const a=dir==="right"?15:dir==="left"?-15:0,tx=dir==="right"?400:dir==="left"?-400:0,ty=dir==="up"?-400:0;tc.classList.add("exit");tc.style.transform=`translate(${tx}px,${ty}px) rotate(${a}deg)`;tc.style.opacity="0";setTimeout(cb,250);}
function promote(){if(!cc)return;const ex=cc.querySelector(".pvb-card.exit");if(ex)ex.remove();const b1=cc.querySelector(".pvb-card.behind-1");if(b1){b1.classList.remove("behind-1");b1.style.transform="";b1.style.opacity="";}const b2=cc.querySelector(".pvb-card.behind-2");if(b2){b2.classList.remove("behind-2");b2.classList.add("behind-1");}const ni=idx+2;if(ni<items.length){const nc=document.createElement("div");nc.className="pvb-card behind-2";nc.innerHTML=cardInner(items[ni]);cc.insertBefore(nc,cc.firstChild);}tc=cc.querySelector(".pvb-card:not(.behind-1):not(.behind-2)");updProg();setupDrag();}
function cardInner(it){const sold=!it?.available?'<span class="pvb-sold-out">Sold out</span>':"";return `<div class="pvb-card-image"><img src="${esc(it?.image||"")}" alt="${esc(it?.title||"")}"><div class="pvb-card-label love">Love</div><div class="pvb-card-label pass">Pass</div><div class="pvb-card-label maybe">Maybe</div></div><div class="pvb-card-info"><div class="pvb-card-info-row"><h2 class="pvb-card-title">${esc(it?.title||"")}</h2></div><div class="pvb-card-price-row"><p class="pvb-card-price">${esc(it?.price||"")}${sold}</p><a href="${esc(it?.url||"#")}" class="pvb-card-info-btn" target="_blank" rel="noopener"><svg width="18" height="18" viewBox="0 0 24 24"><path d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></a></div></div>`;}
function rebuild(){if(!cc)return;const it=items[idx],b1=items[idx+1],b2=items[idx+2];cc.innerHTML=`${b2?cardHtml(b2,"behind-2"):""}${b1?cardHtml(b1,"behind-1"):""}${cardHtml(it,"")}`;tc=cc.querySelector(".pvb-card:not(.behind-1):not(.behind-2)");updProg();setupDrag();}
async function submit(iid,v,r){const url=`${proxyPath}/api/boards/${board.shareToken}/votes`;try{const b={itemId:iid,verdict:v};if(r)b.reason=r;const res=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)});const d=await res.json();if(!res.ok){if(d.error?.code==="locked")return{ok:false,locked:true};if(d.error?.code==="rate_limited"){toast("Too many votes. Try again.");return{ok:false,rl:true};}toast("Something went wrong.");return{ok:false};}return d.complete?{ok:true,complete:true}:{ok:true};}catch(e){toast("Connection error.");return{ok:false};}}
function undo(){if(vh.length===0||busy)return;const p=vh[vh.length-1];if(pv.has(p.id))return;hideUndo();vh.pop();delete lv[p.id];save();idx=p.i;rebuild();}
function setupBtns(){document.querySelector('[data-vote="love"]')?.addEventListener("click",()=>vote("LOVE"));document.querySelector('[data-vote="maybe"]')?.addEventListener("click",()=>vote("MAYBE"));document.querySelector('[data-vote="pass"]')?.addEventListener("click",()=>vote("PASS"));ub?.addEventListener("click",undo);}
function handleKey(e){if(e.target.closest("input,textarea,a,button"))return;if(e.key==="ArrowRight"){e.preventDefault();vote("LOVE");}else if(e.key==="ArrowLeft"){e.preventDefault();vote("PASS");}else if(e.key==="ArrowUp"){e.preventDefault();vote("MAYBE");}else if(e.key==="Backspace"){e.preventDefault();undo();}}
function init(){pg=document.querySelector(".pvb-vote-page");if(!pg)return;load();initSrv();idx=findUv();if(idx>=items.length){showDone();return;}renderWelcome();}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();
