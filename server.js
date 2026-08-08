
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();

const SUITS = ["♠","♥","♦","♣"];
const RANKS = [
  {r:"2",v:2},{r:"3",v:3},{r:"4",v:4},{r:"5",v:5},{r:"6",v:6},{r:"7",v:7},
  {r:"8",v:8},{r:"9",v:9},{r:"10",v:10},{r:"J",v:11},{r:"Q",v:12},{r:"K",v:13},{r:"A",v:14}
];

function code() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i=0;i<6;i++) s += chars[Math.floor(Math.random()*chars.length)];
  return s;
}
function deck() {
  const d = [];
  for (const s of SUITS) for (const {r,v} of RANKS) d.push({r,v,s});
  for (let i=d.length-1;i>0;i--) {
    const j = Math.floor(Math.random()*(i+1));
    [d[i],d[j]]=[d[j],d[i]];
  }
  return d;
}
function pubPlayer(p) {
  return {
    id:p.id, name:p.name, chips:p.chips, folded:p.folded, bet:p.bet, totalBet:p.totalBet,
    isAdmin:p.isAdmin, connected:p.connected, seat:p.seat, allIn:p.allIn
  };
}
function publicState(room) {
  return {
    code: room.code,
    phase: room.phase,
    pot: room.pot,
    community: room.community,
    currentBet: room.currentBet,
    minRaise: room.minRaise,
    dealerIndex: room.dealerIndex,
    turnIndex: room.turnIndex,
    smallBlind: room.smallBlind,
    bigBlind: room.bigBlind,
    message: room.message,
    players: room.players.map(pubPlayer),
    lastWinners: room.lastWinners || [],
    showCards: room.showCards || {}
  };
}
function emitState(room) {
  io.to(room.code).emit("state", publicState(room));
  for (const p of room.players) {
    if (p.connected && p.socketId) {
      io.to(p.socketId).emit("private", { cards: p.cards || [], myId: p.id });
    }
  }
}
function getRoomBySocket(socket) {
  const rc = socket.data.roomCode;
  return rc ? rooms.get(rc) : null;
}
function findPlayer(room, socket) {
  return room.players.find(p => p.id === socket.data.playerId);
}
function nextActive(room, from) {
  const n = room.players.length;
  for (let k=1;k<=n;k++) {
    const i=(from+k)%n, p=room.players[i];
    if (p && !p.folded && !p.allIn && p.chips>=0) return i;
  }
  return -1;
}
function activePlayers(room) {
  return room.players.filter(p=>!p.folded);
}
function contenders(room) {
  return room.players.filter(p=>!p.folded && ((p.cards||[]).length===2));
}
function resetBets(room) {
  room.currentBet=0;
  room.minRaise=room.bigBlind;
  for (const p of room.players) p.bet=0;
}
function takeBet(p, amount) {
  const paid=Math.max(0, Math.min(p.chips, amount));
  p.chips -= paid; p.bet += paid; p.totalBet += paid;
  if (p.chips===0) p.allIn=true;
  return paid;
}
function recomputePot(room) {
  room.pot = room.players.reduce((a,p)=>a+p.totalBet,0);
}
function everyoneSettled(room) {
  const alive=room.players.filter(p=>!p.folded && !p.allIn);
  if (alive.length<=1) return true;
  return alive.every(p=>p.bet===room.currentBet && p.acted);
}
function oneLeft(room) {
  return activePlayers(room).length===1;
}

function straightHigh(values) {
  const uniq=[...new Set(values)].sort((a,b)=>b-a);
  if (uniq.includes(14)) uniq.push(1);
  for (let i=0;i<=uniq.length-5;i++) {
    let ok=true;
    for (let j=1;j<5;j++) if (uniq[i+j]!==uniq[i]-j) ok=false;
    if (ok) return uniq[i];
  }
  return 0;
}
function compareScore(a,b) {
  for (let i=0;i<Math.max(a.length,b.length);i++) {
    const d=(a[i]||0)-(b[i]||0);
    if (d) return d;
  }
  return 0;
}
function eval5(cards) {
  const vals=cards.map(c=>c.v).sort((a,b)=>b-a);
  const counts={};
  for(const v of vals) counts[v]=(counts[v]||0)+1;
  const groups=Object.entries(counts).map(([v,c])=>({v:+v,c})).sort((a,b)=>b.c-a.c||b.v-a.v);
  const flush=cards.every(c=>c.s===cards[0].s);
  const sh=straightHigh(vals);
  if(flush && sh) return [8,sh];
  if(groups[0].c===4) return [7,groups[0].v,groups[1].v];
  if(groups[0].c===3 && groups[1].c===2) return [6,groups[0].v,groups[1].v];
  if(flush) return [5,...vals];
  if(sh) return [4,sh];
  if(groups[0].c===3) {
    const ks=groups.filter(g=>g.c===1).map(g=>g.v).sort((a,b)=>b-a);
    return [3,groups[0].v,...ks];
  }
  if(groups[0].c===2 && groups[1].c===2) {
    const hi=Math.max(groups[0].v,groups[1].v), lo=Math.min(groups[0].v,groups[1].v);
    const k=groups.find(g=>g.c===1).v;
    return [2,hi,lo,k];
  }
  if(groups[0].c===2) {
    const ks=groups.filter(g=>g.c===1).map(g=>g.v).sort((a,b)=>b-a);
    return [1,groups[0].v,...ks];
  }
  return [0,...vals];
}
function best7(cards) {
  let best=null;
  for(let a=0;a<cards.length-4;a++)
  for(let b=a+1;b<cards.length-3;b++)
  for(let c=b+1;c<cards.length-2;c++)
  for(let d=c+1;d<cards.length-1;d++)
  for(let e=d+1;e<cards.length;e++) {
    const s=eval5([cards[a],cards[b],cards[c],cards[d],cards[e]]);
    if(!best || compareScore(s,best)>0) best=s;
  }
  return best;
}
const HAND_NAMES=["Carte haute","Paire","Deux paires","Brelan","Suite","Couleur","Full","Carré","Quinte flush"];

function awardFoldWin(room) {
  const p=activePlayers(room)[0];
  recomputePot(room);
  p.chips += room.pot;
  room.lastWinners=[{name:p.name, amount:room.pot, hand:"Les autres joueurs se sont couchés"}];
  room.message=`${p.name} remporte ${room.pot} jetons.`;
  room.pot=0;
  room.phase="waiting";
  room.showCards={};
}
function showdown(room) {
  while(room.community.length<5) room.community.push(room.deck.pop());
  recomputePot(room);

  // Side-pot compatible distribution
  const levels=[...new Set(room.players.filter(p=>p.totalBet>0).map(p=>p.totalBet))].sort((a,b)=>a-b);
  let prev=0;
  const payouts=new Map();
  const handCache=new Map();
  for(const p of contenders(room)) handCache.set(p.id,best7([...(p.cards||[]),...room.community]));

  for(const level of levels) {
    const contributors=room.players.filter(p=>p.totalBet>=level);
    const potSize=(level-prev)*contributors.length;
    const eligible=contributors.filter(p=>!p.folded && handCache.has(p.id));
    if(eligible.length) {
      let winners=[eligible[0]];
      for(const p of eligible.slice(1)) {
        const cmp=compareScore(handCache.get(p.id),handCache.get(winners[0].id));
        if(cmp>0) winners=[p];
        else if(cmp===0) winners.push(p);
      }
      const share=Math.floor(potSize/winners.length);
      let rem=potSize-share*winners.length;
      for(const w of winners) {
        const amt=share+(rem>0?1:0); if(rem>0) rem--;
        payouts.set(w.id,(payouts.get(w.id)||0)+amt);
      }
    }
    prev=level;
  }

  room.lastWinners=[];
  for(const [id,amt] of payouts) {
    const p=room.players.find(x=>x.id===id);
    p.chips+=amt;
    const score=handCache.get(id);
    room.lastWinners.push({name:p.name,amount:amt,hand:HAND_NAMES[score[0]]});
  }
  room.showCards={};
  for(const p of contenders(room)) room.showCards[p.id]=p.cards;
  room.message=room.lastWinners.map(w=>`${w.name} +${w.amount} (${w.hand})`).join(" • ");
  room.pot=0;
  room.phase="waiting";
}
function nextStreet(room) {
  if(room.phase==="preflop") {
    room.community.push(room.deck.pop(),room.deck.pop(),room.deck.pop());
    room.phase="flop";
  } else if(room.phase==="flop") {
    room.community.push(room.deck.pop()); room.phase="turn";
  } else if(room.phase==="turn") {
    room.community.push(room.deck.pop()); room.phase="river";
  } else if(room.phase==="river") {
    showdown(room); return;
  }
  resetBets(room);
  for(const p of room.players) p.acted=false;
  room.turnIndex=nextActive(room,room.dealerIndex);
  if(room.turnIndex<0) showdown(room);
}
function progress(room) {
  recomputePot(room);
  if(oneLeft(room)) return awardFoldWin(room);
  if(everyoneSettled(room)) return nextStreet(room);
  const ni=nextActive(room,room.turnIndex);
  if(ni<0) nextStreet(room); else room.turnIndex=ni;
}

io.on("connection", socket => {
  socket.on("createRoom", ({name, chips=1000, smallBlind=10, bigBlind=20}) => {
    name=(name||"Admin").trim().slice(0,18);
    let rc; do rc=code(); while(rooms.has(rc));
    const player={id:socket.id,name,chips:+chips||1000,folded:false,bet:0,totalBet:0,isAdmin:true,connected:true,socketId:socket.id,seat:0,cards:[],allIn:false,acted:false};
    const room={code:rc,players:[player],phase:"waiting",pot:0,community:[],currentBet:0,minRaise:+bigBlind||20,dealerIndex:-1,turnIndex:-1,smallBlind:+smallBlind||10,bigBlind:+bigBlind||20,deck:[],message:"Table créée.",lastWinners:[],showCards:{}};
    rooms.set(rc,room);
    socket.join(rc); socket.data.roomCode=rc; socket.data.playerId=player.id;
    emitState(room);
  });

  socket.on("joinRoom", ({name, roomCode}) => {
    const rc=(roomCode||"").trim().toUpperCase();
    const room=rooms.get(rc);
    if(!room) return socket.emit("errorMsg","Table introuvable.");
    if(room.players.length>=9) return socket.emit("errorMsg","La table est complète.");
    if(room.phase!=="waiting") return socket.emit("errorMsg","Une main est déjà en cours.");
    name=(name||"Joueur").trim().slice(0,18);
    const seat=[0,1,2,3,4,5,6,7,8].find(x=>!room.players.some(p=>p.seat===x));
    const p={id:socket.id,name,chips:0,folded:false,bet:0,totalBet:0,isAdmin:false,connected:true,socketId:socket.id,seat,cards:[],allIn:false,acted:false};
    room.players.push(p);
    socket.join(rc); socket.data.roomCode=rc; socket.data.playerId=p.id;
    room.message=`${name} a rejoint la table.`;
    emitState(room);
  });

  socket.on("adminChips", ({playerId, amount}) => {
    const room=getRoomBySocket(socket), me=room && findPlayer(room,socket);
    if(!room || !me?.isAdmin || room.phase!=="waiting") return;
    const p=room.players.find(x=>x.id===playerId); if(!p) return;
    const a=Math.trunc(Number(amount)||0);
    p.chips=Math.max(0,p.chips+a);
    room.message=`${me.name} a ${a>=0?"ajouté":"retiré"} ${Math.abs(a)} jetons à ${p.name}.`;
    emitState(room);
  });

  socket.on("setBlinds", ({smallBlind,bigBlind}) => {
    const room=getRoomBySocket(socket), me=room && findPlayer(room,socket);
    if(!room || !me?.isAdmin || room.phase!=="waiting") return;
    const sb=Math.max(1,Math.trunc(+smallBlind||10)), bb=Math.max(sb+1,Math.trunc(+bigBlind||20));
    room.smallBlind=sb; room.bigBlind=bb; room.minRaise=bb;
    room.message=`Blinds réglées à ${sb}/${bb}.`;
    emitState(room);
  });

  socket.on("startHand", () => {
    const room=getRoomBySocket(socket), me=room && findPlayer(room,socket);
    if(!room || !me?.isAdmin || room.phase!=="waiting") return;
    const eligible=room.players.filter(p=>p.chips>0 && p.connected);
    if(eligible.length<2) return socket.emit("errorMsg","Il faut au moins 2 joueurs avec des jetons.");
    room.players=eligible;
    room.deck=deck(); room.community=[]; room.pot=0; room.currentBet=0; room.lastWinners=[]; room.showCards={};
    for(const p of room.players) {
      p.cards=[room.deck.pop(),room.deck.pop()];
      p.folded=false;p.bet=0;p.totalBet=0;p.allIn=false;p.acted=false;
    }
    room.dealerIndex=(room.dealerIndex+1)%room.players.length;
    const sbIndex=(room.dealerIndex+1)%room.players.length;
    const bbIndex=(room.dealerIndex+2)%room.players.length;
    takeBet(room.players[sbIndex],room.smallBlind);
    takeBet(room.players[bbIndex],room.bigBlind);
    room.currentBet=Math.max(room.players[sbIndex].bet,room.players[bbIndex].bet);
    room.minRaise=room.bigBlind;
    room.phase="preflop";
    room.turnIndex=nextActive(room,bbIndex);
    room.message="Nouvelle main.";
    recomputePot(room);
    emitState(room);
  });

  socket.on("action", ({type, amount}) => {
    const room=getRoomBySocket(socket), p=room && findPlayer(room,socket);
    if(!room || !p || room.phase==="waiting") return;
    const idx=room.players.findIndex(x=>x.id===p.id);
    if(idx!==room.turnIndex || p.folded || p.allIn) return;
    const toCall=Math.max(0,room.currentBet-p.bet);
    if(type==="fold") { p.folded=true; p.acted=true; }
    else if(type==="check") {
      if(toCall!==0) return socket.emit("errorMsg","Vous devez suivre, relancer ou vous coucher.");
      p.acted=true;
    }
    else if(type==="call") {
      takeBet(p,toCall); p.acted=true;
    }
    else if(type==="raise") {
      const target=Math.trunc(Number(amount)||0);
      if(target<=room.currentBet) return socket.emit("errorMsg","La relance doit dépasser la mise actuelle.");
      const needed=target-p.bet;
      if(needed>p.chips) return socket.emit("errorMsg","Pas assez de jetons pour cette relance.");
      const raiseBy=target-room.currentBet;
      if(raiseBy<room.minRaise && needed<p.chips) return socket.emit("errorMsg",`Relance minimale : ${room.currentBet+room.minRaise}.`);
      takeBet(p,needed);
      room.minRaise=Math.max(room.minRaise,raiseBy);
      room.currentBet=p.bet;
      for(const q of room.players) if(q.id!==p.id && !q.folded && !q.allIn) q.acted=false;
      p.acted=true;
    }
    progress(room);
    emitState(room);
  });

  socket.on("chat", (text) => {
    const room=getRoomBySocket(socket), p=room && findPlayer(room,socket);
    if(!room || !p) return;
    text=(text||"").trim().slice(0,200);
    if(text) io.to(room.code).emit("chat", {name:p.name,text});
  });

  socket.on("disconnect", () => {
    const room=getRoomBySocket(socket);
    if(!room) return;
    const p=findPlayer(room,socket);
    if(!p) return;
    p.connected=false; p.socketId=null;
    if(room.phase!=="waiting" && !p.folded) p.folded=true;
    room.message=`${p.name} s'est déconnecté.`;
    if(room.phase!=="waiting" && oneLeft(room)) awardFoldWin(room);
    emitState(room);
  });
});

const PORT=process.env.PORT || 3000;
server.listen(PORT, ()=>console.log(`Poker Privé lancé sur le port ${PORT}`));
