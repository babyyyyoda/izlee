const io = require('socket.io-client');

const SERVER_URL = 'http://localhost:3000';

async function testWatchPartySync() {
  console.log('--- WATCH PARTY SENKRONİZASYON TESTİ BAŞLIYOR ---');

  // 1. Host Socket
  const hostSocket = io(SERVER_URL);
  let roomId = null;
  let hostToken = null;

  await new Promise((resolve) => {
    hostSocket.on('connect', resolve);
  });
  console.log('✅ Host bağlandı.');

  // Create room
  await new Promise((resolve) => {
    hostSocket.emit('create_room', { userName: 'Mert (Host)' }, (res) => {
      roomId = res.roomId;
      hostToken = res.hostToken;
      console.log(`✅ Oda Oluşturuldu: ${roomId}`);
      resolve();
    });
  });

  // Host joins room
  await new Promise((resolve) => {
    hostSocket.emit('join_room', { roomId, userName: 'Mert (Host)', hostToken }, (res) => {
      console.log(`✅ Host odaya girdi. isHost: ${res.isHost}`);
      resolve();
    });
  });

  // 2. Partner (Guest) Socket
  const guestSocket = io(SERVER_URL);
  await new Promise((resolve) => {
    guestSocket.on('connect', resolve);
  });
  console.log('✅ Partner bağlandı.');

  let guestReceivedPlay = false;
  let guestReceivedPause = false;
  let guestReceivedChat = false;

  guestSocket.on('sync_action', (data) => {
    console.log(`[Guest Olayı] sync_action alındı: action=${data.action}, time=${data.currentTime}`);
    if (data.action === 'play') guestReceivedPlay = true;
    if (data.action === 'pause') guestReceivedPause = true;
  });

  guestSocket.on('new_chat_message', (msg) => {
    console.log(`[Guest Olayı] Yeni mesaj: [${msg.senderName}]: ${msg.text}`);
    if (msg.text.includes('Sevgilim')) guestReceivedChat = true;
  });

  // Guest joins room
  await new Promise((resolve) => {
    guestSocket.emit('join_room', { roomId, userName: 'Sevgili (Misafir)' }, (res) => {
      console.log(`✅ Partner odaya girdi. isHost: ${res.isHost}, Katılımcı sayısı: ${res.users.length}`);
      resolve();
    });
  });

  // 3. Host sets video
  await new Promise((resolve) => {
    hostSocket.emit('set_video', {
      roomId,
      url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
      hostToken
    }, (res) => {
      console.log(`✅ Host video yükledi. Type: ${res.video.type}, VideoID: ${res.video.videoId}`);
      resolve();
    });
  });

  // 4. Host plays video at 12.5 seconds
  console.log('▶️ Host videoyu 12.5. saniyede BAŞLATIYOR...');
  hostSocket.emit('host_playback_action', {
    roomId,
    action: 'play',
    currentTime: 12.5,
    hostToken
  });

  await new Promise(r => setTimeout(r, 600));

  // 5. Host pauses video at 18.0 seconds
  console.log('⏸️ Host videoyu 18.0. saniyede DURAKLATIYOR...');
  hostSocket.emit('host_playback_action', {
    roomId,
    action: 'pause',
    currentTime: 18.0,
    hostToken
  });

  await new Promise(r => setTimeout(r, 600));

  // 6. Host sends chat message
  hostSocket.emit('send_chat', {
    roomId,
    text: 'Sevgilim iyi seyirler! ❤️'
  });

  await new Promise(r => setTimeout(r, 600));

  console.log('--- TEST SONUÇLARI ---');
  console.log('1. Guest Play senkronu aldı mı?:', guestReceivedPlay ? '✅ EVET' : '❌ HAYIR');
  console.log('2. Guest Pause senkronu aldı mı?:', guestReceivedPause ? '✅ EVET' : '❌ HAYIR');
  console.log('3. Guest Chat mesajını aldı mı?:', guestReceivedChat ? '✅ EVET' : '❌ HAYIR');

  hostSocket.disconnect();
  guestSocket.disconnect();

  if (guestReceivedPlay && guestReceivedPause && guestReceivedChat) {
    console.log('🎉 TÜM SENKRONİZASYON VE CHAT TESTLERİ BAŞARIYLA GEÇTİ!');
    process.exit(0);
  } else {
    console.error('❌ Bazı testler başarısız oldu.');
    process.exit(1);
  }
}

testWatchPartySync().catch(console.error);
