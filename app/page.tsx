'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import io, { Socket } from 'socket.io-client';

const SIGNALING_URL = process.env.NEXT_PUBLIC_SIGNALING_URL || 'http://localhost:3001';

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  ...(process.env.NEXT_PUBLIC_TURN_URL
    ? [{
        urls: process.env.NEXT_PUBLIC_TURN_URL,
        username: process.env.NEXT_PUBLIC_TURN_USERNAME,
        credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
      }]
    : []),
];

type Status = 'idle' | 'searching' | 'connected';

export default function VideoChat() {
  const [status, setStatus] = useState<Status>('idle');
  const [onlineCount, setOnlineCount] = useState<number | null>(null);
  const [peerTyping, setPeerTyping] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [messages, setMessages] = useState<Array<{ sender: string; text: string }>>([]);
  const [inputMessage, setInputMessage] = useState('');

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const createPeerConnection = useCallback(() => {
    const peerConnection = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        peerConnection.addTrack(track, localStreamRef.current!);
      });
    }

    peerConnection.ontrack = (event) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    peerConnection.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit('ice-candidate', event.candidate);
      }
    };

    peerConnectionRef.current = peerConnection;
    pendingCandidatesRef.current = [];
    return peerConnection;
  }, []);

  const createOffer = useCallback(async () => {
    const peerConnection = createPeerConnection();
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socketRef.current?.emit('offer', offer);
  }, [createPeerConnection]);

  const handleOffer = useCallback(async (offer: RTCSessionDescriptionInit) => {
    const peerConnection = createPeerConnection();
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

    for (const candidate of pendingCandidatesRef.current) {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
    pendingCandidatesRef.current = [];

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socketRef.current?.emit('answer', answer);
  }, [createPeerConnection]);

  const handleAnswer = useCallback(async (answer: RTCSessionDescriptionInit) => {
    const peerConnection = peerConnectionRef.current;
    if (!peerConnection) return;

    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));

    for (const candidate of pendingCandidatesRef.current) {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
    pendingCandidatesRef.current = [];
  }, []);

  const handleIceCandidate = useCallback(async (candidate: RTCIceCandidateInit) => {
    const peerConnection = peerConnectionRef.current;
    if (peerConnection && peerConnection.remoteDescription) {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } else {
      pendingCandidatesRef.current.push(candidate);
    }
  }, []);

  const teardownPeerConnection = useCallback(() => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    pendingCandidatesRef.current = [];
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
  }, []);

  useEffect(() => {
    const socket = io(SIGNALING_URL);
    socketRef.current = socket;

    socket.on('online-count', (count: number) => setOnlineCount(count));

    socket.on('matched', async (data: { peerId: string; initiator: boolean }) => {
      setStatus('connected');
      setMessages([]);
      if (data.initiator) {
        await createOffer();
      }
    });

    socket.on('offer', handleOffer);
    socket.on('answer', handleAnswer);
    socket.on('ice-candidate', handleIceCandidate);

    socket.on('peer-disconnected', () => {
      teardownPeerConnection();
      setStatus('idle');
      setPeerTyping(false);
    });

    socket.on('message', (text: string) => {
      setMessages((prev) => [...prev, { sender: 'Stranger', text }]);
      setPeerTyping(false);
    });

    socket.on('typing', (isTyping: boolean) => setPeerTyping(isTyping));

    return () => {
      socket.disconnect();
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      teardownPeerConnection();
    };
  }, [createOffer, handleOffer, handleAnswer, handleIceCandidate, teardownPeerConnection]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, peerTyping]);

  const ensureLocalStream = async () => {
    if (localStreamRef.current) return localStreamRef.current;

    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localStreamRef.current = stream;
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
    }
    return stream;
  };

  const findStranger = async () => {
    try {
      await ensureLocalStream();
    } catch (error) {
      console.error('Error accessing media devices:', error);
      alert('Please allow camera and microphone access to start chatting.');
      return;
    }

    setStatus('searching');
    socketRef.current?.emit('find-peer');
  };

  const cancelSearch = () => {
    socketRef.current?.emit('cancel-find');
    setStatus('idle');
  };

  const skipStranger = () => {
    teardownPeerConnection();
    setMessages([]);
    setPeerTyping(false);
    setStatus('searching');
    socketRef.current?.emit('skip');
  };

  const stopChat = () => {
    socketRef.current?.emit('cancel-find');
    teardownPeerConnection();
    setStatus('idle');
    setMessages([]);
    setPeerTyping(false);
  };

  const sendMessage = () => {
    const text = inputMessage.trim();
    if (!text || !socketRef.current) return;

    socketRef.current.emit('message', text);
    setMessages((prev) => [...prev, { sender: 'You', text }]);
    setInputMessage('');
    socketRef.current.emit('typing', false);
  };

  const handleInputChange = (value: string) => {
    setInputMessage(value);
    if (!socketRef.current) return;

    socketRef.current.emit('typing', value.length > 0);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      socketRef.current?.emit('typing', false);
    }, 2000);
  };

  const toggleMic = () => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMicOn(track.enabled);
  };

  const toggleCam = () => {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setCamOn(track.enabled);
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-4">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-center gap-3 mb-8">
          <h1 className="text-4xl font-bold text-center">Video Chat</h1>
          {onlineCount !== null && (
            <span className="flex items-center gap-1.5 text-sm text-gray-400 bg-gray-800 px-3 py-1 rounded-full">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              {onlineCount} online
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Video Section */}
          <div className="lg:col-span-2">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Local Video */}
              <div className="relative bg-black rounded-lg overflow-hidden aspect-video">
                <video
                  ref={localVideoRef}
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-full object-cover"
                />
                <div className="absolute bottom-2 left-2 bg-black/50 px-2 py-1 rounded text-sm">
                  You
                </div>
                {status !== 'idle' && (
                  <div className="absolute bottom-2 right-2 flex gap-2">
                    <button
                      onClick={toggleMic}
                      title={micOn ? 'Mute microphone' : 'Unmute microphone'}
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${
                        micOn ? 'bg-black/50 hover:bg-black/70' : 'bg-red-600 hover:bg-red-700'
                      }`}
                    >
                      {micOn ? '🎤' : '🔇'}
                    </button>
                    <button
                      onClick={toggleCam}
                      title={camOn ? 'Turn camera off' : 'Turn camera on'}
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${
                        camOn ? 'bg-black/50 hover:bg-black/70' : 'bg-red-600 hover:bg-red-700'
                      }`}
                    >
                      {camOn ? '📷' : '🚫'}
                    </button>
                  </div>
                )}
              </div>

              {/* Remote Video */}
              <div className="relative bg-black rounded-lg overflow-hidden aspect-video">
                {status === 'connected' ? (
                  <video
                    ref={remoteVideoRef}
                    autoPlay
                    playsInline
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <p className="text-gray-400">
                      {status === 'searching' ? 'Searching for a stranger...' : 'No stranger connected'}
                    </p>
                  </div>
                )}
                <div className="absolute bottom-2 left-2 bg-black/50 px-2 py-1 rounded text-sm">
                  Stranger
                </div>
              </div>
            </div>

            {/* Controls */}
            <div className="mt-4 flex gap-4 justify-center">
              {status === 'idle' && (
                <button
                  onClick={findStranger}
                  className="bg-blue-600 hover:bg-blue-700 px-6 py-3 rounded-lg font-semibold"
                >
                  Start Chat
                </button>
              )}

              {status === 'searching' && (
                <button
                  onClick={cancelSearch}
                  className="bg-gray-600 hover:bg-gray-700 px-6 py-3 rounded-lg font-semibold"
                >
                  Cancel
                </button>
              )}

              {status === 'connected' && (
                <>
                  <button
                    onClick={skipStranger}
                    className="bg-orange-600 hover:bg-orange-700 px-6 py-3 rounded-lg font-semibold"
                  >
                    Skip
                  </button>
                  <button
                    onClick={stopChat}
                    className="bg-red-600 hover:bg-red-700 px-6 py-3 rounded-lg font-semibold"
                  >
                    Stop
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Chat Section */}
          <div className="bg-gray-800 rounded-lg p-4 flex flex-col h-[500px]">
            <h2 className="text-xl font-semibold mb-4">Chat</h2>

            <div className="flex-1 overflow-y-auto mb-4 space-y-2">
              {messages.map((msg, index) => (
                <div
                  key={index}
                  className={`p-2 rounded ${
                    msg.sender === 'You' ? 'bg-blue-600 ml-auto' : 'bg-gray-700'
                  } max-w-[80%] ${msg.sender === 'You' ? 'text-right' : ''}`}
                >
                  <div className="text-xs opacity-75">{msg.sender}</div>
                  <div>{msg.text}</div>
                </div>
              ))}
              {peerTyping && (
                <div className="p-2 rounded bg-gray-700 max-w-[80%] text-sm text-gray-400 italic">
                  Stranger is typing...
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={inputMessage}
                onChange={(e) => handleInputChange(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                placeholder="Type a message..."
                className="flex-1 bg-gray-700 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={status !== 'connected'}
              />
              <button
                onClick={sendMessage}
                disabled={status !== 'connected'}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 px-4 py-2 rounded font-semibold"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
