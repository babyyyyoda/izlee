/**
 * Birlikte İzle (Watch Party) - Client Application Logic
 * Supports BOTH:
 * 1) Local / Node.js Server mode (Socket.IO)
 * 2) Vercel / Serverless / Static mode (WebRTC Peer-to-Peer via PeerJS)
 */

// Application State
const state = {
  networkMode: 'socket', // 'socket' or 'p2p'
  socket: null,
  peer: null,
  peerConnections: [], // if host: list of connected guests
  hostConn: null, // if guest: connection to host
  roomId: null,
  userName: localStorage.getItem('watchparty_username') || '',
  isHost: false,
  hostToken: null,
  currentVideo: {
    url: '',
    type: null,
    videoId: null,
    isPlaying: false,
    currentTime: 0
  },
  playerType: null, // 'youtube' | 'direct' | null
  ytPlayer: null,
  ytReady: false,
  isRemoteAction: false,
  heartbeatInterval: null,
  uiUpdateInterval: null,
  isSeeking: false,
  participants: [],
  chatMessages: []
};

// Free Public STUN servers for WebRTC
const PEER_CONFIG = {
  debug: 0,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' }
    ]
  }
};

// DOM Elements Cache
const dom = {
  // Views
  viewLobby: document.getElementById('view-lobby'),
  viewRoom: document.getElementById('view-room'),

  // Lobby
  inputUserName: document.getElementById('input-user-name'),
  btnCreateRoom: document.getElementById('btn-create-room'),
  btnJoinRoom: document.getElementById('btn-join-room'),
  inputRoomCode: document.getElementById('input-room-code'),
  joinDetectedBox: document.getElementById('join-detected-container'),
  detectedRoomId: document.getElementById('detected-room-id'),
  btnJoinDetected: document.getElementById('btn-join-detected'),
  defaultLobbyActions: document.getElementById('default-lobby-actions'),

  // Room Header
  displayRoomId: document.getElementById('display-room-id'),
  btnCopyRoomLink: document.getElementById('btn-copy-room-link'),
  copyStatusIcon: document.getElementById('copy-status-icon'),
  partnerStatusBadge: document.getElementById('partner-status-badge'),
  partnerStatusText: document.getElementById('partner-status-text'),
  myRoleBadge: document.getElementById('my-role-badge'),
  myRoleIcon: document.getElementById('my-role-icon'),
  myRoleText: document.getElementById('my-role-text'),
  btnShareLink: document.getElementById('btn-share-link'),
  btnLeaveRoom: document.getElementById('btn-leave-room'),

  // Video Source & Controls
  hostSourceControls: document.getElementById('host-source-controls'),
  inputVideoUrl: document.getElementById('input-video-url'),
  btnLoadVideo: document.getElementById('btn-load-video'),
  quickSamplesBar: document.getElementById('quick-samples-bar'),
  guestSourceNotice: document.getElementById('guest-source-notice'),
  guestVideoTitle: document.getElementById('guest-video-title'),

  // Player Elements
  playerPlaceholder: document.getElementById('player-placeholder'),
  placeholderMessage: document.getElementById('placeholder-message'),
  ytPlayerTarget: document.getElementById('yt-player-target'),
  html5VideoPlayer: document.getElementById('html5-video-player'),
  unmuteOverlay: document.getElementById('unmute-overlay'),
  btnUnmute: document.getElementById('btn-unmute'),
  guestShieldOverlay: document.getElementById('guest-shield-overlay'),

  // Playback Controls
  btnHostTogglePlay: document.getElementById('btn-host-toggle-play'),
  playBtnIcon: document.getElementById('play-btn-icon'),
  playBtnText: document.getElementById('play-btn-text'),
  currentTimeText: document.getElementById('current-time-text'),
  totalTimeText: document.getElementById('total-time-text'),
  seekContainer: document.getElementById('seek-container'),
  progressBuffered: document.getElementById('progress-buffered'),
  progressFill: document.getElementById('progress-fill'),
  progressThumb: document.getElementById('progress-thumb'),
  syncStatusIndicator: document.getElementById('sync-status-indicator'),
  syncText: document.getElementById('sync-text'),
  btnForceSync: document.getElementById('btn-force-sync'),

  // Chat & Reactions
  usersCountBadge: document.getElementById('users-count-badge'),
  usersPillList: document.getElementById('users-pill-list'),
  chatMessagesContainer: document.getElementById('chat-messages-container'),
  chatForm: document.getElementById('chat-form'),
  inputChatMessage: document.getElementById('input-chat-message'),
  reactionsContainer: document.getElementById('reactions-container'),

  // Modal & Toast
  modalShare: document.getElementById('modal-share'),
  shareLinkInput: document.getElementById('share-link-input'),
  btnModalCopy: document.getElementById('btn-modal-copy'),
  btnCloseModal: document.getElementById('btn-close-modal'),
  toastContainer: document.getElementById('toast-container')
};

// ==========================================================================
// INITIALIZATION & URL ROUTING
// ==========================================================================

window.addEventListener('DOMContentLoaded', () => {
  // Initialize Network (Socket.IO with P2P WebRTC fallback for Vercel)
  initNetwork();

  // Restore stored name if any
  if (state.userName && dom.inputUserName) {
    dom.inputUserName.value = state.userName;
  }

  // Detect room from URL path (e.g. /room/ABC123) or query string (?room=ABC123)
  detectRoomFromUrl();

  // Setup Event Listeners
  setupEventListeners();

  // Start smooth UI timer (updates progress bar & current time display)
  startUiProgressTimer();
});

// YouTube API Callback (called when YouTube script loads)
window.onYouTubeIframeAPIReady = () => {
  state.ytReady = true;
  console.log('[YouTube API] IFrame API Hazır.');
  if (state.currentVideo.type === 'youtube' && state.currentVideo.videoId) {
    loadYouTubeVideo(state.currentVideo.videoId, state.currentVideo.currentTime);
  }
};

/**
 * Check if the browser URL indicates a specific room to join
 */
function detectRoomFromUrl() {
  const path = window.location.pathname;
  const match = path.match(/\/room\/([a-zA-Z0-9_-]+)/i);
  let detectedId = null;

  if (match && match[1]) {
    detectedId = match[1].toUpperCase();
  } else {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('room')) {
      detectedId = urlParams.get('room').toUpperCase();
    }
  }

  if (detectedId) {
    state.roomId = detectedId;
    dom.detectedRoomId.textContent = detectedId;
    dom.joinDetectedBox.classList.remove('hidden');
    dom.inputRoomCode.value = detectedId;
  }
}

// ==========================================================================
// NETWORK INITIALIZATION (HYBRID: SOCKET.IO + P2P WEBRTC)
// ==========================================================================

function initNetwork() {
  // Check if we are running in an environment with Socket.IO server
  if (typeof io !== 'undefined') {
    try {
      state.socket = io({
        reconnection: true,
        reconnectionAttempts: 2,
        timeout: 2500
      });

      let socketConnected = false;

      state.socket.on('connect', () => {
        socketConnected = true;
        state.networkMode = 'socket';
        console.log('[Network] Socket.IO sunucusuna bağlanıldı. Mod: Sunucu');
        setupSocketEvents();
      });

      state.socket.on('connect_error', () => {
        if (!socketConnected) {
          switchToP2PMode('Socket sunucusuna bağlanılamadı. Vercel P2P (WebRTC) moduna geçiliyor.');
        }
      });
    } catch (e) {
      switchToP2PMode('Socket.IO hatası, P2P moduna geçiliyor.');
    }
  } else {
    switchToP2PMode('Socket.IO kütüphanesi yok, P2P moduna geçiliyor.');
  }
}

function switchToP2PMode(reason) {
  state.networkMode = 'p2p';
  console.log(`[Network] ${reason || 'P2P (WebRTC) aktif.'}`);
}

function setupSocketEvents() {
  if (!state.socket) return;

  state.socket.on('user_joined', ({ user, users, systemMessage }) => {
    state.participants = users;
    updateParticipantsUI(users);
    if (systemMessage) appendChatMessage(systemMessage);
    showToast(`${user.name} odaya katıldı!`, 'info');
  });

  state.socket.on('user_left', ({ userName, users, systemMessage }) => {
    state.participants = users;
    updateParticipantsUI(users);
    if (systemMessage) appendChatMessage(systemMessage);
    showToast(`${userName} ayrıldı.`, 'info');
  });

  state.socket.on('video_changed', ({ video, systemMessage }) => {
    state.currentVideo = video;
    if (systemMessage) appendChatMessage(systemMessage);
    applyVideoChange(video);
    showToast('Yeni video yüklendi!', 'success');
  });

  state.socket.on('sync_action', ({ action, currentTime, isPlaying, serverTime }) => {
    if (state.isHost) return;
    handleRemoteSyncAction(action, currentTime, isPlaying, serverTime);
  });

  state.socket.on('sync_drift', ({ currentTime, isPlaying, serverTime }) => {
    if (state.isHost) return;
    handleDriftCorrection(currentTime, isPlaying, serverTime);
  });

  state.socket.on('new_chat_message', (msg) => {
    appendChatMessage(msg);
  });

  state.socket.on('new_reaction', ({ emoji, senderName }) => {
    spawnFloatingReaction(emoji, senderName);
  });
}

// ==========================================================================
// P2P WEBRTC LOGIC (FOR VERCEL / SERVERLESS DEPLOYMENT)
// ==========================================================================

function getPeerRoomId(roomId) {
  return `izleparty_v1_${roomId.toLowerCase()}`;
}

function initP2PHost(roomId, callback) {
  if (typeof Peer === 'undefined') {
    showToast('WebRTC (PeerJS) yüklenemedi. İnternet bağlantınızı kontrol edin.', 'error');
    return;
  }

  const hostPeerId = getPeerRoomId(roomId);
  state.peer = new Peer(hostPeerId, PEER_CONFIG);

  state.peer.on('open', (id) => {
    console.log('[P2P Host] Oda açıldı, Peer ID:', id);
    state.isHost = true;
    state.participants = [{ socketId: 'host', name: state.userName, isHost: true }];
    if (callback) callback({ success: true, roomId, isHost: true });
  });

  state.peer.on('connection', (conn) => {
    console.log('[P2P Host] Partner bağlandı!');
    state.peerConnections.push(conn);

    conn.on('open', () => {
      // Send initial room state to guest
      conn.send({
        type: 'init_room_state',
        video: state.currentVideo,
        chatMessages: state.chatMessages
      });
    });

    conn.on('data', (data) => {
      handleP2PIncomingData(data, conn);
    });

    conn.on('close', () => {
      state.peerConnections = state.peerConnections.filter(c => c !== conn);
      state.participants = [{ socketId: 'host', name: state.userName, isHost: true }];
      updateParticipantsUI(state.participants);
      appendChatMessage({
        id: Math.random().toString(),
        senderName: 'Sistem',
        isHost: false,
        text: 'Partner odadan ayrıldı. ⏳',
        timestamp: Date.now(),
        isSystem: true
      });
    });
  });

  state.peer.on('error', (err) => {
    console.warn('[P2P Host Hatası]:', err);
    if (err.type === 'unavailable-id') {
      showToast('Bu oda kodu şu anda kullanımda, yeni oda oluşturuluyor...', 'info');
      createRoom();
    }
  });

  window.addEventListener('beforeunload', () => {
    if (state.peer) state.peer.destroy();
  });
}

function initP2PGuest(roomId, callback) {
  if (typeof Peer === 'undefined') {
    showToast('WebRTC (PeerJS) yüklenemedi. Lütfen sayfayı yenileyin.', 'error');
    return;
  }

  state.peer = new Peer(null, PEER_CONFIG);

  state.peer.on('open', () => {
    const targetHostId = getPeerRoomId(roomId);
    console.log(`[P2P Guest] Host'a bağlanılıyor: ${targetHostId}`);

    const conn = state.peer.connect(targetHostId, { reliable: true });
    state.hostConn = conn;

    conn.on('open', () => {
      console.log('[P2P Guest] Host ile WebRTC bağlantısı kuruldu!');
      // Announce guest
      conn.send({
        type: 'guest_join',
        userName: state.userName
      });

      if (callback) {
        callback({
          success: true,
          roomId: roomId,
          isHost: false,
          users: [
            { socketId: 'host', name: 'Host', isHost: true },
            { socketId: 'guest', name: state.userName, isHost: false }
          ],
          video: state.currentVideo,
          chatMessages: state.chatMessages
        });
      }
    });

    conn.on('data', (data) => {
      handleP2PIncomingData(data, conn);
    });

    conn.on('close', () => {
      showToast('Host bağlantısı koptu.', 'error');
      dom.partnerStatusBadge.className = 'status-badge waiting';
      dom.partnerStatusText.textContent = 'Host bekleniyor... ⏳';
    });
  });

  state.peer.on('error', (err) => {
    console.warn('[P2P Guest Hatası]:', err);
    showToast('Oda bulunamadı veya Host henüz çevrimiçi değil.', 'error');
  });

  window.addEventListener('beforeunload', () => {
    if (state.peer) state.peer.destroy();
  });
}

function handleP2PIncomingData(data, sourceConn) {
  if (!data || !data.type) return;

  switch (data.type) {
    case 'init_room_state':
      state.currentVideo = data.video || state.currentVideo;
      if (data.chatMessages) {
        data.chatMessages.forEach(msg => appendChatMessage(msg, false));
      }
      if (state.currentVideo && state.currentVideo.url) {
        applyVideoChange(state.currentVideo);
      }
      break;

    case 'guest_join':
      state.participants = [
        { socketId: 'host', name: state.userName, isHost: true },
        { socketId: 'guest', name: data.userName, isHost: false }
      ];
      updateParticipantsUI(state.participants);

      const joinMsg = {
        id: Math.random().toString(),
        senderName: 'Sistem',
        isHost: false,
        text: `${data.userName} odaya katıldı! ✨`,
        timestamp: Date.now(),
        isSystem: true
      };
      appendChatMessage(joinMsg);

      // Notify guest back with updated user list
      broadcastP2P({
        type: 'user_list_update',
        users: state.participants,
        systemMessage: joinMsg
      });
      break;

    case 'user_list_update':
      state.participants = data.users;
      updateParticipantsUI(data.users);
      if (data.systemMessage) appendChatMessage(data.systemMessage);
      break;

    case 'video_changed':
      state.currentVideo = data.video;
      applyVideoChange(data.video);
      if (data.systemMessage) appendChatMessage(data.systemMessage);
      showToast('Yeni video yüklendi!', 'success');
      break;

    case 'sync_action':
      if (!state.isHost) {
        handleRemoteSyncAction(data.action, data.currentTime, data.isPlaying, data.serverTime);
      }
      break;

    case 'sync_drift':
      if (!state.isHost) {
        handleDriftCorrection(data.currentTime, data.isPlaying, data.serverTime);
      }
      break;

    case 'chat_message':
      appendChatMessage(data.message);
      // If host, forward to other guests
      if (state.isHost) {
        state.peerConnections.forEach(c => {
          if (c !== sourceConn) c.send(data);
        });
      }
      break;

    case 'reaction':
      spawnFloatingReaction(data.emoji, data.senderName);
      if (state.isHost) {
        state.peerConnections.forEach(c => {
          if (c !== sourceConn) c.send(data);
        });
      }
      break;
  }
}

function broadcastP2P(data) {
  if (state.isHost) {
    state.peerConnections.forEach(conn => {
      try { conn.send(data); } catch (e) { }
    });
  } else if (state.hostConn) {
    try { state.hostConn.send(data); } catch (e) { }
  }
}

// ==========================================================================
// ROOM CREATION & JOINING
// ==========================================================================

function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 6; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

function createRoom() {
  const name = (dom.inputUserName.value || '').trim() || 'Ev Sahibi';
  state.userName = name;
  localStorage.setItem('watchparty_username', name);

  if (state.networkMode === 'socket' && state.socket && state.socket.connected) {
    state.socket.emit('create_room', { userName: name }, (response) => {
      if (response && response.success) {
        state.roomId = response.roomId;
        state.isHost = true;
        state.hostToken = response.hostToken;
        localStorage.setItem(`watchparty_host_${response.roomId}`, response.hostToken);
        joinRoom(response.roomId, name, response.hostToken);
      } else {
        showToast('Oda oluşturulurken hata oluştu.', 'error');
      }
    });
  } else {
    // P2P / Vercel mode
    const roomId = generateRoomId();
    state.roomId = roomId;
    initP2PHost(roomId, (res) => {
      window.history.pushState(null, '', `/room/${roomId}`);
      switchToRoomView({
        roomId: roomId,
        isHost: true,
        users: [{ socketId: 'host', name: name, isHost: true }],
        video: state.currentVideo,
        chatMessages: []
      });
    });
  }
}

function joinRoom(roomId, userName, hostToken) {
  const cleanRoomId = (roomId || '').trim().toUpperCase();
  if (!cleanRoomId) {
    showToast('Lütfen geçerli bir oda kodu girin.', 'error');
    return;
  }

  const name = (userName || dom.inputUserName.value || '').trim() || 'Misafir';
  state.userName = name;
  localStorage.setItem('watchparty_username', name);

  if (state.networkMode === 'socket' && state.socket && state.socket.connected) {
    const token = hostToken || localStorage.getItem(`watchparty_host_${cleanRoomId}`) || null;
    state.socket.emit('join_room', {
      roomId: cleanRoomId,
      userName: name,
      hostToken: token
    }, (response) => {
      if (response && response.success) {
        state.roomId = response.roomId;
        state.isHost = response.isHost;
        state.hostToken = token;
        state.participants = response.users || [];
        window.history.pushState(null, '', `/room/${response.roomId}`);
        switchToRoomView(response);
      } else {
        showToast(response.message || 'Odaya katılırken hata oluştu.', 'error');
      }
    });
  } else {
    // P2P / Vercel mode
    state.roomId = cleanRoomId;
    initP2PGuest(cleanRoomId, (res) => {
      window.history.pushState(null, '', `/room/${cleanRoomId}`);
      switchToRoomView(res);
    });
  }
}

function switchToRoomView(roomData) {
  dom.viewLobby.classList.remove('active');
  dom.viewLobby.classList.add('hidden');
  dom.viewRoom.classList.remove('hidden');
  dom.viewRoom.classList.add('active');

  // Set Header Info
  dom.displayRoomId.textContent = roomData.roomId;

  // Set Role UI
  if (state.isHost) {
    dom.myRoleBadge.className = 'role-badge host';
    dom.myRoleIcon.textContent = '👑';
    dom.myRoleText.textContent = 'Host (Kontrol Sende)';
    dom.hostSourceControls.classList.remove('hidden');
    dom.quickSamplesBar.classList.remove('hidden');
    dom.guestSourceNotice.classList.add('hidden');
    dom.guestShieldOverlay.classList.add('hidden');
    dom.btnHostTogglePlay.style.display = 'inline-flex';

    startHostHeartbeat();
  } else {
    dom.myRoleBadge.className = 'role-badge guest';
    dom.myRoleIcon.textContent = '👤';
    dom.myRoleText.textContent = 'Misafir (İzleyici)';
    dom.hostSourceControls.classList.add('hidden');
    dom.quickSamplesBar.classList.add('hidden');
    dom.guestSourceNotice.classList.remove('hidden');
    dom.guestShieldOverlay.classList.remove('hidden');
    dom.btnHostTogglePlay.style.display = 'none';
  }

  // Update Participants
  updateParticipantsUI(roomData.users || []);

  // Load existing chat history
  dom.chatMessagesContainer.innerHTML = '';
  if (roomData.chatMessages && roomData.chatMessages.length > 0) {
    roomData.chatMessages.forEach(msg => appendChatMessage(msg, false));
  }

  // If video is set, load it!
  if (roomData.video && roomData.video.url) {
    state.currentVideo = roomData.video;
    applyVideoChange(roomData.video);
  }

  showToast(`Odaya hoş geldiniz! Kod: ${roomData.roomId}`, 'success');
}

function updateParticipantsUI(users) {
  if (!users) return;
  const count = users.length;
  dom.usersCountBadge.textContent = `👥 ${count} Kişi`;

  const otherUsers = users.filter(u => u.name !== state.userName);
  if (otherUsers.length > 0) {
    dom.partnerStatusBadge.className = 'status-badge connected';
    dom.partnerStatusText.textContent = `Partner bağlı: ${otherUsers[0].name} 💚`;
  } else {
    dom.partnerStatusBadge.className = 'status-badge waiting';
    dom.partnerStatusText.textContent = 'Partner bekleniyor... ⏳';
  }

  // Mini user list pills
  dom.usersPillList.innerHTML = '';
  users.forEach(user => {
    const pill = document.createElement('div');
    const isMe = (user.name === state.userName);
    pill.className = `user-pill ${isMe ? 'is-me' : ''} ${user.isHost ? 'is-host' : ''}`;
    pill.innerHTML = `
      <span>${user.isHost ? '👑' : '👤'}</span>
      <span>${escapeHTML(user.name)}${isMe ? ' (Sen)' : ''}</span>
    `;
    dom.usersPillList.appendChild(pill);
  });
}

// ==========================================================================
// VIDEO PLAYER LOGIC (YOUTUBE & HTML5)
// ==========================================================================

function extractYouTubeId(url) {
  if (!url) return null;
  const regExp = /(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/;
  const match = url.match(regExp);
  return match ? match[1] : null;
}

function detectVideoType(url) {
  const ytId = extractYouTubeId(url);
  if (ytId) {
    return { type: 'youtube', videoId: ytId };
  }
  return { type: 'direct', videoId: null };
}

function applyVideoChange(video) {
  dom.playerPlaceholder.classList.add('hidden');
  dom.unmuteOverlay.classList.add('hidden');

  if (video.type === 'youtube') {
    state.playerType = 'youtube';
    dom.html5VideoPlayer.classList.add('hidden');
    dom.html5VideoPlayer.pause();
    dom.ytPlayerTarget.classList.remove('hidden');

    if (state.ytReady) {
      loadYouTubeVideo(video.videoId, video.currentTime || 0);
    }

    if (!state.isHost) {
      dom.guestVideoTitle.textContent = 'YouTube Videosu Oynatılıyor';
    }
  } else {
    state.playerType = 'direct';
    dom.ytPlayerTarget.classList.add('hidden');
    if (state.ytPlayer && typeof state.ytPlayer.stopVideo === 'function') {
      state.ytPlayer.stopVideo();
    }
    dom.html5VideoPlayer.classList.remove('hidden');

    dom.html5VideoPlayer.src = video.url;
    dom.html5VideoPlayer.currentTime = video.currentTime || 0;

    if (!state.isHost) {
      dom.guestVideoTitle.textContent = 'Doğrudan Video Dosyası Oynatılıyor';
    }
  }

  updatePlayButtonUI(false);
}

function loadYouTubeVideo(videoId, startSeconds = 0) {
  if (state.ytPlayer && typeof state.ytPlayer.loadVideoById === 'function') {
    state.isRemoteAction = true;
    state.ytPlayer.loadVideoById({
      videoId: videoId,
      startSeconds: startSeconds
    });
    setTimeout(() => { state.isRemoteAction = false; }, 500);
  } else {
    state.ytPlayer = new YT.Player('yt-player-target', {
      videoId: videoId,
      playerVars: {
        autoplay: 0,
        controls: state.isHost ? 1 : 0,
        disablekb: state.isHost ? 0 : 1,
        rel: 0,
        modestbranding: 1,
        playsinline: 1,
        origin: window.location.origin
      },
      events: {
        onReady: (event) => {
          if (startSeconds > 0) {
            event.target.seekTo(startSeconds, true);
          }
        },
        onStateChange: onYouTubeStateChange
      }
    });
  }
}

function onYouTubeStateChange(event) {
  if (state.isRemoteAction) return;

  const playerState = event.data;

  if (state.isHost) {
    const currentTime = state.ytPlayer.getCurrentTime();

    if (playerState === YT.PlayerState.PLAYING) {
      updatePlayButtonUI(true);
      emitHostPlaybackAction('play', currentTime);
    } else if (playerState === YT.PlayerState.PAUSED) {
      updatePlayButtonUI(false);
      emitHostPlaybackAction('pause', currentTime);
    }
  }
}

function setupHTML5PlayerEvents() {
  const vid = dom.html5VideoPlayer;

  vid.addEventListener('play', () => {
    if (state.isRemoteAction) return;
    if (state.isHost) {
      updatePlayButtonUI(true);
      emitHostPlaybackAction('play', vid.currentTime);
    }
  });

  vid.addEventListener('pause', () => {
    if (state.isRemoteAction) return;
    if (state.isHost) {
      updatePlayButtonUI(false);
      emitHostPlaybackAction('pause', vid.currentTime);
    }
  });

  vid.addEventListener('seeked', () => {
    if (state.isRemoteAction) return;
    if (state.isHost) {
      emitHostPlaybackAction('seek', vid.currentTime);
    }
  });
}

// ==========================================================================
// SYNCHRONIZATION ENGINE & DRIFT CORRECTION
// ==========================================================================

function emitHostPlaybackAction(action, currentTime) {
  if (!state.isHost || !state.roomId) return;

  const payload = {
    roomId: state.roomId,
    action: action,
    currentTime: currentTime,
    hostToken: state.hostToken,
    serverTime: Date.now()
  };

  if (state.networkMode === 'socket' && state.socket && state.socket.connected) {
    state.socket.emit('host_playback_action', payload);
  } else {
    broadcastP2P({
      type: 'sync_action',
      action: action,
      currentTime: currentTime,
      isPlaying: (action === 'play'),
      serverTime: Date.now()
    });
  }
}

function handleRemoteSyncAction(action, currentTime, isPlaying, serverTime) {
  state.isRemoteAction = true;
  setSyncStatusIndicator('syncing', 'Senkronize ediliyor...');

  const latency = Math.max(0, (Date.now() - (serverTime || Date.now())) / 1000);
  const targetTime = currentTime + (isPlaying ? latency : 0);

  if (state.playerType === 'youtube' && state.ytPlayer) {
    try {
      state.ytPlayer.seekTo(targetTime, true);
      if (action === 'play') {
        state.ytPlayer.playVideo();
        updatePlayButtonUI(true);
      } else if (action === 'pause') {
        state.ytPlayer.pauseVideo();
        updatePlayButtonUI(false);
      }
    } catch (err) { }
  } else if (state.playerType === 'direct') {
    const vid = dom.html5VideoPlayer;
    vid.currentTime = targetTime;

    if (action === 'play') {
      updatePlayButtonUI(true);
      vid.play().catch(() => {
        dom.unmuteOverlay.classList.remove('hidden');
      });
    } else if (action === 'pause') {
      updatePlayButtonUI(false);
      vid.pause();
    }
  }

  setTimeout(() => {
    state.isRemoteAction = false;
    setSyncStatusIndicator('in-sync', 'Senkronize');
  }, 400);
}

function handleDriftCorrection(hostTime, isPlaying, serverTime) {
  const myTime = getCurrentPlaybackTime();
  const latency = Math.max(0, (Date.now() - (serverTime || Date.now())) / 1000);
  const expectedTime = hostTime + (isPlaying ? latency : 0);
  const drift = Math.abs(myTime - expectedTime);

  if (drift > 1.2) {
    state.isRemoteAction = true;
    setSyncStatusIndicator('syncing', `Eşitleniyor (${drift.toFixed(1)}s)`);
    seekPlayback(expectedTime);

    setTimeout(() => {
      state.isRemoteAction = false;
      setSyncStatusIndicator('in-sync', 'Senkronize');
    }, 400);
  }
}

function startHostHeartbeat() {
  if (state.heartbeatInterval) clearInterval(state.heartbeatInterval);

  state.heartbeatInterval = setInterval(() => {
    if (!state.isHost || !state.roomId) return;
    const time = getCurrentPlaybackTime();
    const playing = isPlaybackPlaying();

    if (state.networkMode === 'socket' && state.socket && state.socket.connected) {
      state.socket.emit('host_heartbeat', {
        roomId: state.roomId,
        currentTime: time,
        isPlaying: playing,
        hostToken: state.hostToken
      });
    } else {
      broadcastP2P({
        type: 'sync_drift',
        currentTime: time,
        isPlaying: playing,
        serverTime: Date.now()
      });
    }
  }, 2500);
}

function getCurrentPlaybackTime() {
  if (state.playerType === 'youtube' && state.ytPlayer && typeof state.ytPlayer.getCurrentTime === 'function') {
    return state.ytPlayer.getCurrentTime() || 0;
  } else if (state.playerType === 'direct') {
    return dom.html5VideoPlayer.currentTime || 0;
  }
  return 0;
}

function getTotalDuration() {
  if (state.playerType === 'youtube' && state.ytPlayer && typeof state.ytPlayer.getDuration === 'function') {
    return state.ytPlayer.getDuration() || 0;
  } else if (state.playerType === 'direct') {
    return dom.html5VideoPlayer.duration || 0;
  }
  return 0;
}

function isPlaybackPlaying() {
  if (state.playerType === 'youtube' && state.ytPlayer && typeof state.ytPlayer.getPlayerState === 'function') {
    return state.ytPlayer.getPlayerState() === YT.PlayerState.PLAYING;
  } else if (state.playerType === 'direct') {
    return !dom.html5VideoPlayer.paused && !dom.html5VideoPlayer.ended;
  }
  return false;
}

function seekPlayback(seconds) {
  if (state.playerType === 'youtube' && state.ytPlayer && typeof state.ytPlayer.seekTo === 'function') {
    state.ytPlayer.seekTo(seconds, true);
  } else if (state.playerType === 'direct') {
    dom.html5VideoPlayer.currentTime = seconds;
  }
}

function toggleHostPlayPause() {
  if (!state.isHost) {
    showToast('Yalnızca host oynatma kontrolünü değiştirebilir.', 'info');
    return;
  }

  const isPlaying = isPlaybackPlaying();
  const currentTime = getCurrentPlaybackTime();

  if (isPlaying) {
    if (state.playerType === 'youtube' && state.ytPlayer) {
      state.ytPlayer.pauseVideo();
    } else if (state.playerType === 'direct') {
      dom.html5VideoPlayer.pause();
    }
    updatePlayButtonUI(false);
    emitHostPlaybackAction('pause', currentTime);
  } else {
    if (state.playerType === 'youtube' && state.ytPlayer) {
      state.ytPlayer.playVideo();
    } else if (state.playerType === 'direct') {
      dom.html5VideoPlayer.play().catch(e => console.warn(e));
    }
    updatePlayButtonUI(true);
    emitHostPlaybackAction('play', currentTime);
  }
}

function updatePlayButtonUI(isPlaying) {
  if (isPlaying) {
    dom.playBtnIcon.textContent = '⏸';
    dom.playBtnText.textContent = 'Duraklat';
  } else {
    dom.playBtnIcon.textContent = '▶';
    dom.playBtnText.textContent = 'Başlat';
  }
}

function setSyncStatusIndicator(statusClass, text) {
  dom.syncStatusIndicator.className = `sync-indicator ${statusClass}`;
  dom.syncText.textContent = text;
}

function startUiProgressTimer() {
  if (state.uiUpdateInterval) clearInterval(state.uiUpdateInterval);

  state.uiUpdateInterval = setInterval(() => {
    if (state.isSeeking) return;

    const current = getCurrentPlaybackTime();
    const duration = getTotalDuration();

    dom.currentTimeText.textContent = formatTime(current);
    dom.totalTimeText.textContent = formatTime(duration);

    if (duration > 0) {
      const percent = (current / duration) * 100;
      dom.progressFill.style.width = `${percent}%`;
      dom.progressThumb.style.left = `${percent}%`;

      if (state.playerType === 'direct' && dom.html5VideoPlayer.buffered.length > 0) {
        const bufferedEnd = dom.html5VideoPlayer.buffered.end(dom.html5VideoPlayer.buffered.length - 1);
        const bufferedPercent = (bufferedEnd / duration) * 100;
        dom.progressBuffered.style.width = `${bufferedPercent}%`;
      }
    }
  }, 250);
}

// ==========================================================================
// CHAT & FLOATING REACTIONS
// ==========================================================================

function sendChatMessage(text) {
  if (!text || !text.trim() || !state.roomId) return;

  const chatMsg = {
    id: Math.random().toString(),
    senderName: state.userName,
    isHost: state.isHost,
    text: text.trim().slice(0, 500),
    timestamp: Date.now(),
    isSystem: false
  };

  dom.inputChatMessage.value = '';

  if (state.networkMode === 'socket' && state.socket && state.socket.connected) {
    state.socket.emit('send_chat', {
      roomId: state.roomId,
      text: chatMsg.text
    });
  } else {
    appendChatMessage(chatMsg);
    broadcastP2P({
      type: 'chat_message',
      message: chatMsg
    });
  }
}

function appendChatMessage(msg, autoScroll = true) {
  state.chatMessages.push(msg);
  if (state.chatMessages.length > 100) state.chatMessages.shift();

  const container = dom.chatMessagesContainer;
  const isMe = (msg.senderName === state.userName && !msg.isSystem);

  const msgDiv = document.createElement('div');
  msgDiv.className = `chat-message ${msg.isSystem ? 'system' : (isMe ? 'me' : 'other')}`;

  const timeStr = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (msg.isSystem) {
    msgDiv.innerHTML = `
      <div class="system-bubble">
        <span>${escapeHTML(msg.text)}</span>
      </div>
    `;
  } else {
    msgDiv.innerHTML = `
      <div class="message-meta">
        <span class="message-sender">${escapeHTML(msg.senderName)}</span>
        ${msg.isHost ? '<span class="sender-tag host">Host</span>' : ''}
        <span>${timeStr}</span>
      </div>
      <div class="message-bubble">
        ${escapeHTML(msg.text)}
      </div>
    `;
  }

  container.appendChild(msgDiv);

  if (autoScroll) {
    container.scrollTop = container.scrollHeight;
  }
}

function sendReaction(emoji) {
  if (!state.roomId) return;

  if (state.networkMode === 'socket' && state.socket && state.socket.connected) {
    state.socket.emit('send_reaction', {
      roomId: state.roomId,
      emoji: emoji
    });
  } else {
    spawnFloatingReaction(emoji, state.userName);
    broadcastP2P({
      type: 'reaction',
      emoji: emoji,
      senderName: state.userName
    });
  }
}

function spawnFloatingReaction(emoji, senderName) {
  const container = dom.reactionsContainer;
  const el = document.createElement('div');
  el.className = 'floating-reaction';
  el.textContent = emoji;

  const randomX = Math.floor(Math.random() * 70) + 15;
  el.style.left = `${randomX}%`;

  if (senderName) {
    const tag = document.createElement('span');
    tag.className = 'floating-sender-name';
    tag.textContent = senderName;
    el.appendChild(tag);
  }

  container.appendChild(el);

  setTimeout(() => {
    if (el && el.parentNode) {
      el.parentNode.removeChild(el);
    }
  }, 3500);
}

// ==========================================================================
// TOAST NOTIFICATIONS & SHARE MODAL
// ==========================================================================

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const iconMap = {
    success: '✅',
    info: 'ℹ️',
    error: '⚠️'
  };

  toast.innerHTML = `
    <span>${iconMap[type] || '✨'}</span>
    <span>${escapeHTML(message)}</span>
  `;

  dom.toastContainer.appendChild(toast);

  setTimeout(() => {
    if (toast && toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }, 4000);
}

function copyRoomLink() {
  const url = `${window.location.origin}/room/${state.roomId}`;
  navigator.clipboard.writeText(url).then(() => {
    showToast('Davet linki panoya kopyalandı! ✨', 'success');
    dom.copyStatusIcon.textContent = '✅';
    setTimeout(() => {
      dom.copyStatusIcon.textContent = '📋';
    }, 2000);
  }).catch(() => {
    openShareModal();
  });
}

function openShareModal() {
  const url = `${window.location.origin}/room/${state.roomId}`;
  dom.shareLinkInput.value = url;
  dom.modalShare.classList.remove('hidden');
}

function closeShareModal() {
  dom.modalShare.classList.add('hidden');
}

// ==========================================================================
// EVENT LISTENERS BINDING
// ==========================================================================

function setupEventListeners() {
  // Lobby buttons
  dom.btnCreateRoom.addEventListener('click', createRoom);
  dom.btnJoinRoom.addEventListener('click', () => {
    joinRoom(dom.inputRoomCode.value);
  });
  dom.inputRoomCode.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinRoom(dom.inputRoomCode.value);
  });
  dom.btnJoinDetected.addEventListener('click', () => {
    joinRoom(state.roomId);
  });

  // Room Header actions
  dom.btnCopyRoomLink.addEventListener('click', copyRoomLink);
  dom.btnShareLink.addEventListener('click', openShareModal);
  dom.btnLeaveRoom.addEventListener('click', () => {
    if (confirm('Odadan ayrılmak istediğinizden emin misiniz?')) {
      window.location.href = '/';
    }
  });

  // Modal actions
  dom.btnCloseModal.addEventListener('click', closeShareModal);
  dom.modalShare.addEventListener('click', (e) => {
    if (e.target === dom.modalShare) closeShareModal();
  });
  dom.btnModalCopy.addEventListener('click', () => {
    navigator.clipboard.writeText(dom.shareLinkInput.value).then(() => {
      showToast('Kopyalandı! 💌', 'success');
      closeShareModal();
    });
  });

  // Host: Load Video
  dom.btnLoadVideo.addEventListener('click', () => {
    const url = (dom.inputVideoUrl.value || '').trim();
    if (!url) {
      showToast('Lütfen bir video linki girin.', 'error');
      return;
    }

    if (state.networkMode === 'socket' && state.socket && state.socket.connected) {
      state.socket.emit('set_video', {
        roomId: state.roomId,
        url: url,
        hostToken: state.hostToken
      }, (res) => {
        if (res && res.success) {
          showToast('Video başarıyla yüklendi!', 'success');
        } else {
          showToast(res ? res.message : 'Video yüklenemedi.', 'error');
        }
      });
    } else {
      // P2P / Vercel mode
      const { type, videoId } = detectVideoType(url);
      state.currentVideo = {
        url: url,
        type: type,
        videoId: videoId,
        isPlaying: false,
        currentTime: 0,
        lastUpdate: Date.now()
      };

      applyVideoChange(state.currentVideo);

      const changeMsg = {
        id: Math.random().toString(),
        senderName: 'Sistem',
        isHost: false,
        text: `🎬 Video yüklendi: ${type === 'youtube' ? 'YouTube' : 'Video Dosyası'}`,
        timestamp: Date.now(),
        isSystem: true
      };
      appendChatMessage(changeMsg);

      broadcastP2P({
        type: 'video_changed',
        video: state.currentVideo,
        systemMessage: changeMsg
      });

      showToast('Video başarıyla yüklendi!', 'success');
    }
  });

  // Quick sample video buttons
  document.querySelectorAll('.sample-tag').forEach(tag => {
    tag.addEventListener('click', () => {
      const sampleUrl = tag.dataset.url;
      dom.inputVideoUrl.value = sampleUrl;
      dom.btnLoadVideo.click();
    });
  });

  // Host Play/Pause toggle
  dom.btnHostTogglePlay.addEventListener('click', toggleHostPlayPause);

  // Force Sync button
  dom.btnForceSync.addEventListener('click', () => {
    showToast('Senkronizasyon yenileniyor...', 'info');
    if (state.networkMode === 'socket' && state.socket && state.socket.connected) {
      state.socket.emit('request_sync', { roomId: state.roomId });
    } else if (state.hostConn) {
      state.hostConn.send({ type: 'request_sync' });
    }
  });

  // Unmute helper button
  dom.btnUnmute.addEventListener('click', () => {
    dom.unmuteOverlay.classList.add('hidden');
    if (state.playerType === 'direct') {
      dom.html5VideoPlayer.muted = false;
      dom.html5VideoPlayer.play().catch(e => console.warn(e));
    }
  });

  // Progress / Seek Bar interaction
  setupSeekBarEvents();

  // HTML5 Video Player setup
  setupHTML5PlayerEvents();

  // Chat Form submission
  dom.chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    sendChatMessage(dom.inputChatMessage.value);
  });

  // Reaction Buttons
  document.querySelectorAll('.btn-reaction').forEach(btn => {
    btn.addEventListener('click', () => {
      const emoji = btn.dataset.emoji || '❤️';
      sendReaction(emoji);
    });
  });
}

function setupSeekBarEvents() {
  const container = dom.seekContainer;

  container.addEventListener('click', (e) => {
    if (!state.isHost) {
      showToast('Oynatma kontrolü Host tarafındadır.', 'info');
      return;
    }
    const rect = container.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percent = Math.max(0, Math.min(1, clickX / rect.width));
    const duration = getTotalDuration();

    if (duration > 0) {
      const targetSeconds = percent * duration;
      seekPlayback(targetSeconds);
      emitHostPlaybackAction('seek', targetSeconds);
    }
  });
}

function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const formattedMins = mins < 10 ? '0' + mins : mins;
  const formattedSecs = secs < 10 ? '0' + secs : secs;
  return `${formattedMins}:${formattedSecs}`;
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
