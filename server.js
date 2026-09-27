const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

// Enable CORS & static files
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory room storage
const rooms = new Map();

/**
 * YouTube Video ID extraction helper
 */
function extractYouTubeId(url) {
  if (!url) return null;
  const regExp = /(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/;
  const match = url.match(regExp);
  return match ? match[1] : null;
}

/**
 * Determine video type: 'youtube' or 'direct'
 */
function detectVideoType(url) {
  const ytId = extractYouTubeId(url);
  if (ytId) {
    return { type: 'youtube', videoId: ytId };
  }
  return { type: 'direct', videoId: null };
}

/**
 * Generate random readable room code (e.g. LOVE-842 or ABC123)
 */
function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 6; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

/**
 * Clean up empty rooms after 30 minutes of inactivity
 */
setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of rooms.entries()) {
    if (Object.keys(room.users).length === 0 && now - room.lastActive > 30 * 60 * 1000) {
      rooms.delete(roomId);
      console.log(`[Cleaner] Oda temizlendi: ${roomId}`);
    }
  }
}, 5 * 60 * 1000);

// SPA routing - deliver index.html on /room/:id
app.get('/room/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API endpoint to check if room exists
app.get('/api/room/:roomId', (req, res) => {
  const { roomId } = req.params;
  const room = rooms.get(roomId.toUpperCase());
  if (room) {
    res.json({
      exists: true,
      roomId: room.id,
      userCount: Object.keys(room.users).length,
      hasVideo: !!room.video.url
    });
  } else {
    res.json({ exists: false });
  }
});

// Socket.IO Connection Logic
io.on('connection', (socket) => {
  let currentRoomId = null;

  // Create a new room
  socket.on('create_room', ({ userName }, callback) => {
    const roomId = generateRoomId();
    const hostToken = crypto.randomBytes(16).toString('hex');

    const newRoom = {
      id: roomId,
      hostToken: hostToken,
      hostSocketId: socket.id,
      createdAt: Date.now(),
      lastActive: Date.now(),
      video: {
        url: '',
        type: null,
        videoId: null,
        isPlaying: false,
        currentTime: 0,
        lastUpdate: Date.now()
      },
      users: {},
      chatMessages: []
    };

    rooms.set(roomId, newRoom);
    console.log(`[Oda Oluşturuldu] ID: ${roomId} - Kurucu: ${userName || 'İsimsiz'}`);

    if (typeof callback === 'function') {
      callback({
        success: true,
        roomId: roomId,
        hostToken: hostToken
      });
    }
  });

  // Join an existing room
  socket.on('join_room', ({ roomId, userName, hostToken }, callback) => {
    const cleanRoomId = (roomId || '').trim().toUpperCase();
    const room = rooms.get(cleanRoomId);

    if (!room) {
      if (typeof callback === 'function') {
        callback({ success: false, message: 'Oda bulunamadı veya süresi dolmuş.' });
      }
      return;
    }

    currentRoomId = cleanRoomId;
    socket.join(cleanRoomId);

    // Host status check: matching token or if room has no host currently connected
    const isHost = Boolean(hostToken && hostToken === room.hostToken);
    if (isHost) {
      room.hostSocketId = socket.id;
    }

    const userData = {
      socketId: socket.id,
      name: (userName && userName.trim()) || (isHost ? 'Host' : 'Misafir'),
      isHost: isHost,
      joinedAt: Date.now()
    };

    room.users[socket.id] = userData;
    room.lastActive = Date.now();

    // System welcome message
    const welcomeMsg = {
      id: crypto.randomUUID(),
      senderName: 'Sistem',
      isHost: false,
      text: `${userData.name} ${isHost ? '(Host)' : ''} odaya katıldı! ✨`,
      timestamp: Date.now(),
      isSystem: true
    };
    room.chatMessages.push(welcomeMsg);

    // Notify others in room
    socket.to(cleanRoomId).emit('user_joined', {
      user: userData,
      users: Object.values(room.users),
      systemMessage: welcomeMsg
    });

    // Send full current room state to joining user
    if (typeof callback === 'function') {
      callback({
        success: true,
        roomId: cleanRoomId,
        isHost: isHost,
        user: userData,
        users: Object.values(room.users),
        video: room.video,
        chatMessages: room.chatMessages
      });
    }
  });

  // Set / Change video (Only host can do this)
  socket.on('set_video', ({ roomId, url, hostToken }, callback) => {
    const cleanRoomId = (roomId || '').trim().toUpperCase();
    const room = rooms.get(cleanRoomId);

    if (!room) return;

    // Verify host
    if (hostToken !== room.hostToken && socket.id !== room.hostSocketId) {
      if (typeof callback === 'function') {
        callback({ success: false, message: 'Yalnızca oda sahibi video değiştirebilir.' });
      }
      return;
    }

    const { type, videoId } = detectVideoType(url);
    room.video = {
      url: url,
      type: type,
      videoId: videoId,
      isPlaying: false,
      currentTime: 0,
      lastUpdate: Date.now()
    };
    room.lastActive = Date.now();

    const changeMsg = {
      id: crypto.randomUUID(),
      senderName: 'Sistem',
      isHost: false,
      text: `🎬 Video değiştirildi: ${type === 'youtube' ? 'YouTube Videosu' : 'Doğrudan Video Bağlantısı'}`,
      timestamp: Date.now(),
      isSystem: true
    };
    room.chatMessages.push(changeMsg);

    io.to(cleanRoomId).emit('video_changed', {
      video: room.video,
      systemMessage: changeMsg
    });

    if (typeof callback === 'function') {
      callback({ success: true, video: room.video });
    }
  });

  // Host playback actions: play, pause, seek
  socket.on('host_playback_action', ({ roomId, action, currentTime, hostToken }) => {
    const cleanRoomId = (roomId || '').trim().toUpperCase();
    const room = rooms.get(cleanRoomId);

    if (!room) return;

    // Only host can trigger sync actions
    if (hostToken !== room.hostToken && socket.id !== room.hostSocketId) {
      return;
    }

    room.lastActive = Date.now();
    room.video.currentTime = currentTime || 0;
    room.video.lastUpdate = Date.now();

    if (action === 'play') {
      room.video.isPlaying = true;
    } else if (action === 'pause') {
      room.video.isPlaying = false;
    }

    // Broadcast action to all other participants in the room
    socket.to(cleanRoomId).emit('sync_action', {
      action: action,
      currentTime: currentTime,
      isPlaying: room.video.isPlaying,
      serverTime: Date.now()
    });
  });

  // Host periodic heartbeat (drift correction)
  socket.on('host_heartbeat', ({ roomId, currentTime, isPlaying, hostToken }) => {
    const cleanRoomId = (roomId || '').trim().toUpperCase();
    const room = rooms.get(cleanRoomId);

    if (!room) return;

    if (hostToken !== room.hostToken && socket.id !== room.hostSocketId) {
      return;
    }

    room.video.currentTime = currentTime;
    room.video.isPlaying = isPlaying;
    room.video.lastUpdate = Date.now();

    // Forward heartbeat to guests for drift check
    socket.to(cleanRoomId).emit('sync_drift', {
      currentTime: currentTime,
      isPlaying: isPlaying,
      serverTime: Date.now()
    });
  });

  // Force sync request from guest
  socket.on('request_sync', ({ roomId }) => {
    const cleanRoomId = (roomId || '').trim().toUpperCase();
    const room = rooms.get(cleanRoomId);
    if (!room) return;

    // Send latest known state back to the requester
    socket.emit('sync_action', {
      action: room.video.isPlaying ? 'play' : 'pause',
      currentTime: room.video.currentTime,
      isPlaying: room.video.isPlaying,
      serverTime: Date.now()
    });
  });

  // Live Chat messages
  socket.on('send_chat', ({ roomId, text }) => {
    const cleanRoomId = (roomId || '').trim().toUpperCase();
    const room = rooms.get(cleanRoomId);

    if (!room || !text || !text.trim()) return;

    const sender = room.users[socket.id] || { name: 'Kullanıcı', isHost: false };
    const chatMsg = {
      id: crypto.randomUUID(),
      senderName: sender.name,
      isHost: sender.isHost,
      text: text.trim().slice(0, 500),
      timestamp: Date.now(),
      isSystem: false
    };

    room.chatMessages.push(chatMsg);
    // Keep max 200 messages in memory
    if (room.chatMessages.length > 200) {
      room.chatMessages.shift();
    }
    room.lastActive = Date.now();

    io.to(cleanRoomId).emit('new_chat_message', chatMsg);
  });

  // Floating emoji reactions (e.g. 💖, 🍿, 😂, 🥺)
  socket.on('send_reaction', ({ roomId, emoji }) => {
    const cleanRoomId = (roomId || '').trim().toUpperCase();
    const room = rooms.get(cleanRoomId);
    if (!room) return;

    const sender = room.users[socket.id] || { name: 'Biri' };
    io.to(cleanRoomId).emit('new_reaction', {
      emoji: emoji || '💖',
      senderName: sender.name,
      id: crypto.randomUUID()
    });
  });

  // Disconnect handler
  socket.on('disconnect', () => {
    if (currentRoomId) {
      const room = rooms.get(currentRoomId);
      if (room && room.users[socket.id]) {
        const departedUser = room.users[socket.id];
        delete room.users[socket.id];
        room.lastActive = Date.now();

        const leaveMsg = {
          id: crypto.randomUUID(),
          senderName: 'Sistem',
          isHost: false,
          text: `${departedUser.name} ayrıldı. ⏳`,
          timestamp: Date.now(),
          isSystem: true
        };
        room.chatMessages.push(leaveMsg);

        io.to(currentRoomId).emit('user_left', {
          socketId: socket.id,
          userName: departedUser.name,
          isHost: departedUser.isHost,
          users: Object.values(room.users),
          systemMessage: leaveMsg
        });

        console.log(`[Ayrılma] ${departedUser.name} odadan ayrıldı: ${currentRoomId}`);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`🎬 Dizi/Film Watch Party Sunucusu Çalışıyor!`);
  console.log(`🚀 Adres: http://localhost:${PORT}`);
  console.log(`===============================================`);
});
