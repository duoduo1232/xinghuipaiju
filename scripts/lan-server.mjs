import { createServer } from 'node:http';
import os from 'node:os';
import { WebSocketServer } from 'ws';

const portArgIndex = process.argv.findIndex((item) => item === '--port' || item === '-p');
const argPort = portArgIndex >= 0 ? Number(process.argv[portArgIndex + 1]) : 0;
const port = Number(process.env.PORT || argPort || 8781);
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

function printAddresses() {
  console.log(`Pixel card LAN server listening on port ${port}`);
  console.log(`Local test URL: http://127.0.0.1:${port}`);
  console.log(`Default room: room1`);
  console.log(`Run with custom port: npm run lan -- --port 9000`);
  for (const info of Object.values(os.networkInterfaces()).flat()) {
    if (!info || info.family !== 'IPv4' || info.internal) continue;
    console.log(`Phone WebSocket URL: ws://${info.address}:${port}`);
  }
  console.log('Public relay/tunnel: expose this TCP port, then use ws://PUBLIC_HOST:PORT in the app.');
}

const server = createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end('Pixel card LAN server is running.\n');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (socket, request) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const roomName = url.searchParams.get('room') || 'room1';
  const name = url.searchParams.get('name') || '玩家';
  const room = getRoom(roomName);
  const seat = room.size === 0 ? 'p1' : 'p2';

  socket.roomName = roomName;
  socket.seat = seat;
  room.add(socket);

  send(socket, { type: 'seat', seat, room: roomName });
  broadcast(room, socket, { type: 'name', seat, name });

  if (room.size >= 2) {
    for (const peer of room) send(peer, { type: 'lan-ready' });
  }

  socket.on('message', (raw) => {
    try {
      const message = JSON.parse(raw.toString());
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

server.listen(port, '0.0.0.0', printAddresses);
