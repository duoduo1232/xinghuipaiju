import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocketServer } from 'ws';

const portArgIndex = process.argv.findIndex((item) => item === '--port' || item === '-p');
const argPort = portArgIndex >= 0 ? Number(process.argv[portArgIndex + 1]) : 0;
const port = Number(process.env.PORT || argPort || 8781);
const maxPeersPerRoom = Number(process.env.MAX_ROOM_PEERS || 2);
const heartbeatMs = Number(process.env.HEARTBEAT_MS || 30000);
const leaderboardFile = process.env.LEADERBOARD_FILE || path.resolve('data', 'leaderboard.json');
const rooms = new Map();

function getRoom(name) {
  const roomName = name || 'room1';
  if (!rooms.has(roomName)) rooms.set(roomName, new Set());
  return rooms.get(roomName);
}

function send(socket, message) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

function broadcast(room, sender, message) {
  for (const peer of room) {
    if (peer !== sender) send(peer, message);
  }
}

function cleanRoomName(value) {
  const name = String(value || '').trim().replace(/[^\w\u4e00-\u9fa5-]/g, '').slice(0, 24);
  return name || `room-${Math.random().toString(36).slice(2, 8)}`;
}

function getPublicRooms() {
  return [...rooms.entries()]
    .map(([id, room]) => {
      const peers = [...room];
      const host = peers.find((peer) => peer.isHost) || peers[0];
      return {
        id,
        hostName: host?.playerName || '鐜╁',
        players: peers.length,
        maxPlayers: maxPeersPerRoom,
        status: peers.length >= maxPeersPerRoom ? 'playing' : 'waiting',
        createdAt: host?.createdAt || Date.now(),
      };
    })
    .filter((room) => room.status === 'waiting')
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 40);
}

function printAddresses() {
  console.log(`Pixel card relay server listening on port ${port}`);
  console.log(`Local test URL: http://127.0.0.1:${port}`);
  console.log(`Leaderboard API: http://127.0.0.1:${port}/leaderboard`);
  console.log(`Leaderboard file: ${leaderboardFile}`);
  console.log(`Default room: room1`);
  console.log(`Max peers per room: ${maxPeersPerRoom}`);
  console.log(`Run with custom port: npm run relay -- --port 18781`);
  for (const info of Object.values(os.networkInterfaces()).flat()) {
    if (!info || info.family !== 'IPv4' || info.internal) continue;
    console.log(`LAN WebSocket URL: ws://${info.address}:${port}`);
  }
  console.log('Public server: expose this port directly, or reverse proxy with Nginx and use wss://your-domain/ws.');
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  response.end(JSON.stringify(payload));
}

async function readLeaderboard() {
  try {
    const parsed = JSON.parse(await readFile(leaderboardFile, 'utf8'));
    return Array.isArray(parsed.players) ? parsed : { players: [] };
  } catch {
    return { players: [] };
  }
}

async function writeLeaderboard(data) {
  await mkdir(path.dirname(leaderboardFile), { recursive: true });
  await writeFile(leaderboardFile, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function cleanName(value) {
  const name = String(value || '').trim().slice(0, 16);
  return name || '玩家';
}

function sortLeaderboard(players) {
  return [...players]
    .sort((a, b) => (b.wins - a.wins) || ((b.wins - b.losses) - (a.wins - a.losses)) || String(a.name).localeCompare(String(b.name)))
    .slice(0, 50);
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function handleLeaderboard(request, response) {
  if (request.method === 'OPTIONS') {
    sendJson(response, 204, {});
    return;
  }
  if (request.method === 'GET') {
    const data = await readLeaderboard();
    sendJson(response, 200, { players: sortLeaderboard(data.players) });
    return;
  }
  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'Method not allowed' });
    return;
  }

  try {
    const payload = JSON.parse(await readBody(request) || '{}');
    const name = cleanName(payload.name);
    const result = payload.result === 'win' ? 'win' : payload.result === 'loss' ? 'loss' : null;
    if (!result) {
      sendJson(response, 400, { error: 'result must be win or loss' });
      return;
    }
    const data = await readLeaderboard();
    const players = Array.isArray(data.players) ? data.players : [];
    const existing = players.find((player) => player.name === name);
    const now = new Date().toISOString();
    const record = existing || { name, wins: 0, losses: 0, updatedAt: now };
    if (result === 'win') record.wins += 1;
    else record.losses += 1;
    record.mode = String(payload.mode || '').slice(0, 20);
    record.updatedAt = now;
    if (!existing) players.push(record);
    await writeLeaderboard({ players: sortLeaderboard(players) });
    sendJson(response, 200, { ok: true, player: record, players: sortLeaderboard(players) });
  } catch (error) {
    sendJson(response, 400, { error: error instanceof Error ? error.message : 'Bad request' });
  }
}

const server = createServer((request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  if (url.pathname === '/rooms') {
    sendJson(response, 200, { rooms: getPublicRooms() });
    return;
  }
  if (url.pathname === '/leaderboard') {
    handleLeaderboard(request, response).catch((error) => {
      sendJson(response, 500, { error: error instanceof Error ? error.message : 'Server error' });
    });
    return;
  }
  response.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  response.end('Pixel card relay server is running.\nGET /leaderboard for ranking data.\n');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (socket, request) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const roomName = cleanRoomName(url.searchParams.get('room') || 'room1');
  const name = cleanName(url.searchParams.get('name'));
  const isHost = url.searchParams.get('host') === '1';
  const room = getRoom(roomName);

  if (room.size >= maxPeersPerRoom) {
    send(socket, { type: 'error', message: 'Room is full' });
    socket.close(1008, 'Room is full');
    return;
  }

  const occupiedSeats = new Set([...room].map((peer) => peer.seat));
  const seat = occupiedSeats.has('p1') ? 'p2' : 'p1';
  socket.roomName = roomName;
  socket.seat = seat;
  socket.playerName = name;
  socket.isHost = isHost || room.size === 0;
  socket.createdAt = Date.now();
  socket.isAlive = true;
  room.add(socket);

  send(socket, { type: 'seat', seat, room: roomName });
  broadcast(room, socket, { type: 'name', seat, name });

  if (room.size >= 2) {
    for (const peer of room) send(peer, { type: 'lan-ready' });
  }

  socket.on('message', (raw) => {
    try {
      const message = JSON.parse(raw.toString());
      if (message.type === 'pong') {
        socket.isAlive = true;
        return;
      }
      broadcast(room, socket, message);
    } catch {
      send(socket, { type: 'error', message: 'Bad JSON message' });
    }
  });

  socket.on('close', () => {
    room.delete(socket);
    broadcast(room, socket, { type: 'peer-left', seat });
    if (room.size === 0) rooms.delete(roomName);
  });
});

const heartbeat = setInterval(() => {
  for (const [roomName, room] of rooms.entries()) {
    for (const socket of room) {
      if (!socket.isAlive) {
        room.delete(socket);
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      send(socket, { type: 'ping' });
    }
    if (room.size === 0) rooms.delete(roomName);
  }
}, heartbeatMs);

server.on('close', () => clearInterval(heartbeat));
server.listen(port, '0.0.0.0', printAddresses);
