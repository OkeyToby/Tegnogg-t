// server_hold.js – Hold/rooms + turbaseret tegning, hvor tegneren kan skrive sit eget ord
// Simpelt, skolevenligt setup med Socket.IO

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const CLASS_CODE = process.env.CLASS_CODE || 'KLASSE2025';

// Basis-ordliste til fallback hvis tegneren ikke vælger i tide
const WORDS = [
  "guitar","skolegård","viking","drage","cykel","robot","tromme","græsplæne","tavle",
  "vaffelis","flag","postkasse","bibliotek","regnjakke","klaver","læsehest","kagemand","Juelsminde"
];

// Hjælpere
function randomCode(len = 4) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
function randomWord() {
  return WORDS[Math.floor(Math.random() * WORDS.length)];
}
function maskWord(w) {
  // Byt ikke-space-tegn ud med _  (så ordblinde kan se ordlængde uden bogstaver)
  return (w || '').replace(/\S/g, '_');
}

// Rum-state
// rooms[roomId] = {
//   hostId, players:[{id,name,score}], turnIdx, phase:'lobby'|'choose'|'draw',
//   word, drawerId, guessed:Set<socketId>, _timer
// }
const rooms = {};

// Auth middleware: kræv navn + klassekode i handshake
io.use((socket, next) => {
  const auth = socket.handshake.auth || {};
  const name = (auth.name || "").trim();
  const code = (auth.classCode || "").trim();

  if (!name) return next(new Error("Navn mangler."));
  if (!code || code !== CLASS_CODE) return next(new Error("Forkert klassekode."));
  socket.data.name = name;
  next();
});

io.on('connection', (socket) => {
  // Opret hold (rum)
  socket.on('createHold', (cb) => {
    const roomId = randomCode();
    rooms[roomId] = {
      hostId: socket.id,
      players: [{ id: socket.id, name: socket.data.name, score: 0 }],
      turnIdx: 0,
      phase: 'lobby',
      word: null,
      drawerId: null,
      guessed: new Set(),
      _timer: null
    };
    socket.join(roomId);
    cb && cb({ ok: true, roomId, isHost: true, players: rooms[roomId].players });
  });

  // Join hold
  socket.on('joinHold', ({ roomId }, cb) => {
    const r = rooms[roomId];
    if (!r) return cb && cb({ ok: false, error: "Holdet findes ikke." });

    if (!r.players.find(p => p.id === socket.id)) {
      r.players.push({ id: socket.id, name: socket.data.name, score: 0 });
      socket.join(roomId);
      io.to(roomId).emit('playerList', r.players);
    }
    cb && cb({ ok: true, roomId, isHost: r.hostId === socket.id, players: r.players });
  });

  // Start spil (kun vært)
  socket.on('startGame', ({ roomId }) => {
    const r = rooms[roomId];
    if (!r || r.hostId !== socket.id) return;
    startTurn(roomId);
  });

  // Tegneren har valgt/skrevet ord
  socket.on('wordChosen', ({ roomId, word }) => {
    const r = rooms[roomId];
    if (!r || socket.id !== r.drawerId || r.phase !== 'choose') return;

    const chosen = (word || "").trim().toLowerCase();
    if (!chosen) return;
    r.word = chosen;
    r.phase = 'draw';
    r.guessed = new Set();

    const drawerName = r.players.find(p => p.id === r.drawerId)?.name || "?";
    io.to(roomId).emit('roundStart', {
      drawerId: r.drawerId,
      drawerName,
      hint: maskWord(r.word)
    });
    io.to(r.drawerId).emit('youDraw', { word: r.word });

    clearTimeout(r._timer);
    r._timer = setTimeout(() => endRound(roomId, "time"), 80 * 1000); // 80 sek tegnertid
  });

  // Gæt/chat
  socket.on('guess', ({ roomId, msg }) => {
    const r = rooms[roomId];
    if (!r || r.phase !== 'draw') return;
    const player = r.players.find(p => p.id === socket.id);
    if (!player) return;

    const guess = (msg || "").trim().toLowerCase();
    if (!guess) return;

    if (guess === r.word && !r.guessed.has(socket.id)) {
      r.guessed.add(socket.id);
      player.score += 10;
      io.to(roomId).emit('chat', { from: player.name, msg: "gættede rigtigt!" });
      io.to(roomId).emit('playerList', r.players);

      // Hvis alle undtagen tegneren har gættet
      const nonDrawerIds = r.players.filter(p => p.id !== r.drawerId).map(p => p.id);
      const allGuessed = nonDrawerIds.length > 0 && nonDrawerIds.every(id => r.guessed.has(id));
      if (allGuessed) endRound(roomId, "all-guessed");
    } else {
      // Almindelig chat/gæt vises for alle
      io.to(roomId).emit('chat', { from: player.name, msg });
    }
  });

  // Tegnestrøg fra tegneren → send til andre
  socket.on('drawStroke', ({ roomId, stroke }) => {
    const r = rooms[roomId];
    if (!r || r.phase !== 'draw' || socket.id !== r.drawerId) return;
    socket.to(roomId).emit('drawStroke', stroke);
  });

  // Disconnect
  socket.on('disconnect', () => {
    for (const [roomId, r] of Object.entries(rooms)) {
      const idx = r.players.findIndex(p => p.id === socket.id);
      if (idx >= 0) {
        const leavingWasDrawer = r.players[idx].id === r.drawerId;
        r.players.splice(idx, 1);
        io.to(roomId).emit('playerList', r.players);

        // Ny vært hvis værten smutter
        if (r.hostId === socket.id && r.players[0]) r.hostId = r.players[0].id;

        // Hvis tegneren smutter midt i runden → slut runden
        if (leavingWasDrawer && r.phase === 'draw') endRound(roomId, "drawer-left");

        // Tomt rum → fjern
        if (r.players.length === 0) {
          clearTimeout(r._timer);
          delete rooms[roomId];
        }
      }
    }
  });

  // Hjælper: start tur (vælg ny tegner)
  function startTurn(roomId) {
    const r = rooms[roomId];
    if (!r || r.players.length === 0) return;

    r.phase = 'choose';
    r.word = null;
    r.drawerId = r.players[r.turnIdx % r.players.length].id;
    const drawer = r.players.find(p => p.id === r.drawerId);
    const drawerName = drawer?.name || "?";

    io.to(roomId).emit('turnInfo', { drawerId: r.drawerId, drawerName });

    // Tegneren får "skriv-dit-eget-ord"-modal
    io.to(r.drawerId).emit('chooseWordFree', { maxLen: 20, chooseTime: 20 });

    clearTimeout(r._timer);
    r._timer = setTimeout(() => {
      // Hvis tegneren ikke valgte i tide → fallback ord
      r.word = (randomWord() || 'hemmeligt').toLowerCase();
      r.phase = 'draw';
      r.guessed = new Set();

      io.to(roomId).emit('roundStart', { drawerId: r.drawerId, drawerName, hint: maskWord(r.word) });
      io.to(r.drawerId).emit('youDraw', { word: r.word });

      clearTimeout(r._timer);
      r._timer = setTimeout(() => endRound(roomId, "time"), 80 * 1000);
    }, 20 * 1000); // 20 sek valg-tid
  }

  // Hjælper: slut runde og gå videre
  function endRound(roomId, reason) {
    const r = rooms[roomId];
    if (!r) return;

    clearTimeout(r._timer);
    io.to(roomId).emit('roundEnd', { reason, word: r.word });
    r.turnIdx = (r.turnIdx + 1) % r.players.length;

    // Lille pause før næste tur
    r._timer = setTimeout(() => startTurn(roomId), 2000);
  }
});

const PORT = process.env.PORT || 3000;

// Root → public/index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
  console.log("Hold-server lytter på", PORT);
});
