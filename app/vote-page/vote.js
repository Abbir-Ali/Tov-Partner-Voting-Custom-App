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
const{board,items,votes,copy,shopUrl,proxyPath,askReasons,reasonChips,avatarBg}=D;
if(!board||!items||items.length===0)return;
let voterToken=D.voterToken,voterFirstName=D.voterFirstName,voterAvatarKey=D.voterAvatarKey;
const groupMode=D.groupMode,groupToken=D.groupToken,hidePrices=D.hidePrices,voterCount=D.voterCount||1;
let groupSummary=D.groupSummary;
const PR=Object.fromEntries((reasonChips?.pass||[]).map(c=>[c.code,c.label]));PR.other="Other";
const MR=Object.fromEntries((reasonChips?.maybe||[]).map(c=>[c.code,c.label]));MR.other="Other";
let idx=0,lv={},vh=[],busy=false,ut=null,pv=new Set();
let pg,cc,tc,ub,ts;
const CX=.28,CY=.22,CV=.6;
const rm=matchMedia("(prefers-reduced-motion:reduce)").matches;
const sk=D.storageKey&&`pvb:vote:v1:${D.storageKey}`,vtk=D.storageKey&&`pvb:voter:${D.storageKey}`;
const HRT='<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="#F9D2D2"/>';
function load(){if(!sk)return;try{const s=localStorage.getItem(sk);if(s){const p=JSON.parse(s);lv=p.votes||{};}}catch(e){lv={};}}
function save(){if(!sk)return;try{localStorage.setItem(sk,JSON.stringify({votes:lv}));}catch(e){/* localStorage unavailable */}}
function loadVT(){if(!vtk)return null;try{return localStorage.getItem(vtk);}catch(e){return null;}}
function saveVT(t){if(!vtk)return;try{localStorage.setItem(vtk,t);}catch(e){/* localStorage unavailable */}}
function initSrv(){if(votes&&Array.isArray(votes))for(const v of votes)if(v.boardItemId&&v.verdict)lv[v.boardItemId]=v.verdict;save();}
function findUv(){for(let i=0;i<items.length;i++)if(!lv[items[i].id])return i;return items.length;}
function esc(s){return s?s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"):"";}
function buildGroupJoin(){
const o=board.ownerFirstName||"Someone",i=o.charAt(0).toUpperCase();
let th="";const mx=6,sh=Math.min(items.length,mx);
for(let j=0;j<sh;j++)th+=`<img class="pvb-welcome-thumb" src="${esc(items[j].image)}" alt="">`;
if(items.length>mx)th+=`<div class="pvb-welcome-more">+${items.length-mx}</div>`;
return `<header class="pvb-top-bar"><p class="pvb-shop-name">${esc(D.shopName||"")}</p><div class="pvb-owner-avatar">${i}</div></header><div class="pvb-welcome"><div class="pvb-welcome-content"><div class="pvb-welcome-avatar">${i}</div><h1 class="pvb-welcome-greeting">Who's voting?</h1><p class="pvb-welcome-privacy">${esc(o)} wants your opinion on ${items.length} piece${items.length===1?"":"s"}.</p><div class="pvb-welcome-thumbs">${th}</div></div><div class="pvb-welcome-footer"><form id="pvb-join-form" class="pvb-join-form"><input type="text" id="pvb-join-name" class="pvb-join-input" placeholder="Your first name" maxlength="30" required autocomplete="given-name"><button type="submit" class="pvb-btn-primary" id="pvb-join-btn">Start Voting</button></form><p class="pvb-join-error" id="pvb-join-error" style="display:none"></p><p class="pvb-welcome-hint">No account needed. It takes a minute.</p></div></div>`;
}

function buildWelcome(){
const o=board.ownerFirstName||"Someone",p=voterFirstName||board.partnerFirstName||"there",i=o.charAt(0).toUpperCase();
const nh=board.note?`<div class="pvb-welcome-note">"${esc(board.note)}"</div>`:"";
const gp=voterCount>1?`<p class="pvb-welcome-privacy-note">Your votes stay private until you finish.</p>`:"";
let th="";const mx=6,sh=Math.min(items.length,mx);
for(let j=0;j<sh;j++)th+=`<img class="pvb-welcome-thumb" src="${esc(items[j].image)}" alt="">`;
if(items.length>mx)th+=`<div class="pvb-welcome-more">+${items.length-mx}</div>`;
return `<header class="pvb-top-bar"><p class="pvb-shop-name">${esc(D.shopName||"")}</p><div class="pvb-owner-avatar">${i}</div></header><div class="pvb-welcome"><div class="pvb-welcome-content"><div class="pvb-welcome-avatar">${i}</div><h1 class="pvb-welcome-greeting">Hi ${esc(p)},</h1><p class="pvb-welcome-privacy">${esc(o)} wants your vote on ${items.length} piece${items.length===1?"":"s"}.</p>${gp}${nh}<div class="pvb-welcome-thumbs">${th}</div></div><div class="pvb-welcome-footer"><button class="pvb-btn-primary" id="pvb-start-btn">Start Voting</button><p class="pvb-welcome-hint">No account needed. It takes a minute.</p></div></div>`;
}

function cardHtml(it,cls){
const so=!it?.available?'<span class="pvb-sold-out">Sold out</span>':"";
const vc=it?.variantTitle?`<span class="pvb-card-variant">${esc(it.variantTitle)}</span>`:"";
const ph=it?.price?`<b class="pvb-card-price">${esc(it.price)}</b>${so}`:(so||"");
return `<div class="pvb-card ${cls}"><div class="pvb-card-image"><img src="${esc(it?.image||"")}" alt="${esc(it?.title||"")}"><div class="pvb-card-label love">Love It</div><div class="pvb-card-label pass">Not For Us</div><div class="pvb-card-label maybe">Maybe</div></div><div class="pvb-card-info"><div class="pvb-card-details"><h2 class="pvb-card-title">${esc(it?.title||"")}</h2><div class="pvb-card-meta">${vc}${ph}</div></div><a href="${esc(it?.url||"#")}" class="pvb-card-info-btn" target="_blank" rel="noopener">i</a></div></div>`;
}

function buildVotingUI(){
const it=items[idx]||items[0];let pr="";for(let i=0;i<items.length;i++)pr+='<div class="pvb-progress-segment"></div>';
const b1=items[idx+1],b2=items[idx+2],i=(board.ownerFirstName||"S").charAt(0).toUpperCase();
const hp=hidePrices&&idx===0?`<div class="pvb-hide-prices-note">${esc(board.ownerFirstName||"The shopper")} chose to keep prices private.</div>`:"";
const bn=board.name?` · ${esc(board.name)}`:"";
return `<header class="pvb-top-bar"><p class="pvb-shop-name">${esc(D.shopName||"")}</p><div class="pvb-owner-avatar">${i}</div></header><div class="pvb-progress-row"><div class="pvb-progress">${pr}</div><span class="pvb-progress-count">${idx+1} of ${items.length}${bn}</span></div>${hp}<div class="pvb-deck"><div class="pvb-card-container">${b2?cardHtml(b2,"behind-2"):""}${b1?cardHtml(b1,"behind-1"):""}${cardHtml(it,"")}</div></div><div class="pvb-undo-row"><button class="pvb-undo" id="pvb-undo">Undo</button></div><div class="pvb-vote-buttons"><button class="pvb-vote-btn" data-vote="pass"><span class="pvb-vote-icon pass"><svg width="24" height="24" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" stroke="#A40713" stroke-width="2.2" stroke-linecap="round"/></svg></span><span class="pvb-vote-label">Not For Us</span></button><button class="pvb-vote-btn" data-vote="maybe"><span class="pvb-vote-icon maybe">?</span><span class="pvb-vote-label">Maybe</span></button><button class="pvb-vote-btn" data-vote="love"><span class="pvb-vote-icon love"><svg width="24" height="24" viewBox="0 0 24 24">${HRT}</svg></span><span class="pvb-vote-label">Love It</span></button></div><div class="pvb-toast"></div>`;
}

function buildGroupSummaryHtml(){
const gsi=groupSummary?.items;
const hasGS=gsi&&gsi.length>0;
if(!hasGS){const lc=items.filter(it=>lv[it.id]==="LOVE").length;return `<p class="pvb-done-count">You loved ${lc} of ${items.length}.</p>`;}
if(groupSummary.votersDone===1&&groupSummary.votersInvited>1)return `<p class="pvb-done-first">You're the first to finish. ${esc(groupSummary.shopperFirstName||"The shopper")} will see everyone's votes.</p>`;
let rh="";for(const si of gsi){const it=items.find(i=>i.id===si.itemId),img=it?.image||"",tc=si.tag[0]==="S"?"split":/Lov/.test(si.tag)?"love":/May/.test(si.tag)?"maybe":"pass";rh+=`<div class="pvb-recap-item"><img class="pvb-recap-thumb" src="${esc(img)}" alt=""><div class="pvb-recap-info"><p class="pvb-recap-title">${esc(si.name||it?.title||"")}</p><p class="pvb-recap-line">${esc(si.line)}</p></div><span class="pvb-recap-tag ${tc}">${esc(si.tag)}</span></div>`;}
return `<p class="pvb-done-count">${groupSummary.votersDone} of ${groupSummary.votersInvited} have voted.</p><div class="pvb-recap-list">${rh}</div>`;
}

function buildDoneScreen(){
const o=board.ownerFirstName||"Someone",p=voterFirstName||board.partnerFirstName||"there",hd=`Thanks, ${esc(p)}. ${esc(o)} has your votes.`,gs=buildGroupSummaryHtml();
const gsi=groupSummary?.items;
const hasGS=gsi&&gsi.length>0;
const isFirstToFinish=groupSummary&&groupSummary.votersDone===1&&groupSummary.votersInvited>1;
let rl="";if(!hasGS||isFirstToFinish){let rh="";for(const it of items){const v=lv[it.id],tc=v==="LOVE"?"love":v==="MAYBE"?"maybe":"pass",tt=v==="LOVE"?"Loved":v==="MAYBE"?"Maybe":"Not For Us",rc=v==="PASS"?" pass-row":"",ph=hidePrices?"":`<p class="pvb-recap-price">${esc(it.price)}</p>`;rh+=`<div class="pvb-recap-item${rc}"><img class="pvb-recap-thumb" src="${esc(it.image)}" alt=""><div class="pvb-recap-info"><p class="pvb-recap-title">${esc(it.title)}</p>${ph}</div><span class="pvb-recap-tag ${tc}">${tt}</span></div>`;}rl=`<div class="pvb-recap-list">${rh}</div>`;}
const avk=voterAvatarKey,avbg=(avk&&avatarBg&&avatarBg[avk])||"#82736C";
let avEl;
if(!avk||!avatarBg||!avatarBg[avk]){
const avInit=(voterFirstName||board.partnerFirstName||"?").charAt(0).toUpperCase();
avEl=`<span class="pvb-done-av" style="background:${avbg};width:64px;height:64px;border-radius:999px;display:flex;align-items:center;justify-content:center;font-size:32px;font-weight:600;color:#FEFBF6">${esc(avInit)}</span>`;
}else{
avEl=`<span class="pvb-done-av" style="background:${avbg};width:64px;height:64px;border-radius:999px;display:flex;align-items:flex-end;justify-content:center"><svg viewBox="0 0 96 96" width="64" height="64" aria-hidden="true" style="border-radius:999px;display:block"><use href="#pvb-av-${avk}"/></svg></span>`;
}
return `<header class="pvb-top-bar"><p class="pvb-shop-name">${esc(D.shopName||"")}</p></header><div class="pvb-done">${avEl}<h1 class="pvb-done-headline">${hd}</h1>${gs}${rl}<a href="${esc(shopUrl||"/")}" class="pvb-btn-primary">Shop ${esc(D.shopName||"")}</a></div>`;
}

function renderGroupJoin(){
pg.innerHTML=buildGroupJoin();const f=document.getElementById("pvb-join-form"),n=document.getElementById("pvb-join-name"),b=document.getElementById("pvb-join-btn"),e=document.getElementById("pvb-join-error");
f?.addEventListener("submit",async ev=>{ev.preventDefault();const nm=n.value.trim();if(!nm){e.textContent="Please enter your first name.";e.style.display="";return;}b.disabled=true;b.textContent="Joining...";e.style.display="none";try{const r=await fetch(`${proxyPath}/api/boards/${groupToken}/join`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({firstName:nm})});const d=await r.json();if(!r.ok){if(d.error?.code==="board_full")e.textContent=d.error.message||"This board already has 5 voters.";else if(d.error?.code==="rate_limited")e.textContent=d.error.message||"Too many tries. Try again in a few minutes.";else e.textContent="Couldn't join. Try again.";e.style.display="";b.disabled=false;b.textContent="Start Voting";return;}voterToken=d.voterToken;voterFirstName=nm;voterAvatarKey=d.avatarKey;saveVT(voterToken);board.partnerFirstName=nm;renderWelcome();}catch(x){e.textContent="Connection error. Try again.";e.style.display="";b.disabled=false;b.textContent="Start Voting";}});
}

function renderWelcome(){pg.innerHTML=buildWelcome();document.getElementById("pvb-start-btn")?.addEventListener("click",startVoting);}
function startVoting(){pg.innerHTML=buildVotingUI();cacheEls();updProg();setupDrag();setupBtns();document.addEventListener("keydown",handleKey);}
function cacheEls(){cc=document.querySelector(".pvb-card-container");tc=cc?.querySelector(".pvb-card:not(.behind-1):not(.behind-2)");ub=document.getElementById("pvb-undo");ts=document.querySelector(".pvb-toast");}
function updProg(){document.querySelectorAll(".pvb-progress-segment").forEach((s,i)=>s.classList.toggle("done",i<idx||!!lv[items[i]?.id]));const c=document.querySelector(".pvb-progress-count"),bn=board.name?` · ${board.name}`:"";if(c)c.textContent=`${idx+1} of ${items.length}${bn}`;}
function toast(m){if(!ts)return;ts.textContent=m;ts.classList.add("visible");setTimeout(()=>ts.classList.remove("visible"),2500);}
function showUndo(){clearTimeout(ut);if(ub){ub.classList.add("visible");ut=setTimeout(()=>ub.classList.remove("visible"),4e3);}}
function hideUndo(){clearTimeout(ut);if(ub)ub.classList.remove("visible");}
function showDone(){pg.innerHTML=buildDoneScreen();if(sk)try{localStorage.removeItem(sk);}catch(e){/* ignore */}}

function buildRS(v,it,last){
const rs=v==="PASS"?PR:MR,t=v==="PASS"?(copy.passReasonTitle||"What's not right?"):(copy.maybeReasonTitle||"What would make it a yes?"),h=copy.reasonHint||"Optional.",oh=copy.otherReasonHint||"{shopper} and TOV will see what you write.",o=board.ownerFirstName||"Someone",pn=it.title?.length>50?it.title.slice(0,47)+"...":it.title||"";
let ch="";for(const[k,l]of Object.entries(rs))ch+=`<button class="rs-ch" data-r="${k}" aria-pressed="false">${esc(l)}</button>`;
return `<div class="rs-o" role="dialog" aria-modal="true"><div class="rs-s"><div class="rs-handle"></div><div class="rs-header"><h2 class="rs-t" tabindex="-1">${esc(t)}</h2><p class="rs-pn">${esc(pn)}</p></div><p class="rs-h">${esc(h.replace("{shopper}",o))}</p><div class="rs-c">${ch}</div><div class="rs-tf" style="display:none"><input type="text" class="rs-ti" maxlength="120" placeholder="Tell ${esc(o)} in a few words"><span class="rs-tc">0/120</span><p class="rs-th">${esc(oh.replace("{shopper}",o))}</p></div><div class="rs-b"><button class="rs-sk" data-a="skip">Skip</button><button class="rs-nx" data-a="next">${last?"Finish":"Next Piece"}</button></div></div></div>`;
}

function showRS(v,it,last,pendingVote,cb){
const dv=document.createElement("div");dv.innerHTML=buildRS(v,it,last);const ol=dv.firstChild;pg.appendChild(ol);
let pk=null,pt="";const ch=ol.querySelectorAll(".rs-ch"),tw=ol.querySelector(".rs-tf"),ti=ol.querySelector(".rs-ti"),tc=ol.querySelector(".rs-tc");
ch.forEach(c=>c.addEventListener("click",e=>{const r=e.target.dataset.r;ch.forEach(x=>x.setAttribute("aria-pressed",x.dataset.r===r?"true":"false"));pk=r;if(r==="other"){tw.style.display="";ti.focus();}else{tw.style.display="none";pt="";}}));
if(ti){ti.addEventListener("input",()=>{pt=ti.value;tc.textContent=`${pt.length}/120`;});ti.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();ol.querySelector(".rs-nx")?.click();}});}
const cl=()=>{ol.remove();document.removeEventListener("keydown",onK);};
ol.querySelector(".rs-b").addEventListener("click",e=>{const a=e.target.dataset.a;if(!a)return;cl();if(a==="next"&&pk){(pendingVote||Promise.resolve()).then(()=>sendR(it.id,v,pk,pk==="other"?pt:null));}cb();});
const onK=e=>{if(e.key==="Escape"){e.preventDefault();cl();cb();}};document.addEventListener("keydown",onK);ol.querySelector(".rs-t")?.focus();
}

function sendR(iid,v,r,rt){const b={itemId:iid,verdict:v,reason:r};if(rt)b.reasonText=rt;fetch(`${proxyPath}/api/boards/${voterToken||board.shareToken}/votes`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)}).catch(()=>{});}

let pid=null,sx=0,sy=0,dx=0,dy=0,lx=0,ly=0,lt=0,vx=0,vy=0,raf=null;
function setupDrag(){if(!tc)return;tc.addEventListener("pointerdown",onDown);}
function onDown(e){if(busy||e.button!==0||e.target.closest("a"))return;pid=e.pointerId;tc.setPointerCapture(pid);sx=e.clientX;sy=e.clientY;lx=e.clientX;ly=e.clientY;lt=Date.now();dx=0;dy=0;vx=0;vy=0;tc.classList.add("dragging");tc.addEventListener("pointermove",onMove);tc.addEventListener("pointerup",onUp);tc.addEventListener("pointercancel",onUp);}
function onMove(e){if(e.pointerId!==pid)return;const n=Date.now(),dt=n-lt;dx=e.clientX-sx;dy=e.clientY-sy;if(dt>0){vx=(e.clientX-lx)/dt;vy=(e.clientY-ly)/dt;}lx=e.clientX;ly=e.clientY;lt=n;if(raf===null)raf=requestAnimationFrame(updCard);}
function updCard(){raf=null;if(!tc)return;tc.style.transform=`translate(${dx}px,${Math.min(0,dy)}px) rotate(${dx*.06}deg)`;const cW=tc.offsetWidth||320,cH=tc.offsetHeight||420,nX=Math.abs(dx)/(cW*CX),nY=Math.abs(dy)/(cH*CY),ll=tc.querySelector(".pvb-card-label.love"),pl=tc.querySelector(".pvb-card-label.pass"),ml=tc.querySelector(".pvb-card-label.maybe");if(dx>20){if(ll)ll.style.opacity=Math.min(1,nX);if(pl)pl.style.opacity=0;if(ml)ml.style.opacity=0;}else if(dx<-20){if(pl)pl.style.opacity=Math.min(1,nX);if(ll)ll.style.opacity=0;if(ml)ml.style.opacity=0;}else if(dy<-20){if(ml)ml.style.opacity=Math.min(1,nY);if(ll)ll.style.opacity=0;if(pl)pl.style.opacity=0;}else{if(ll)ll.style.opacity=0;if(pl)pl.style.opacity=0;if(ml)ml.style.opacity=0;}hlBtn(dx>20?"love":dx<-20?"pass":dy<-20?"maybe":null);}
function hlBtn(w){document.querySelectorAll(".pvb-vote-btn").forEach(b=>b.classList.toggle("highlight",b.dataset.vote===w));}
function onUp(e){if(e.pointerId!==pid)return;tc.releasePointerCapture(pid);tc.removeEventListener("pointermove",onMove);tc.removeEventListener("pointerup",onUp);tc.removeEventListener("pointercancel",onUp);tc.classList.remove("dragging");pid=null;hlBtn(null);const cW=tc.offsetWidth||320,cH=tc.offsetHeight||420,tX=cW*CX,tY=cH*CY;let v=null;if(dx>tX||vx>CV)v="LOVE";else if(dx<-tX||vx<-CV)v="PASS";else if(dy<-tY||vy<-CV)v="MAYBE";if(v)vote(v);else springBack();}
function springBack(){if(!tc)return;tc.classList.add("spring-back");tc.style.transform="";tc.querySelectorAll(".pvb-card-label").forEach(l=>l.style.opacity=0);setTimeout(()=>tc?.classList.remove("spring-back"),300);}

async function vote(v){
if(busy)return;busy=true;setBD(true);hideUndo();
const it=items[idx];if(!it){busy=false;setBD(false);return;}
const vi=idx;lv[it.id]=v;save();vh.push({i:vi,id:it.id});pv.add(it.id);
const dr=v==="LOVE"?"right":v==="PASS"?"left":"up",ni=idx+1,last=ni>=items.length,sr=askReasons&&(v==="PASS"||v==="MAYBE"),rq=submit(it.id,v,null);
if(last){
// Hold card for reason sheet if needed
const finishFn=async()=>{
const r=await rq;
pv.delete(it.id);
setBD(false);
if(r.ok||r.locked){
if(r.groupSummary)groupSummary=r.groupSummary;
showDone();
busy=false;
return;
}
delete lv[it.id];vh.pop();save();idx=vi;rebuild();busy=false;
};
if(sr){
// Show reason sheet first, THEN animate exit
showRS(v,it,true,rq,()=>{animateExit(dr,finishFn);});
}else{
animateExit(dr,finishFn);
}
}
else{
const go=()=>{idx=ni;promote();busy=false;setBD(false);};
if(sr){
// Hold card: show reason sheet first, THEN animate and advance
showRS(v,it,false,rq,()=>{
animateExit(dr,go);
rq.then(r=>{pv.delete(it.id);if(r.locked){showDone();return;}if(r.ok){if(vh[vh.length-1]?.id===it.id)showUndo();return;}delete lv[it.id];const hi=vh.findIndex(h=>h.id===it.id);if(hi>=0)vh.splice(hi,1);save();idx=vi;rebuild();if(!r.rl)toast("Vote didn't save. Try again.");}).catch(()=>{});
});
}else{
animateExit(dr,go);
rq.then(r=>{pv.delete(it.id);if(r.locked){showDone();return;}if(r.ok){if(vh[vh.length-1]?.id===it.id)showUndo();return;}delete lv[it.id];const hi=vh.findIndex(h=>h.id===it.id);if(hi>=0)vh.splice(hi,1);save();idx=vi;rebuild();if(!r.rl)toast("Vote didn't save. Try again.");}).catch(()=>{});
}
}
}
function setBD(d){document.querySelectorAll(".pvb-vote-btn").forEach(b=>b.disabled=d);}
function animateExit(dr,cb){if(!tc){cb();return;}if(rm){tc.style.opacity="0";setTimeout(cb,50);return;}const a=dr==="right"?15:dr==="left"?-15:0,tx=dr==="right"?400:dr==="left"?-400:0,ty=dr==="up"?-400:0;tc.classList.add("exit");tc.style.transform=`translate(${tx}px,${ty}px) rotate(${a}deg)`;tc.style.opacity="0";setTimeout(cb,250);}
function promote(){if(!cc)return;const ex=cc.querySelector(".pvb-card.exit");if(ex)ex.remove();const b1=cc.querySelector(".pvb-card.behind-1");if(b1){b1.classList.remove("behind-1");b1.style.transform="";b1.style.opacity="";}const b2=cc.querySelector(".pvb-card.behind-2");if(b2){b2.classList.remove("behind-2");b2.classList.add("behind-1");}const ni=idx+2;if(ni<items.length){const nc=document.createElement("div");nc.className="pvb-card behind-2";nc.innerHTML=cardInner(items[ni]);cc.insertBefore(nc,cc.firstChild);}tc=cc.querySelector(".pvb-card:not(.behind-1):not(.behind-2)");updProg();setupDrag();}
function cardInner(it){const so=!it?.available?'<span class="pvb-sold-out">Sold out</span>':"",vc=it?.variantTitle?`<span class="pvb-card-variant">${esc(it.variantTitle)}</span>`:"",ph=it?.price?`<b class="pvb-card-price">${esc(it.price)}</b>${so}`:(so||"");return `<div class="pvb-card-image"><img src="${esc(it?.image||"")}" alt="${esc(it?.title||"")}"><div class="pvb-card-label love">Love It</div><div class="pvb-card-label pass">Not For Us</div><div class="pvb-card-label maybe">Maybe</div></div><div class="pvb-card-info"><div class="pvb-card-details"><h2 class="pvb-card-title">${esc(it?.title||"")}</h2><div class="pvb-card-meta">${vc}${ph}</div></div><a href="${esc(it?.url||"#")}" class="pvb-card-info-btn" target="_blank" rel="noopener">i</a></div>`;}
function rebuild(){if(!cc)return;const it=items[idx],b1=items[idx+1],b2=items[idx+2];cc.innerHTML=`${b2?cardHtml(b2,"behind-2"):""}${b1?cardHtml(b1,"behind-1"):""}${cardHtml(it,"")}`;tc=cc.querySelector(".pvb-card:not(.behind-1):not(.behind-2)");updProg();setupDrag();}
async function submit(iid,v,r){const tk=voterToken||board.shareToken,url=`${proxyPath}/api/boards/${tk}/votes`;try{const b={itemId:iid,verdict:v};if(r)b.reason=r;const rs=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)}),d=await rs.json();if(!rs.ok){if(d.error?.code==="locked")return{ok:false,locked:true};if(d.error?.code==="rate_limited"){toast("Too many votes. Try again.");return{ok:false,rl:true};}toast("Something went wrong.");return{ok:false};}return d.complete?{ok:true,complete:true,groupSummary:d.groupSummary}:{ok:true};}catch(e){toast("Connection error.");return{ok:false};}}
function undo(){if(vh.length===0||busy)return;const p=vh[vh.length-1];if(pv.has(p.id))return;hideUndo();vh.pop();delete lv[p.id];save();idx=p.i;rebuild();}
function setupBtns(){document.querySelector('[data-vote="love"]')?.addEventListener("click",()=>vote("LOVE"));document.querySelector('[data-vote="maybe"]')?.addEventListener("click",()=>vote("MAYBE"));document.querySelector('[data-vote="pass"]')?.addEventListener("click",()=>vote("PASS"));ub?.addEventListener("click",undo);}
function handleKey(e){if(e.target.closest("input,textarea,a,button"))return;if(e.key==="ArrowRight"){e.preventDefault();vote("LOVE");}else if(e.key==="ArrowLeft"){e.preventDefault();vote("PASS");}else if(e.key==="ArrowUp"){e.preventDefault();vote("MAYBE");}else if(e.key==="Backspace"){e.preventDefault();undo();}}
function init(){pg=document.querySelector(".pvb-vote-page");if(!pg)return;if(groupMode){const st=loadVT();if(st)voterToken=st;}load();initSrv();idx=findUv();if(idx>=items.length){showDone();return;}if(groupMode&&!voterToken){renderGroupJoin();return;}renderWelcome();}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();
