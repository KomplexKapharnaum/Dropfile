// Project "drop home": a menu page. Loads the project's title + intro + the list
// of scenes that have a menu-button label, and renders one big button per scene.
// Picking a button forwards to that scene's existing /d/:token messaging page.
(function () {
    const token = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');
    const $ = id => document.getElementById(id);

    // ---- i18n (English / French by browser language; fallback English) ----
    const STR = {
        en: { pick: 'Choose where to send:', empty: 'Nothing to send to right now — check back soon.', unknown: 'This link is not available.' },
        fr: { pick: 'Choisissez où envoyer :', empty: 'Rien à envoyer pour le moment — revenez bientôt.', unknown: 'Ce lien n’est pas disponible.' }
    };
    function pickLang() {
        const prefs = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || ''];
        for (const p of prefs) { const c = String(p).toLowerCase(); if (c.startsWith('fr')) return 'fr'; if (c.startsWith('en')) return 'en'; }
        return 'en';
    }
    const lang = pickLang();
    const D = Object.assign({}, STR.en, STR[lang] || {});
    const t = k => (D[k] != null ? D[k] : k);
    document.documentElement.lang = lang;

    const ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>';

    function showHint(text) { const h = $('hint'); h.textContent = text; h.classList.remove('hidden'); }

    fetch('/api/home/' + encodeURIComponent(token))
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(info => {
            const name = info.project || 'KXKM';
            $('sub').textContent = name;
            $('title').textContent = name;
            const welcome = (info.welcome || '').trim();
            if (welcome) { $('welcome').textContent = welcome; $('welcome').classList.remove('hidden'); }

            const scenes = Array.isArray(info.scenes) ? info.scenes : [];
            const menu = $('menu');
            if (!scenes.length) { showHint(t('empty')); return; }
            for (const s of scenes) {
                const a = document.createElement('a');
                a.className = 'home-btn';
                a.href = s.url;
                a.innerHTML = '<span class="home-btn-label"></span><span class="home-btn-arrow">' + ARROW + '</span>';
                a.querySelector('.home-btn-label').textContent = s.label;
                menu.appendChild(a);
            }
        })
        .catch(() => { $('sub').textContent = 'unknown'; showHint(t('unknown')); });
})();
