const token = localStorage.getItem('token');
const user = JSON.parse(localStorage.getItem('user') || 'null');

if (!token || !user) {
    window.location.href = 'index.html';
}

document.getElementById('welcome-name').textContent = `💬 ${user.display_name}`;
updateAvatarDisplay(user.avatar_url);

let ws;
let typingTimeout;
let currentRoomId = null;
let rooms = [];

function connectWS() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}/ws`);

    ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'auth', payload: { token } }));
    };

    ws.onmessage = (event) => {
        const { type, payload } = JSON.parse(event.data);
        handleServerMessage(type, payload);
    };

    ws.onclose = () => {
        setTimeout(connectWS, 2000);
    };
}

async function handleServerMessage(type, payload) {
    switch (type) {
        case 'auth_ok':
            document.getElementById('online-count').textContent = payload.onlineCount;
            await loadRooms();
            loadWelcomeBanner();
            break;

        case 'online_count':
            document.getElementById('online-count').textContent = payload.count;
            break;

        case 'message':
            if (payload.room_id === currentRoomId) appendMessage(payload);
            break;

        case 'typing':
            if (payload.roomId === currentRoomId) showTypingIndicator(payload.isTyping);
            break;

        case 'poke':
            alert(`👋 ${payload.fromName} أرسل لك إشارة انتباه!`);
            break;

        case 'admin_broadcast':
            showWelcomeBanner(`📢 رسالة من الإدارة: ${payload.content}`);
            break;

        case 'maintenance':
            document.body.innerHTML = `<div class="container"><div class="card">
                <h2>🛠️ الموقع في وضع الصيانة</h2>
                <p>${payload.reason || 'يرجى المحاولة لاحقاً'}</p>
            </div></div>`;
            break;

        case 'error':
            console.warn(payload.message);
            break;
    }
}

async function loadRooms() {
    const res = await fetch('/api/rooms', { headers: { Authorization: `Bearer ${token}` } });
    rooms = await res.json();
    renderRoomsList();
    if (!currentRoomId && rooms.length) {
        switchRoom(rooms.find(r => r.type === 'public')?.id || rooms[0].id);
    }
}

function renderRoomsList() {
    const el = document.getElementById('rooms-list');
    el.innerHTML = rooms.map((r) => `
        <div style="padding:10px;border-bottom:1px solid var(--border);cursor:pointer;${r.id === currentRoomId ? 'font-weight:bold;color:var(--primary);' : ''}"
             onclick="switchRoom(${r.id})">
            ${r.type === 'private' ? '🔒' : '🌐'} ${escapeHtml(r.name)}
        </div>`).join('');
}

function switchRoom(roomId) {
    currentRoomId = roomId;
    const room = rooms.find(r => r.id === roomId);
    document.getElementById('current-room-name').textContent = room ? room.name : 'غرفة';
    document.getElementById('messages').innerHTML = '';
    renderRoomsList();
    document.getElementById('rooms-panel').style.display = 'none';
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'join_room', payload: { roomId } }));
    }
    loadRoomHistory(roomId);
}

async function loadRoomHistory(roomId) {
    const res = await fetch(`/api/rooms/${roomId}/messages`, { headers: { Authorization: `Bearer ${token}` } });
    const messages = await res.json();
    const container = document.getElementById('messages');
    container.innerHTML = '';
    messages.forEach(appendMessage);
}

function toggleRoomsPanel() {
    const panel = document.getElementById('rooms-panel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

function showCreateRoom() {
    document.getElementById('create-room-form').style.display = 'block';
}

async function createRoom() {
    const name = document.getElementById('new-room-name').value.trim();
    const type = document.querySelector('input[name="room-type"]:checked').value;
    const password = document.getElementById('new-room-password').value;
    if (!name) return alert('اكتب اسم الغرفة');

    const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name, type, password })
    });
    const room = await res.json();
    if (!res.ok) return alert(room.error || 'حدث خطأ');
    await loadRooms();
    switchRoom(room.id);
    document.getElementById('new-room-name').value = '';
    document.getElementById('create-room-form').style.display = 'none';
}

function appendMessage(msg) {
    const container = document.getElementById('messages');
    const mine = msg.sender_id === user.id;
    const div = document.createElement('div');
    div.className = `msg ${mine ? 'mine' : 'theirs'} ${msg.is_female_member ? 'female-sender' : ''}`;
    const time = new Date(msg.created_at).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' });
    div.innerHTML = `
        ${!mine ? `<div style="font-weight:bold;font-size:12px;margin-bottom:3px;">${escapeHtml(msg.display_name || msg.sender?.display_name || '')}</div>` : ''}
        <div>${escapeHtml(msg.content)}</div>
        <div class="meta">${time}</div>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function sendMessage() {
    const input = document.getElementById('msg-input');
    const content = input.value.trim();
    if (!content || !ws || ws.readyState !== WebSocket.OPEN || !currentRoomId) return;
    ws.send(JSON.stringify({ type: 'message', payload: { roomId: currentRoomId, content, messageType: 'text' } }));
    input.value = '';
}

function notifyTyping() {
    if (!ws || ws.readyState !== WebSocket.OPEN || !currentRoomId) return;
    ws.send(JSON.stringify({ type: 'typing', payload: { roomId: currentRoomId, isTyping: true } }));
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        ws.send(JSON.stringify({ type: 'typing', payload: { roomId: currentRoomId, isTyping: false } }));
    }, 1500);
}

function showTypingIndicator(isTyping) {
    document.getElementById('typing-indicator').textContent = isTyping ? 'عضو آخر يكتب الآن...' : '';
}

function sendMessageToAdmin() {
    const content = prompt('اكتب رسالتك إلى الإدارة:');
    if (!content) return;
    ws.send(JSON.stringify({ type: 'admin_message', payload: { content } }));
    alert('تم إرسال رسالتك إلى الإدارة');
}

async function loadWelcomeBanner() {
    try {
        const res = await fetch('/api/newest-member');
        const newest = await res.json();
        if (newest && newest.display_name) {
            showWelcomeBanner(`🎉 مرحباً بالعضو الجديد: ${newest.display_name}`);
        }
    } catch (e) {}
}

function showWelcomeBanner(text) {
    const el = document.getElementById('welcome-banner');
    el.textContent = text;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 6000);
}

function openAvatarPicker() {
    document.getElementById('avatar-input').click();
}

function onAvatarSelected(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 700000) {
        alert('حجم الصورة كبير جداً، اختر صورة أصغر من 700 كيلوبايت');
        return;
    }
    const reader = new FileReader();
    reader.onload = async (e) => {
        const dataUrl = e.target.result;
        const res = await fetch('/api/profile/avatar', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ avatar_data: dataUrl })
        });
        const data = await res.json();
        if (!res.ok) return alert(data.error || 'فشل تحديث الصورة');
        user.avatar_url = dataUrl;
        localStorage.setItem('user', JSON.stringify(user));
        updateAvatarDisplay(dataUrl);
    };
    reader.readAsDataURL(file);
}

function updateAvatarDisplay(url) {
    const el = document.getElementById('my-avatar');
    if (url && url.startsWith('data:image/')) {
        el.style.backgroundImage = `url(${url})`;
    }
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

function logout() {
    localStorage.clear();
    window.location.href = 'index.html';
}

connectWS();
