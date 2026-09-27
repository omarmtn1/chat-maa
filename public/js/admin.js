let adminToken = localStorage.getItem('adminToken');

if (adminToken) showPanel();

async function adminLogin() {
    const password = document.getElementById('admin-password').value;
    try {
        const res = await fetch('/api/auth/admin-login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        const data = await res.json();
        if (!res.ok) {
            const el = document.getElementById('admin-login-error');
            el.textContent = data.error;
            el.classList.add('show');
            return;
        }
        adminToken = data.token;
        localStorage.setItem('adminToken', adminToken);
        showPanel();
    } catch (e) {
        alert('تعذر الاتصال بالخادم');
    }
}

function showPanel() {
    document.getElementById('admin-login-container').style.display = 'none';
    document.getElementById('admin-panel').style.display = 'block';
    loadUsers();
    loadBannedWords();
    loadTickerSettings();
    loadAdminMessages();
    loadLogs();
}

async function api(path, options = {}) {
    const res = await fetch(`/api/admin${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${adminToken}`,
            ...(options.headers || {})
        }
    });
    if (res.status === 401 || res.status === 403) {
        localStorage.removeItem('adminToken');
        location.reload();
        return null;
    }
    return res.json();
}

async function loadUsers() {
    const users = await api('/users');
    const tbody = document.querySelector('#users-table tbody');
    tbody.innerHTML = users.map((u) => `
        <tr>
            <td>${escapeHtml(u.display_name)} ${u.is_female_member ? '<span class="badge female">مميزة</span>' : ''}</td>
            <td>${u.phone}</td>
            <td>
                ${u.is_online ? '<span class="badge online">متصل</span>' : ''}
                ${u.is_banned ? '<span class="badge banned">محظور</span>' : ''}
            </td>
            <td class="actions-row">
                ${u.is_banned
                    ? `<button onclick="unbanUser(${u.id})">رفع الحظر</button>`
                    : `<button class="danger" onclick="banUser(${u.id})">حظر</button>`}
                <button onclick="warnUser(${u.id})">إنذار</button>
                <button onclick="editName(${u.id})">تعديل الاسم</button>
                <button onclick="promoteUser(${u.id})">ترقية لمشرف</button>
                <button class="danger" onclick="deleteUser(${u.id})">حذف</button>
            </td>
        </tr>`).join('');
}

async function banUser(id) {
    const reason = prompt('سبب الحظر:') || 'مخالفة قوانين الدردشة';
    await api(`/users/${id}/ban`, { method: 'POST', body: JSON.stringify({ reason }) });
    loadUsers();
}
async function unbanUser(id) {
    await api(`/users/${id}/unban`, { method: 'POST' });
    loadUsers();
}
async function deleteUser(id) {
    if (!confirm('هل أنت متأكد من حذف هذا العضو نهائياً؟')) return;
    await api(`/users/${id}`, { method: 'DELETE' });
    loadUsers();
}
async function editName(id) {
    const display_name = prompt('الاسم الجديد:');
    if (!display_name) return;
    await api(`/users/${id}/name`, { method: 'PUT', body: JSON.stringify({ display_name }) });
    loadUsers();
}
async function warnUser(id) {
    const reason = prompt('سبب الإنذار:');
    if (!reason) return;
    await api(`/users/${id}/warn`, { method: 'POST', body: JSON.stringify({ reason }) });
    alert('تم إرسال الإنذار');
}
async function promoteUser(id) {
    if (!confirm('ترقية هذا العضو إلى مشرف بكل الصلاحيات؟')) return;
    await api(`/users/${id}/promote`, {
        method: 'POST',
        body: JSON.stringify({ can_ban: true, can_delete_messages: true, can_warn: true, can_edit_names: true, can_manage_rooms: true })
    });
    loadUsers();
}

async function loadBannedWords() {
    const words = await api('/banned-words');
    document.getElementById('banned-words-list').innerHTML = words.map((w) => `
        <span class="badge banned" style="margin:2px;display:inline-flex;align-items:center;gap:4px;">
            ${escapeHtml(w.word)}
            <span style="cursor:pointer;" onclick="deleteBannedWord(${w.id})">✕</span>
        </span>`).join(' ');
}
async function addBannedWord() {
    const word = document.getElementById('new-banned-word').value.trim();
    if (!word) return;
    await api('/banned-words', { method: 'POST', body: JSON.stringify({ word }) });
    document.getElementById('new-banned-word').value = '';
    loadBannedWords();
}
async function deleteBannedWord(id) {
    await api(`/banned-words/${id}`, { method: 'DELETE' });
    loadBannedWords();
}

async function loadTickerSettings() {
    const t = await api('/ad-ticker');
    if (!t) return;
    document.getElementById('ticker-text').value = t.text_content;
    document.getElementById('ticker-speed').value = t.speed;
    document.getElementById('ticker-direction').value = t.direction;
    document.getElementById('ticker-font-size').value = t.font_size;
    document.getElementById('ticker-visible').checked = t.is_visible;
}
async function saveTicker() {
    await api('/ad-ticker', {
        method: 'PUT',
        body: JSON.stringify({
            text_content: document.getElementById('ticker-text').value,
            speed: parseInt(document.getElementById('ticker-speed').value, 10),
            direction: document.getElementById('ticker-direction').value,
            font_size: parseInt(document.getElementById('ticker-font-size').value, 10),
            is_visible: document.getElementById('ticker-visible').checked
        })
    });
    alert('تم حفظ إعدادات الشريط');
}

async function saveMaintenance() {
    const restart = document.getElementById('maint-restart').value;
    await api('/maintenance', {
        method: 'PUT',
        body: JSON.stringify({
            is_active: document.getElementById('maint-active').checked,
            reason: document.getElementById('maint-reason').value,
            restart_time: restart ? new Date(restart).toISOString() : null
        })
    });
    alert('تم حفظ إعدادات الصيانة');
}

async function sendBroadcast() {
    const content = document.getElementById('broadcast-text').value.trim();
    if (!content) return;
    alert('لإرسال بث فوري، افتح جلسة دردشة كأدمن متصل عبر WebSocket. سيتم إضافة ذلك في الإصدار القادم من اللوحة.');
}

async function loadAdminMessages() {
    const msgs = await api('/admin-messages');
    document.getElementById('admin-messages-list').innerHTML = msgs.length
        ? msgs.map((m) => `
            <div style="padding:8px 0;border-bottom:1px solid var(--border);">
                <strong>${escapeHtml(m.display_name)}</strong> (${m.phone})
                <div>${escapeHtml(m.content)}</div>
                <div class="meta" style="font-size:11px;color:var(--muted);">${new Date(m.created_at).toLocaleString('ar')}</div>
                ${!m.is_read ? `<button style="width:auto;margin-top:4px;" onclick="markRead(${m.id})">تحديد كمقروء</button>` : ''}
            </div>`).join('')
        : '<p style="color:var(--muted);">لا توجد رسائل</p>';
}
async function markRead(id) {
    await api(`/admin-messages/${id}/read`, { method: 'PUT' });
    loadAdminMessages();
}

async function loadLogs() {
    const logs = await api('/logs');
    document.getElementById('admin-logs-list').innerHTML = logs.map((l) => `
        <div>${new Date(l.created_at).toLocaleString('ar')} — ${l.action} ${l.target_user_id ? `(عضو #${l.target_user_id})` : ''}</div>
    `).join('');
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
      }
