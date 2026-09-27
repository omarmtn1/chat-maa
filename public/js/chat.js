const token = localStorage.getItem('token');
const user = JSON.parse(localStorage.getItem('user') || 'null');

if (!token || !user) {
    window.location.href = 'index.html';
}

document.getElementById('welcome-name').textContent = `💬 مرحباً، ${user.display_name}`;

let ws;
let typingTimeout;
const currentRoomId = null;

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
        document.getElementById('member-strip').textContent = 'انقطع الاتصال، جارِ إعادة المحاولة...';
        setTimeout(connectWS, 2000);
    };
}

function handleServerMessage(type, payload) {
    switch (type) {
        case 'auth_ok':
            document.getElementById('member-strip').textContent = `أنت متصل الآن باسم ${user.display_name}`;
            document.getElementById('online-count').textContent = payload.onlineCount;
            loadWelcomeBanner();
            break;

        case 'online_count':
            document.getElementById('online-count').textContent = payload.count;
            break;

        case 'presence':
            break;

        case 'message':
            appendMessage(payload);
            break;

        case 'typing':
            showTypingIndicator(payload.isTyping);
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
                ${payload.restart_time ? `<p>موعد العودة المتوقع: ${new Date(payload.restart_time).toLocaleString('ar')}</p>` : ''}
            </div></div>`;
            break;

        case 'error':
            console.warn(payload.message);
            break;
    }
}

function appendMessage(msg) {
    const container = document.getElementById('messages');
    const mine = msg.sender_id === user.id;
    const div = document.createElement('div');
    div.className = `msg ${mine ? 'mine' : 'theirs'} ${msg.sender?.is_female_member ? 'female-sender' : ''}`;
    const time = new Date(msg.created_at).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' });
    div.innerHTML = `
        ${!mine ? `<div style="font-weight:bold;font-size:12px;margin-bottom:3px;">${escapeHtml(msg.sender?.display_name || '')}</div>` : ''}
        <div>${escapeHtml(msg.content)}</div>
        <div class="meta">${time}</div>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function sendMessage() {
    const input = document.getElementById('msg-input');
    const content = input.value.trim();
    if (!content || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'message', payload: { roomId: currentRoomId, content, messageType: 'text' } }));
    input.value = '';
}

function notifyTyping() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'typing', payload: { roomId: currentRoomId, isTyping: true } }));
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        ws.send(JSON.stringify({ type: 'typing', payload: { roomId: currentRoomId, isTyping: false } }));
    }, 1500);
}

function showTypingIndicator(isTyping) {
    const el = document.getElementById('typing-indicator');
    el.textContent = isTyping ? 'عضو آخر يكتب الآن...' : '';
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

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function logout() {
    localStorage.clear();
    window.location.href = 'index.html';
}

connectWS();
