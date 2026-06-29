// Blind drop box. Uploaders see only their own uploads (tracked by a local
// visitor token). They never see anyone else's media.
(function () {
    const token = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');

    // stable per-device visitor id + remembered nick
    let visitor = localStorage.getItem('df_visitor');
    if (!visitor) {
        visitor = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now());
        localStorage.setItem('df_visitor', visitor);
    }
    const nickInput = document.getElementById('nick');
    nickInput.value = localStorage.getItem('df_nick') || '';
    nickInput.addEventListener('input', () => {
        const v = nickInput.value.replace(/ /g, '_').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20);
        nickInput.value = v;
        localStorage.setItem('df_nick', v);
    });

    let allowSelfDelete = false;

    // drop metadata (project / source names)
    fetch('/api/drop/' + token).then(r => r.ok ? r.json() : Promise.reject()).then(info => {
        document.getElementById('sourceName').textContent = info.source || 'Drop';
        document.getElementById('projectName').textContent = info.project || '';
        allowSelfDelete = info.allowSelfDelete;
        document.title = 'Drop · ' + (info.project || '');
    }).catch(() => {
        document.getElementById('sourceName').textContent = 'Unknown drop';
    });

    // Dropzone (multi-upload)
    Dropzone.autoDiscover = false;
    const dz = new Dropzone('#dz', {
        url: '/api/drop/' + token,
        paramName: 'file',
        maxFilesize: 4096,           // MB, client-side; server enforces the real cap
        parallelUploads: 3,
        timeout: 0,
        dictDefaultMessage: '📷  Tap or drop your photos / videos here',
        sending: (file, xhr, formData) => {
            formData.append('nick', localStorage.getItem('df_nick') || 'anon');
            formData.append('visitor', visitor);
        }
    });
    dz.on('success', (file) => { dz.removeFile(file); loadMine(); });
    dz.on('queuecomplete', loadMine);

    // my uploads
    const grid = document.getElementById('mineGrid');
    const hint = document.getElementById('mineHint');

    function loadMine() {
        fetch('/api/drop/' + token + '/mine?visitor=' + encodeURIComponent(visitor))
            .then(r => r.json())
            .then(data => {
                allowSelfDelete = data.allowSelfDelete;
                render(data.uploads || []);
            }).catch(() => {});
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
                ph.textContent = u.type === 'video' ? '▶' : '📄';
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
