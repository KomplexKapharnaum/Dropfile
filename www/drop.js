// Blind drop box. Uploaders see only their own uploads (tracked by a local
// visitor token). They never see anyone else's media. What's accepted (images /
// videos / text) is decided per scene by the admin.
(function () {
    const token = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');

    let visitor = localStorage.getItem('df_visitor');
    if (!visitor) {
        visitor = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now());
        localStorage.setItem('df_visitor', visitor);
    }
    const nick = () => localStorage.getItem('df_nick') || 'anon';

    const nickInput = document.getElementById('nick');
    nickInput.value = localStorage.getItem('df_nick') || '';
    nickInput.addEventListener('input', () => {
        const v = nickInput.value.replace(/ /g, '_').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20);
        nickInput.value = v;
        localStorage.setItem('df_nick', v);
    });

    let allowSelfDelete = false;
    Dropzone.autoDiscover = false;

    // drop metadata: titles (project = main, scene = subtitle) + accepted types
    fetch('/api/drop/' + token).then(r => r.ok ? r.json() : Promise.reject()).then(info => {
        document.getElementById('projTitle').textContent = info.project || 'Drop';
        document.getElementById('sceneTitle').textContent = info.source || '';
        document.title = (info.project || 'Drop') + (info.source ? ' · ' + info.source : '');
        allowSelfDelete = info.allowSelfDelete;
        setupUI(info.accept || { image: true, video: true, text: false });
    }).catch(() => {
        document.getElementById('projTitle').textContent = 'Unknown drop';
    });

    function setupUI(accept) {
        const mediaTypes = [];
        if (accept.image) mediaTypes.push('image/*');
        if (accept.video) mediaTypes.push('video/*');

        const dzEl = document.getElementById('dz');
        if (mediaTypes.length) {
            dzEl.classList.remove('hidden');
            const dz = new Dropzone('#dz', {
                url: '/api/drop/' + token,
                paramName: 'file',
                maxFilesize: 4096,
                parallelUploads: 3,
                timeout: 0,
                acceptedFiles: mediaTypes.join(','),
                dictDefaultMessage: dropMessage(accept),
                sending: (file, xhr, formData) => { formData.append('nick', nick()); formData.append('visitor', visitor); }
            });
            dz.on('success', (file) => { dz.removeFile(file); loadMine(); });
            dz.on('queuecomplete', loadMine);
        }

        if (accept.text) {
            document.getElementById('textBox').classList.remove('hidden');
            document.getElementById('sendText').onclick = sendText;
        }
    }

    function dropMessage(accept) {
        if (accept.image && accept.video) return '📷  Tap or drop photos / videos';
        if (accept.image) return '📷  Tap or drop your photos';
        if (accept.video) return '🎬  Tap or drop your videos';
        return 'Drop files';
    }

    function sendText() {
        const ta = document.getElementById('textInput');
        const text = ta.value.trim();
        if (!text) return;
        fetch('/api/drop/' + token + '/text', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, nick: nick(), visitor })
        }).then(r => r.ok ? r.json() : Promise.reject()).then(() => { ta.value = ''; loadMine(); }).catch(() => {});
    }

    // my uploads
    const grid = document.getElementById('mineGrid');
    const hint = document.getElementById('mineHint');

    function loadMine() {
        fetch('/api/drop/' + token + '/mine?visitor=' + encodeURIComponent(visitor))
            .then(r => r.json())
            .then(data => { allowSelfDelete = data.allowSelfDelete; render(data.uploads || []); })
            .catch(() => {});
    }

    function render(items) {
        grid.innerHTML = '';
        hint.textContent = items.length ? '(' + items.length + ')' : '';
        items.forEach(u => {
            const tile = document.createElement('div');
            tile.className = 'tile';
            if (u.type === 'image') {
                const img = document.createElement('img');
                img.src = u.url; img.loading = 'lazy';
                tile.appendChild(img);
            } else {
                const ph = document.createElement('div');
                ph.className = 'placeholder';
                ph.textContent = u.type === 'video' ? '▶' : (u.type === 'text' ? '📝' : '📄');
                tile.appendChild(ph);
            }
            if (allowSelfDelete) {
                const del = document.createElement('button');
                del.className = 'del'; del.textContent = '×';
                del.onclick = () => removeUpload(u.fileId);
                tile.appendChild(del);
            }
            grid.appendChild(tile);
        });
    }

    function removeUpload(fileId) {
        fetch('/api/drop/' + token + '/' + fileId + '?visitor=' + encodeURIComponent(visitor), { method: 'DELETE' })
            .then(loadMine);
    }

    // share modal with QR of this drop URL
    const shareModal = document.getElementById('shareModal');
    const shareUrl = location.href;
    document.getElementById('shareBtn').onclick = () => {
        shareModal.classList.remove('hidden');
        document.getElementById('shareUrl').textContent = shareUrl;
        QRCode.toCanvas(document.getElementById('qr'), shareUrl, { width: 240, margin: 1 });
    };
    document.getElementById('closeShare').onclick = () => shareModal.classList.add('hidden');
    document.getElementById('copyBtn').onclick = () => navigator.clipboard.writeText(shareUrl);

    loadMine();
})();
