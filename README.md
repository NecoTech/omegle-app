# Omegle-like Video Chat App

A random video chat application built with Next.js and WebRTC.

## Features

- Random 1-on-1 video chat with strangers
- Real-time text messaging with a "stranger is typing" indicator
- Skip to the next stranger, or cancel while searching
- Mute microphone / turn camera off mid-chat
- Live online-user count
- WebRTC peer-to-peer video streaming
- Socket.IO signaling server

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Install Tailwind CSS and PostCSS

```bash
npm install -D tailwindcss postcss autoprefixer
```

### 3. Configure Environment Variables (optional for local dev)

Copy `.env.local.example` to `.env.local` and adjust if you're deploying somewhere other than localhost, or want to supply a TURN server:

```bash
cp .env.local.example .env.local
```

- `NEXT_PUBLIC_SIGNALING_URL` — where the browser connects for signaling (defaults to `http://localhost:3001`)
- `CORS_ORIGIN` — comma-separated origins the signaling server accepts connections from (defaults to `http://localhost:3000`)
- `NEXT_PUBLIC_TURN_URL` / `NEXT_PUBLIC_TURN_USERNAME` / `NEXT_PUBLIC_TURN_CREDENTIAL` — optional TURN server, needed for users behind restrictive NATs/firewalls where STUN alone can't connect peers

### 4. Run the Application

Start both the Next.js dev server and the signaling server:

```bash
npm run dev:all
```

Or run them separately:

```bash
# Terminal 1 - Next.js app
npm run dev

# Terminal 2 - Signaling server
npm run server
```

### 5. Open the App

- Next.js app: http://localhost:3000
- Signaling server: http://localhost:3001

## How to Use

1. Click "Start Chat" to begin
2. Allow camera and microphone access when prompted
3. Wait to be matched with a random stranger (or click "Cancel" to stop searching)
4. Once connected, video chat and send text messages; mute your mic or turn off your camera anytime
5. Click "Skip" to find a new stranger
6. Click "Stop" to end the chat

## Technical Stack

- **Frontend**: Next.js 14, React, TypeScript
- **Styling**: Tailwind CSS
- **WebRTC**: For peer-to-peer video/audio streaming
- **Socket.IO**: For signaling and real-time communication
- **Node.js/Express**: Signaling server

## How It Works

1. Users connect to the Socket.IO signaling server
2. When a user clicks "Start Chat", they're added to a waiting pool
3. When another user joins, they're matched and exchange WebRTC offers/answers
4. ICE candidates are exchanged to establish peer-to-peer connection
5. Video/audio streams directly between peers (not through server)
6. Text messages are relayed through the signaling server

## Architecture

```
┌─────────────┐         ┌─────────────────┐         ┌─────────────┐
│   User A    │◄───────►│ Signaling Server│◄───────►│   User B    │
│ (Browser)   │         │   (Socket.IO)   │         │ (Browser)   │
└─────────────┘         └─────────────────┘         └─────────────┘
       │                                                     │
       │              WebRTC P2P Connection                 │
       │◄───────────────────────────────────────────────────┤
       │          (Video/Audio/Data Channels)               │
```

## Production Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for a full walkthrough of deploying to a
Hostinger (or any Ubuntu) VPS: Nginx reverse proxy, PM2 process management, SSL via
Let's Encrypt, and TURN server setup.

## Notes

- Consider adding chat moderation features
- Implement user reporting system for safety
