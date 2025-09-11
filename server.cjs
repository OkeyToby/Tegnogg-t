const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(cors({ origin: "*" }));
app.use(express.json());

// In-memory data (simple)
const rooms = new Map();
const rand = (n = 6) => Math.random().toString(36).slice(2, 2 + n).toUpperCase();
const newCode = () => {
  let c;
  do {
    c = rand(4);
  } while (rooms.has(c));
  return c;
};

// Health
app.get("/health", (_req, res) => res.status(200).send("OK"));

// Create room
app.post("/api/rooms", (req, res) => {
  const code = newCode();
  const hostKey = rand(12);
  rooms.set(code, { hostKey, players: new Map(), started: false, createdAt: Date.now() });
  res.json({ code, hostKey });
});

// Join room
app.post("/api/rooms/:code/join", (req, res) => {
  const code = (req.params.code || "").toUpperCase();
  const room = rooms.get(code);
  if (!room) return res.status(404).json({ error: "Room not found" });
  const { name, avatar } = req.body || {};
  if (!name || !avatar) return res.status(400).json({ error: "Missing name or avatar" });
  const playerId = rand(8);
  room.players.set(playerId, { name, avatar, score: 0 });
  io.to(code).emit("player-joined", { id: playerId, name, avatar, count: room.players.size });
  res.json({ playerId });
});

// Snapshot
app.get("/api/rooms/:code", (req, res) => {
  const code = (req.params.code || "").toUpperCase();
  const room = rooms.get(code);
  if (!room) return res.status(404).json({ error: "Room not found" });
  const players = Array.from(room.players.entries()).map(([id, p]) => ({ id, ...p }));
  res.json({ code, started: room.started, players });
});

// Start game
app.post("/api/rooms/:code/start", (req, res) => {
  const code = (req.params.code || "").toUpperCase();
  const { hostKey } = req.body || {};
  const room = rooms.get(code);
  if (!room) return res.status(404).json({ error: "Room not found" });
  if (room.hostKey !== hostKey) return res.status(403).json({ error: "Invalid hostKey" });
  room.started = true;
  io.to(code).emit("game-started", { code, t: Date.now() });
  res.json({ ok: true });
});

// Answer
app.post("/api/rooms/:code/answer", (req, res) => {
  const code = (req.params.code || "").toUpperCase();
  const room = rooms.get(code);
  if (!room) return res.status(404).json({ error: "Room not found" });
  const { playerId, answer } = req.body || {};
  if (!playerId || !room.players.has(playerId)) {
    return res.status(404).json({ error: "Unknown player" });
  }
  const p = room.players.get(playerId);
  p.score = (p.score || 0) + 1;
  room.players.set(playerId, p);
  io.to(code).emit("score-update", { playerId, score: p.score, answer: String(answer || "") });
  res.json({ ok: true, score: p.score });
});

// Socket.IO events
io.on("connection", (socket) => {
  socket.on("join-room", ({ code }) => {
    const c = (code || "").toUpperCase();
    if (!rooms.has(c)) return;
    socket.join(c);
    socket.emit("joined", { code: c });
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log("Server listening on", PORT);
});
