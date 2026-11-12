/**
 * Vote page client-side logic - Design pass.
 * Vanilla JS, Pointer Events for drag, no dependencies.
 */
(function(){
"use strict";
const dataEl=document.getElementById("pvb-data");
if(!dataEl)return;
let DATA;
try{
const enc=dataEl.getAttribute("data-encoding");
if(enc==="base64"){
const bin=atob(dataEl.textContent.trim());
DATA=JSON.parse(new TextDecoder().decode(Uint8Array.from(bin,c=>c.charCodeAt(0))));
}else DATA=JSON.parse(dataEl.textContent);
}catch(e){
console.error("Failed to parse pvb-data",e);
const p=document.querySelector(".pvb-vote-page");
if(p)p.innerHTML='<div class="pvb-error-page"><h1 class="pvb-error-headline">Something went wrong</h1><p class="pvb-error-body">Reload the page to try again.</p></div>';
return;
}
const{board,items,votes,copy,shopUrl,proxyPath}=DATA;
if(!board||!items||items.length===0)return;
let currentIndex=0,localVotes={},voteHistory=[],isVoting=false,undoTimer=null,pendingVotes=new Set();
let page,cardContainer,topCard,undoBtn,toast;
const COMMIT_X=0.28,COMMIT_Y=0.22,COMMIT_V=0.6;
const prefersRM=window.matchMedia("(prefers-reduced-motion:reduce)").matches;
const storageKey=DATA.storageKey?`pvb:vote:v1:${DATA.storageKey}`:null;

function loadProgress(){if(!storageKey)return;try{const s=localStorage.getItem(storageKey);if(s)localVotes=JSON.parse(s).votes||{};}catch(e){/* ignore */}}
function saveProgress(){if(!storageKey)return;try{localStorage.setItem(storageKey,JSON.stringify({votes:localVotes}));}catch(e){/* ignore */}}
function initFromServer(){if(votes&&Array.isArray(votes))for(const v of votes)if(v.boardItemId&&v.verdict)localVotes[v.boardItemId]=v.verdict;saveProgress();}
function findFirstUnvoted(){for(let i=0;i<items.length;i++)if(!localVotes[items[i].id])return i;return items.length;}
function esc(s){return s?s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"):"";}

function buildWelcome(){
const owner=board.ownerFirstName||"Someone",partner=board.partnerFirstName||"there",init=owner.charAt(0).toUpperCase();
const noteHtml=board.note?`<div class="pvb-welcome-note">"${esc(board.note)}"</div>`:"";
let thumbs="";
const max=6,show=Math.min(items.length,max);
for(let i=0;i<show;i++)thumbs+=`<img class="pvb-welcome-thumb" src="${esc(items[i].image)}" alt="">`;
if(items.length>max)thumbs+=`<div class="pvb-welcome-more">+${items.length-max}</div>`;
return `<header class="pvb-top-bar"><p class="pvb-shop-name">${esc(DATA.shopName||"")}</p><div class="pvb-owner-avatar">${init}</div></header>
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
<div class="pvb-card-label love">Love It</div><div class="pvb-card-label pass">Not For Us</div><div class="pvb-card-label maybe">Maybe</div>
</div><div class="pvb-card-info"><div class="pvb-card-info-row"><h2 class="pvb-card-title">${esc(it?.title||"")}</h2></div>
<div class="pvb-card-price-row"><p class="pvb-card-price">${esc(it?.price||"")}${sold}</p>
<a href="${esc(it?.url||"#")}" class="pvb-card-info-btn" target="_blank" rel="noopener" aria-label="View details">
<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
</a></div></div></div>`;
}

function buildVotingUI(){
const item=items[currentIndex]||items[0];
let prog="";for(let i=0;i<items.length;i++)prog+='<div class="pvb-progress-segment"></div>';
const b1=items[currentIndex+1],b2=items[currentIndex+2];
const init=(board.ownerFirstName||"S").charAt(0).toUpperCase();
return `<header class="pvb-top-bar"><p class="pvb-shop-name">${esc(DATA.shopName||"")}</p><div class="pvb-owner-avatar">${init}</div></header>
<div class="pvb-progress-row"><div class="pvb-progress">${prog}</div><span class="pvb-progress-count">${currentIndex+1} of ${items.length}</span></div>
<div class="pvb-deck"><div class="pvb-card-container">${b2?cardHtml(b2,"behind-2"):""}${b1?cardHtml(b1,"behind-1"):""}${cardHtml(item,"")}</div></div>
<div class="pvb-undo-row"><button class="pvb-undo" id="pvb-undo">Undo</button></div>
<div class="pvb-vote-buttons">
<button class="pvb-vote-btn" data-vote="pass" aria-label="${esc(copy.stampPass||"Pass")}"><span class="pvb-vote-icon pass"><svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="#A40713" stroke-width="2.5" stroke-linecap="round"/></svg></span><span class="pvb-vote-label">${esc(copy.stampPass||"Pass")}</span></button>
<button class="pvb-vote-btn" data-vote="maybe" aria-label="${esc(copy.stampMaybe||"Maybe")}"><span class="pvb-vote-icon maybe"><svg width="18" height="18" viewBox="0 0 24 24" fill="none"><text x="12" y="18" text-anchor="middle" fill="#82736C" font-size="20" font-weight="600">?</text></svg></span><span class="pvb-vote-label">${esc(copy.stampMaybe||"Maybe")}</span></button>
<button class="pvb-vote-btn" data-vote="love" aria-label="${esc(copy.stampLove||"Love")}"><span class="pvb-vote-icon love"><svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="#F9D2D2"/></svg></span><span class="pvb-vote-label">${esc(copy.stampLove||"Love")}</span></button>
</div>
<div class="pvb-toast"></div>`;
}

function buildDoneScreen(){
let recapHtml="";
for(const it of items){
const v=localVotes[it.id];
const tc=v==="LOVE"?"love":v==="MAYBE"?"maybe":"pass";
const tt=v==="LOVE"?"Loved":v==="MAYBE"?"Maybe":"Not For Us";
recapHtml+=`<div class="pvb-recap-item"><img class="pvb-recap-thumb" src="${esc(it.image)}" alt=""><div class="pvb-recap-info"><p class="pvb-recap-title">${esc(it.title)}</p><p class="pvb-recap-price">${esc(it.price)}</p></div><span class="pvb-recap-tag ${tc}">${tt}</span></div>`;
}
const loveCount=items.filter(it=>localVotes[it.id]==="LOVE").length;
return `<header class="pvb-top-bar"><p class="pvb-shop-name">${esc(DATA.shopName||"")}</p></header>
<div class="pvb-done"><div class="pvb-done-heart"><svg width="32" height="32" viewBox="0 0 24 24" fill="none"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="#F9D2D2"/></svg></div>
<h1 class="pvb-done-headline">${esc(copy.thanksHeadline||"Thanks for voting")}</h1>
<p class="pvb-done-body">${esc(copy.thanksBody||"We'll let them know what you thought.")}</p>
<p class="pvb-done-count">You loved ${loveCount} of ${items.length}.</p>
<div class="pvb-recap-list">${recapHtml}</div>
<a href="${esc(shopUrl||"/")}" class="pvb-btn-primary">Shop ${esc(DATA.shopName||"")}</a></div>`;
}

function renderWelcome(){page.innerHTML=buildWelcome();document.getElementById("pvb-start-btn")?.addEventListener("click",startVoting);}
function startVoting(){page.innerHTML=buildVotingUI();cacheEls();updateProgress();setupDrag();setupButtons();document.addEventListener("keydown",handleKey);}
function cacheEls(){cardContainer=document.querySelector(".pvb-card-container");topCard=cardContainer?.querySelector(".pvb-card:not(.behind-1):not(.behind-2)");undoBtn=document.getElementById("pvb-undo");toast=document.querySelector(".pvb-toast");}
function updateProgress(){document.querySelectorAll(".pvb-progress-segment").forEach((s,i)=>s.classList.toggle("done",i<currentIndex||!!localVotes[items[i]?.id]));const c=document.querySelector(".pvb-progress-count");if(c)c.textContent=`${currentIndex+1} of ${items.length}`;}
function showToast(msg){if(!toast)return;toast.textContent=msg;toast.classList.add("visible");setTimeout(()=>toast.classList.remove("visible"),2500);}
function showUndo(){clearTimeout(undoTimer);if(undoBtn){undoBtn.classList.add("visible");undoTimer=setTimeout(()=>undoBtn.classList.remove("visible"),4000);}}
function hideUndo(){clearTimeout(undoTimer);if(undoBtn)undoBtn.classList.remove("visible");}
function showDone(){page.innerHTML=buildDoneScreen();if(storageKey)try{localStorage.removeItem(storageKey);}catch(e){/* ignore */}}

let dragPid=null,dragSX=0,dragSY=0,dragST=0,dx=0,dy=0,lastX=0,lastY=0,lastT=0,velX=0,velY=0,rafId=null;
function setupDrag(){if(!topCard)return;topCard.addEventListener("pointerdown",onPtrDown);}
function onPtrDown(e){
if(isVoting||e.button!==0||e.target.closest("a"))return;
dragPid=e.pointerId;topCard.setPointerCapture(e.pointerId);
dragSX=e.clientX;dragSY=e.clientY;dragST=Date.now();lastX=e.clientX;lastY=e.clientY;lastT=dragST;dx=0;dy=0;velX=0;velY=0;
topCard.classList.add("dragging");
topCard.addEventListener("pointermove",onPtrMove);
topCard.addEventListener("pointerup",onPtrUp);
topCard.addEventListener("pointercancel",onPtrUp);
}
function onPtrMove(e){
if(e.pointerId!==dragPid)return;
const now=Date.now(),dt=now-lastT;
dx=e.clientX-dragSX;dy=e.clientY-dragSY;
if(dt>0){velX=(e.clientX-lastX)/dt;velY=(e.clientY-lastY)/dt;}
lastX=e.clientX;lastY=e.clientY;lastT=now;
if(rafId===null)rafId=requestAnimationFrame(updateCard);
}
function updateCard(){
rafId=null;if(!topCard)return;
topCard.style.transform=`translate(${dx}px,${Math.min(0,dy)}px) rotate(${dx*0.06}deg)`;
const cW=topCard.offsetWidth||320,cH=topCard.offsetHeight||420;
const nX=Math.abs(dx)/(cW*COMMIT_X),nY=Math.abs(dy)/(cH*COMMIT_Y);
const lLbl=topCard.querySelector(".pvb-card-label.love"),pLbl=topCard.querySelector(".pvb-card-label.pass"),mLbl=topCard.querySelector(".pvb-card-label.maybe");
if(dx>20){if(lLbl)lLbl.style.opacity=Math.min(1,nX);if(pLbl)pLbl.style.opacity=0;if(mLbl)mLbl.style.opacity=0;}
else if(dx<-20){if(pLbl)pLbl.style.opacity=Math.min(1,nX);if(lLbl)lLbl.style.opacity=0;if(mLbl)mLbl.style.opacity=0;}
else if(dy<-20){if(mLbl)mLbl.style.opacity=Math.min(1,nY);if(lLbl)lLbl.style.opacity=0;if(pLbl)pLbl.style.opacity=0;}
else{if(lLbl)lLbl.style.opacity=0;if(pLbl)pLbl.style.opacity=0;if(mLbl)mLbl.style.opacity=0;}
hlBtn(dx>20?"love":dx<-20?"pass":dy<-20?"maybe":null);
}
function hlBtn(w){document.querySelectorAll(".pvb-vote-btn").forEach(b=>b.classList.toggle("highlight",b.dataset.vote===w));}
function onPtrUp(e){
if(e.pointerId!==dragPid)return;
topCard.releasePointerCapture(e.pointerId);
topCard.removeEventListener("pointermove",onPtrMove);
topCard.removeEventListener("pointerup",onPtrUp);
topCard.removeEventListener("pointercancel",onPtrUp);
topCard.classList.remove("dragging");dragPid=null;hlBtn(null);
const cW=topCard.offsetWidth||320,cH=topCard.offsetHeight||420;
const tX=cW*COMMIT_X,tY=cH*COMMIT_Y;
let verdict=null;
if(dx>tX||velX>COMMIT_V)verdict="LOVE";
else if(dx<-tX||velX<-COMMIT_V)verdict="PASS";
else if(dy<-tY||velY<-COMMIT_V)verdict="MAYBE";
if(verdict)vote(verdict);else springBack();
}
function springBack(){if(!topCard)return;topCard.classList.add("spring-back");topCard.style.transform="";topCard.querySelectorAll(".pvb-card-label").forEach(l=>l.style.opacity=0);setTimeout(()=>topCard?.classList.remove("spring-back"),300);}

async function vote(verdict){
if(isVoting)return;isVoting=true;setBtnsDisabled(true);hideUndo();
const item=items[currentIndex];if(!item){isVoting=false;setBtnsDisabled(false);return;}
const votedIdx=currentIndex;
localVotes[item.id]=verdict;saveProgress();voteHistory.push({index:votedIdx,itemId:item.id});
pendingVotes.add(item.id);
const dir=verdict==="LOVE"?"right":verdict==="PASS"?"left":"up";
currentIndex++;
const isLast=findFirstUnvoted()>=items.length;
const reqPromise=submitVote(item.id,verdict);
if(isLast){
animateExit(dir,async()=>{
const res=await reqPromise;
pendingVotes.delete(item.id);
setBtnsDisabled(false);
if(res.ok||res.locked){showDone();isVoting=false;return;}
delete localVotes[item.id];voteHistory.pop();saveProgress();currentIndex=votedIdx;rebuildCards();isVoting=false;
});
}else{
animateExit(dir,()=>{promoteCards();isVoting=false;setBtnsDisabled(false);});
reqPromise.then(res=>{
pendingVotes.delete(item.id);
if(res.locked){showDone();return;}
if(res.ok){if(voteHistory[voteHistory.length-1]?.itemId===item.id)showUndo();return;}
delete localVotes[item.id];
const hIdx=voteHistory.findIndex(h=>h.itemId===item.id);
if(hIdx>=0)voteHistory.splice(hIdx,1);
saveProgress();currentIndex=votedIdx;rebuildCards();
if(!res.rateLimited)showToast("That vote didn't save. Please vote again.");
}).catch(()=>{});
}
}
function setBtnsDisabled(dis){document.querySelectorAll(".pvb-vote-btn").forEach(b=>b.disabled=dis);}
function animateExit(dir,cb){
if(!topCard){cb();return;}
if(prefersRM){topCard.style.opacity="0";setTimeout(cb,50);return;}
const angle=dir==="right"?15:dir==="left"?-15:0;
const tx=dir==="right"?400:dir==="left"?-400:0;
const ty=dir==="up"?-400:0;
topCard.classList.add("exit");topCard.style.transform=`translate(${tx}px,${ty}px) rotate(${angle}deg)`;topCard.style.opacity="0";setTimeout(cb,250);
}
function promoteCards(){
if(!cardContainer)return;
// Remove exited top card
const exitedCard=cardContainer.querySelector(".pvb-card.exit");
if(exitedCard)exitedCard.remove();
// Promote behind-1 to top
const b1=cardContainer.querySelector(".pvb-card.behind-1");
if(b1){b1.classList.remove("behind-1");b1.style.transform="";b1.style.opacity="";}
// Promote behind-2 to behind-1
const b2=cardContainer.querySelector(".pvb-card.behind-2");
if(b2){b2.classList.remove("behind-2");b2.classList.add("behind-1");}
// Add new card at back if exists
const newIdx=currentIndex+2;
if(newIdx<items.length){
const newCard=document.createElement("div");
newCard.className="pvb-card behind-2";
newCard.innerHTML=cardInner(items[newIdx]);
cardContainer.insertBefore(newCard,cardContainer.firstChild);
}
topCard=cardContainer.querySelector(".pvb-card:not(.behind-1):not(.behind-2)");
updateProgress();setupDrag();
}
function cardInner(it){
const sold=!it?.available?'<span class="pvb-sold-out">Sold out</span>':"";
return `<div class="pvb-card-image">
<img src="${esc(it?.image||"")}" alt="${esc(it?.title||"")}">
<div class="pvb-card-label love">Love It</div><div class="pvb-card-label pass">Not For Us</div><div class="pvb-card-label maybe">Maybe</div>
</div><div class="pvb-card-info"><div class="pvb-card-info-row"><h2 class="pvb-card-title">${esc(it?.title||"")}</h2></div>
<div class="pvb-card-price-row"><p class="pvb-card-price">${esc(it?.price||"")}${sold}</p>
<a href="${esc(it?.url||"#")}" class="pvb-card-info-btn" target="_blank" rel="noopener" aria-label="View details">
<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
</a></div></div>`;
}
function rebuildCards(){
if(!cardContainer)return;
const item=items[currentIndex],b1=items[currentIndex+1],b2=items[currentIndex+2];
cardContainer.innerHTML=`${b2?cardHtml(b2,"behind-2"):""}${b1?cardHtml(b1,"behind-1"):""}${cardHtml(item,"")}`;
topCard=cardContainer.querySelector(".pvb-card:not(.behind-1):not(.behind-2)");updateProgress();setupDrag();
}
async function submitVote(itemId,verdict){
const url=`${proxyPath}/api/boards/${board.shareToken}/votes`;
try{
const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({itemId,verdict})});
const d=await r.json();
if(!r.ok){if(d.error?.code==="locked")return{ok:false,locked:true};if(d.error?.code==="rate_limited"){showToast("Too many votes. Try again in a minute.");return{ok:false,rateLimited:true};}showToast("Something went wrong. Please try again.");return{ok:false};}
if(d.complete)return{ok:true,complete:true};
return{ok:true};
}catch(e){showToast("Connection error. Please try again.");return{ok:false};}
}
function undo(){if(voteHistory.length===0||isVoting)return;const prev=voteHistory[voteHistory.length-1];if(pendingVotes.has(prev.itemId))return;hideUndo();voteHistory.pop();delete localVotes[prev.itemId];saveProgress();currentIndex=prev.index;rebuildCards();}
function setupButtons(){document.querySelector('[data-vote="love"]')?.addEventListener("click",()=>vote("LOVE"));document.querySelector('[data-vote="maybe"]')?.addEventListener("click",()=>vote("MAYBE"));document.querySelector('[data-vote="pass"]')?.addEventListener("click",()=>vote("PASS"));undoBtn?.addEventListener("click",undo);}
function handleKey(e){if(e.target.closest("input,textarea,a,button"))return;if(e.key==="ArrowRight"){e.preventDefault();vote("LOVE");}else if(e.key==="ArrowLeft"){e.preventDefault();vote("PASS");}else if(e.key==="ArrowUp"){e.preventDefault();vote("MAYBE");}else if(e.key==="Backspace"){e.preventDefault();undo();}}

function init(){
page=document.querySelector(".pvb-vote-page");if(!page)return;
loadProgress();initFromServer();currentIndex=findFirstUnvoted();
if(currentIndex>=items.length){showDone();return;}
renderWelcome();
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();
