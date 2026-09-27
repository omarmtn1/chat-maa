async function loadTicker() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();
        const t = data.ticker;
        if (!t || !t.is_visible) return;

        const holder = document.getElementById('ticker-holder');
        if (!holder) return;

        const speedSeconds = Math.max(4, 30 - (t.speed * 2));
        holder.innerHTML = `
            <div class="ad-ticker dir-${t.direction}" style="background:${t.bg_color};color:${t.text_color};font-size:${t.font_size}px;">
                <span style="animation-duration:${speedSeconds}s;">${escapeHtml(t.text_content)}</span>
            </div>`;
    } catch (e) { /* تجاهل بصمت إن تعذر التحميل */ }
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

loadTicker();
