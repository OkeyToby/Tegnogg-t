"use strict";

const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
require('dotenv').config();
const path    = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

app.use(express.static('public'));

const CLASS_CODE = process.env.CLASS_CODE || 'KLASSE2025';

const WORDS = [
  "guitar","skolegård","viking","drage","cykel","robot",
  "tromme","græsplæne","tavle","vaffelis","flag","postkasse",
  "bibliotek","regnjakke","klaver","læsehest","kagemand","Juelsminde"
];

const CHOOSE_TIME = 20 * 1000;
const DRAW_TIME   = 80 * 1000;

const rooms = {};

function randomCode(len=4){
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for(let i=0;i<len;i++) out += chars[Math.floor(Math.random()*chars.length)];
  return out;
}
function randomWord(){ return WORDS[Math.floor(Math.random()*WORDS.length)]; }

function hintWithReveals(w, revealed){
  let out = '';
  for(let i=0;i<w.length;i++){
    const ch = w[i];
    if (/\s/.test(ch)) out += ' ';
    else if (revealed && revealed.includes(i)) out += ch;
    else out += '_';
  }
  return out;
}

function revealLetter(roomId){
  const r = rooms[roomId];
  if(!r || !r.word) return;
  const unrevealed = [];
  for(let i=0;i<r.word.length;i++){
    if(!/\s/.test(r.word[i]) && !(r.revealedIndices||[]).includes(i)){
      unrevealed.push(i);
    }
  }
  if(unrevealed.length === 0) return;
  const idx = unrevealed[Math.floor(Math.random()*unrevealed.length)];
  if(!r.revealedIndices) r.revealedIndices = [];
  r.revealedIndices.push(idx);
  const hint = hintWithReveals(r.word, r.revealedIndices);
  io.to(roomId).emit('hintUpdate',{ hint });
}

function beginDraw(roomId){
  const r = rooms[roomId];
  if(!r || !r.word) return;
  r.phase = 'draw';
  r.guessed = new Set();
  r.revealedIndices = [];
  const drawerName = r.players.find(p => p.id === r.drawerId)?.name || '?';
  const hint = hintWithReveals(r.word, r.revealedIndices);

  io.to(roomId).emit('roundStart',{ drawerId:r.drawerId, drawerName, hint });
  io.to(r.drawerId).emit('youDraw',{ word:r.word });

  if(r.hintTimers) r.hintTimers.forEach(t => clearTimeout(t));
  r.hintTimers = [];

  const letters = r.word.replace(/\s/g,'').length;
  const reveals = Math.max(letters,1);
  for(let i=0;i<reveals;i++){
    const t = Math.floor((DRAW_TIME*(i+1))/(reveals+1));
    r.hintTimers.push(setTimeout(()=>revealLetter(roomId), t));
  }

  clearTimeout(r._timer);
  r._timer = setTimeout(()=>endRound(roomId,'time'), DRAW_TIME);
}

io.use((socket,next)=>{
  const auth = socket.handshake.auth || {};
  const name = (auth.name || "").trim();
  const code = (auth.classCode || "").trim();
  const avatar = auth.avatar || "";
  if(!name) return next(new Error("Navn mangler."));
  if(!code || code !== CLASS_CODE) return next(new Error("Forkert klassekode."));
  socket.data.name = name;
  socket.data.avatar = avatar;
  next();
});

io.on('connection', (socket)=>{

  socket.on('createHold',(cb)=>{
    const roomId = randomCode();
    rooms[roomId] = {
      hostId: socket.id,
      players: [{ id: socket.id, name: socket.data.name, avatar: socket.data.avatar, score:0 }],
      turnIdx:0,
      phase:'lobby',
      word:null,
      drawerId:null,
      guessed:new Set(),
      _timer:null,
      hintTimers[],
      revealedIndices[],
      numRounds:1,
      roundCounter:0
    };
    socket.join(roomId);
    cb && cb({ ok:true, roomId, isHost:true, players: rooms[roomId].players });
  });

  socket.on('joinHold',({ roomId },cb)=>{
    const r = rooms[roomId];
    if(!r) return cb && cb({ ok:false, error:"Holdet findes ikke." });
    if(!r.players.find(p=>p.id === socket.id)){
      r.players.push({ id: socket.id, name: socket.data.name, avatar: socket.data.avatar, score:0 });
      socket.join(roomId);
      io.to(roomId).emit('playerList', r.players);
    }
    cb && cb({ ok:true, roomId, isHost: r.hostId === socket.id, players: r.players });
  });

  socket.on('setRounds', ({ roomId, rounds })=>{
    const r = rooms[roomId];
    if(!r || r.hostId !== socket.id) return;
    const n = parseInt(rounds, 10);
    if(!isNaN(n) && n > 0) r.numRounds = n;
  });

  socket.on('startGame',({ roomId })=>{
    const r = rooms[roomId];
    if(!r || r.hostId !== socket.id) return;

    r.turnIdx = Math.floor(Math.random()*r.players.length);
    r.roundCounter = 0;
    r.players.forEach(p=>p.score=0);
    io.to(roomId).emit('playerList', r.players);

    startTurn(roomId);
  });

  socket.on('disconnect', ()=>{
    for(const [rid,r] of Object.entries(rooms)){
      const idx = r.players.findIndex(p=>p.id === socket.id);
      if(idx >= 0){
        const leavingWasDrawer = (r.players[idx].id === r.drawerId);
        r.players.splice(idx,1);
        io.to(rid).emit('playerList', r.players);
        if(r.hostId === socket.id && r.players[0]) r.hostId = r.players[0].id;
        if(leavingWasDrawer && r.phase === 'draw'){
          endRound(rid,'drawerLeft');
        }
        if(r.players.length === 0){
          clearTimeout(r._timer);
          if(r.hintTimers) r.hintTimers.forEach(t=>clearTimeout(t));
          delete rooms[rid];
        }
      }
    }
  });

  function startTurn(roomId){
    const r = rooms[roomId];
    if(!r || r.players.length === 0) return;

    const totalTurns = r.numRounds * r.players.length;
    if(r.numRounds && r.roundCounter >= totalTurns){
      clearTimeout(r._timer);
      if(r.hintTimers) r.hintTimers.forEach(t=>clearTimeout(t));
      r.phase = 'ended';

      const podium = [...r.players]
        .sort((a,b)=>b.score - a.score)
        .slice(0,3)
        .map(p=>({ id:p.id, name:p.name, score:p.score }));

      io.to(roomId).emit('gameOver',{ podium, players: r.players });
      return;
    }

    r.phase = 'choose';
    r.word = null;
    r.revealedIndices = [];
    r.drawerId = r.players[r.turnIdx % r.players.length].id;
    const drawerName = r.players.find(p=>p.id === r.drawerId)?.name || "?";
    io.to(roomId).emit('turnInfo',{ drawerId: r.drawerId, drawerName });
    io.to(r.drawerId).emit('chooseWordFree',{ maxLen:20, chooseTime: CHOOSE_TIME/1000 });

    clearTimeout(r._timer);
    r._timer = setTimeout(()=>{
      r.word = randomWord().toLowerCase();
      beginDraw(roomId);
    }, CHOOSE_TIME);
  }

  function endRound(roomId, reason){
    const r = rooms[roomId];
    if(!r) return;
    if(r.hintTimers) r.hintTimers.forEach(t=>clearTimeout(t));
    clearTimeout(r._timer);
    io.to(roomId).emit('roundEnd',{ reason, word: r.word });
    r.turnIdx = (r.turnIdx + 1) % r.players.length;
    r.roundCounter = (r.roundCounter || 0) + 1;
    r._timer = setTimeout(()=>startTurn(roomId), 1500);
  }
});

const PORT = process.env.PORT || 3000;
app.get('/',(req,res)=>{
  res.sendFile(path.join(__dirname,'public','index.html'));
});
server.listen(PORT,()=>{ console.log('Hold-server lytter på', PORT); });
