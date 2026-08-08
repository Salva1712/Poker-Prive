
const socket=io();
let state=null, priv={cards:[],myId:null};

const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
function toast(t){const e=$("#toast");e.textContent=t;e.style.display="block";setTimeout(()=>e.style.display="none",2600)}
function card(c,back=false){if(back)return `<div class="playingCard back">X</div>`;const red=c.s==="♥"||c.s==="♦";return `<div class="playingCard ${red?"red":""}">${c.r}${c.s}</div>`}
function me(){return state?.players.find(p=>p.id===priv.myId)}
function showGame(){ $("#home").classList.add("hidden");$("#game").classList.remove("hidden") }

$("#joinOpenBtn").onclick=()=>$("#joinBox").classList.toggle("hidden");
$("#createBtn").onclick=()=>{const name=$("#name").value.trim();if(!name)return toast("Entre ton prénom.");socket.emit("createRoom",{name})};
$("#joinBtn").onclick=()=>{const name=$("#name").value.trim(),roomCode=$("#roomCode").value.trim();if(!name||!roomCode)return toast("Entre ton prénom et le code.");socket.emit("joinRoom",{name,roomCode})};
$("#copyCode").onclick=()=>navigator.clipboard?.writeText(state?.code||"");
$("#saveBlinds").onclick=()=>socket.emit("setBlinds",{smallBlind:+$("#sb").value,bigBlind:+$("#bb").value});
$("#startHand").onclick=()=>socket.emit("startHand");
$("#sendChat").onclick=sendChat; $("#chatText").addEventListener("keydown",e=>{if(e.key==="Enter")sendChat()});
function sendChat(){const v=$("#chatText").value.trim();if(v){socket.emit("chat",v);$("#chatText").value=""}}

$$("[data-act]").forEach(b=>b.onclick=()=> {
  const type=b.dataset.act, amount=type==="raise"?+$("#raiseAmount").value:undefined;
  socket.emit("action",{type,amount});
});
socket.on("errorMsg",toast);
socket.on("chat",m=>{const d=document.createElement("div");d.className="chatLine";d.innerHTML=`<b>${esc(m.name)}</b> ${esc(m.text)}`;$("#chatLog").appendChild(d);$("#chatLog").scrollTop=99999});
socket.on("private",p=>{priv=p;render()});
socket.on("state",s=>{state=s;showGame();render()});

function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function render(){
  if(!state)return;
  $("#code").textContent=state.code;
  $("#pot").textContent=state.pot;
  $("#phase").textContent=state.phase==="waiting"?"En attente":state.phase;
  $("#status").textContent=state.message||"";
  $("#community").innerHTML=state.community.map(c=>card(c)).join("");
  $("#sb").value=state.smallBlind; $("#bb").value=state.bigBlind;

  const my=me();
  $("#adminPanel").classList.toggle("hidden",!my?.isAdmin);
  $("#myCards").innerHTML=(priv.cards||[]).map(c=>card(c)).join("");

  const activeTurn=state.phase!=="waiting" && state.players[state.turnIndex]?.id===priv.myId;
  $("#actions").classList.toggle("hidden",!activeTurn);
  if(activeTurn){
    const toCall=Math.max(0,state.currentBet-my.bet);
    const callBtn=$('[data-act="call"]'), checkBtn=$('[data-act="check"]');
    callBtn.textContent=toCall?`Suivre ${Math.min(toCall,my.chips)}`:"Suivre";
    callBtn.disabled=toCall===0;
    checkBtn.disabled=toCall!==0;
    $("#raiseAmount").value=Math.min(my.bet+my.chips, state.currentBet+state.minRaise);
    $("#raiseAmount").min=state.currentBet+1;
  }

  const seatWrap=$("#seats"); seatWrap.innerHTML="";
  state.players.forEach((p,i)=>{
    const div=document.createElement("div");
    div.className=`seat s${p.seat} ${i===state.turnIndex&&state.phase!=="waiting"?"turn":""} ${p.folded?"folded":""}`;
    const isDealer=i===state.dealerIndex&&state.phase!=="waiting";
    let cards="";
    if(state.showCards?.[p.id]) cards=`<div class="miniCards">${state.showCards[p.id].map(c=>card(c)).join("")}</div>`;
    else if(state.phase!=="waiting"&&!p.folded&&p.id!==priv.myId) cards=`<div class="miniCards">${card(null,true)}${card(null,true)}</div>`;
    div.innerHTML=`<div class="bubble"><div class="name">${esc(p.name)}${p.isAdmin?" 👑":""}${isDealer?'<span class="dealer">D</span>':""}</div><div class="chips">🟡 ${p.chips} jetons</div>${p.bet?`<div class="bet">Mise ${p.bet}</div>`:""}${cards}</div>`;
    seatWrap.appendChild(div);
  });

  $("#playersList").innerHTML="";
  state.players.forEach(p=>{
    const line=document.createElement("div");line.className="playerLine";
    const controls=my?.isAdmin&&state.phase==="waiting" ? `<div class="chipBtns"><button data-chip="-500" data-id="${p.id}">-500</button><button data-chip="500" data-id="${p.id}">+500</button></div>`:"";
    line.innerHTML=`<div><b>${esc(p.name)}</b><div class="meta">${p.chips} jetons ${p.connected?"":"• hors ligne"}</div></div>${controls}`;
    $("#playersList").appendChild(line);
  });
  $$("[data-chip]").forEach(b=>b.onclick=()=>socket.emit("adminChips",{playerId:b.dataset.id,amount:+b.dataset.chip}));

  if(state.lastWinners?.length){
    const msg=state.lastWinners.map(w=>`${w.name} gagne ${w.amount} (${w.hand})`).join(" • ");
    $("#status").textContent=msg;
  }
}
