const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim());

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST']
  }
});

app.get('/health', (req, res) => res.status(200).send('ok'));

let waitingUsers = [];
const userPairs = new Map();

// Simple per-socket rate limiting to blunt signaling spam/abuse.
const RATE_LIMITS = {
  'find-peer': { max: 5, windowMs: 10_000 },
  'message': { max: 20, windowMs: 10_000 },
  'typing': { max: 20, windowMs: 10_000 },
};

function isRateLimited(socket, eventName) {
  const limit = RATE_LIMITS[eventName];
  if (!limit) return false;

  const now = Date.now();
  socket._rateBuckets = socket._rateBuckets || {};
  const bucket = socket._rateBuckets[eventName] || { count: 0, windowStart: now };

  if (now - bucket.windowStart > limit.windowMs) {
    bucket.count = 0;
    bucket.windowStart = now;
  }

  bucket.count += 1;
  socket._rateBuckets[eventName] = bucket;

  return bucket.count > limit.max;
}

function broadcastOnlineCount() {
  io.emit('online-count', io.engine.clientsCount);
}

function removeFromWaiting(socketId) {
  waitingUsers = waitingUsers.filter((user) => user.id !== socketId);
}

function matchUsers(socket) {
  // Drop any stale waiting entries for sockets that disconnected or already matched.
  while (waitingUsers.length > 0 && (!waitingUsers[0].connected || userPairs.has(waitingUsers[0].id))) {
    waitingUsers.shift();
  }

  if (waitingUsers.length > 0 && waitingUsers[0].id !== socket.id) {
    const peer = waitingUsers.shift();

    userPairs.set(socket.id, peer.id);
    userPairs.set(peer.id, socket.id);

    socket.emit('matched', { peerId: peer.id, initiator: true });
    peer.emit('matched', { peerId: socket.id, initiator: false });

    console.log(`Matched ${socket.id} with ${peer.id}`);
  } else {
    removeFromWaiting(socket.id);
    waitingUsers.push(socket);
    console.log('Added to waiting list:', socket.id);
  }
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  broadcastOnlineCount();

  socket.on('find-peer', () => {
    if (isRateLimited(socket, 'find-peer')) return;
    console.log('User searching for peer:', socket.id);
    matchUsers(socket);
  });

  socket.on('cancel-find', () => {
    removeFromWaiting(socket.id);
    console.log('Cancelled search:', socket.id);
  });

  socket.on('offer', (offer) => {
    const peerId = userPairs.get(socket.id);
    if (peerId) {
      io.to(peerId).emit('offer', offer);
      console.log(`Sent offer from ${socket.id} to ${peerId}`);
    }
  });

  socket.on('answer', (answer) => {
    const peerId = userPairs.get(socket.id);
    if (peerId) {
      io.to(peerId).emit('answer', answer);
      console.log(`Sent answer from ${socket.id} to ${peerId}`);
    }
  });

  socket.on('ice-candidate', (candidate) => {
    const peerId = userPairs.get(socket.id);
    if (peerId) {
      io.to(peerId).emit('ice-candidate', candidate);
    }
  });

  socket.on('message', (message) => {
    if (isRateLimited(socket, 'message')) return;
    const peerId = userPairs.get(socket.id);
    if (peerId && typeof message === 'string' && message.trim()) {
      io.to(peerId).emit('message', message.slice(0, 1000));
    }
  });

  socket.on('typing', (isTyping) => {
    if (isRateLimited(socket, 'typing')) return;
    const peerId = userPairs.get(socket.id);
    if (peerId) {
      io.to(peerId).emit('typing', Boolean(isTyping));
    }
  });

  socket.on('skip', () => {
    const peerId = userPairs.get(socket.id);
    if (peerId) {
      io.to(peerId).emit('peer-disconnected');
      userPairs.delete(peerId);
      userPairs.delete(socket.id);
    }
    matchUsers(socket);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);

    removeFromWaiting(socket.id);

    // Notify peer if connected
    const peerId = userPairs.get(socket.id);
    if (peerId) {
      io.to(peerId).emit('peer-disconnected');
      userPairs.delete(peerId);
    }
    userPairs.delete(socket.id);

    broadcastOnlineCount();
  });
});

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '127.0.0.1';
server.listen(PORT, HOST, () => {
  console.log(`Signaling server running on ${HOST}:${PORT}`);
});

function shutdown() {
  console.log('Shutting down signaling server...');
  io.close(() => {
    server.close(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 5000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
