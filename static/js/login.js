(() => {
    'use strict';

    const nameInput = document.getElementById('team-name-input');
    const colorInput = document.getElementById('color-input');
    const emojiInput = document.getElementById('emoji-input');
    const previewCard = document.getElementById('team-preview');
    const previewName = document.getElementById('preview-name');
    const previewEmoji = document.getElementById('preview-emoji');

    const swatches = [...document.querySelectorAll('.swatch')];
    const emblems = [...document.querySelectorAll('.emblem')];

    const selectSwatch = (color) => {
        colorInput.value = color;
        swatches.forEach(s => s.classList.toggle('selected', s.dataset.color === color));
        previewCard.style.setProperty('--c', color);
    };
    const selectEmblem = (slug) => {
        emojiInput.value = slug;
        emblems.forEach(e => e.classList.toggle('selected', e.dataset.emblem === slug));
        previewEmoji.innerHTML = `<svg class="icon icon-2xl"><use href="/static/images/sprite.svg#i-${slug}"/></svg>`;
    };

    swatches.forEach(s => s.addEventListener('click', () => selectSwatch(s.dataset.color)));
    emblems.forEach(e => e.addEventListener('click', () => selectEmblem(e.dataset.emblem)));

    nameInput.addEventListener('input', () => {
        previewName.textContent = nameInput.value.trim() || '— pick a name —';
    });

    document.querySelectorAll('.rejoin button[data-name]').forEach(btn => {
        btn.addEventListener('click', () => {
            nameInput.value = btn.dataset.name;
            selectSwatch(btn.dataset.color || '#8b1d2a');
            selectEmblem(btn.dataset.emoji || 'target');
            previewName.textContent = btn.dataset.name;
            nameInput.focus();
        });
    });

    selectSwatch(colorInput.value || '#8b1d2a');
    selectEmblem(emojiInput.value || 'target');

    /* ---------- Mode tabs: Join vs Solo ---------- */
    const form = document.getElementById('login-form');
    const submitBtn = document.getElementById('login-submit');
    const submitLabel = document.getElementById('login-btn-label');
    const soloFields = document.getElementById('solo-fields');
    const soloCategory = document.getElementById('solo-category');
    const soloError = document.getElementById('solo-error');
    const tabs = [...document.querySelectorAll('.mode-tab')];
    let mode = 'join';

    const showError = (msg) => {
        soloError.textContent = msg;
        soloError.hidden = !msg;
    };

    const setMode = (next) => {
        mode = next;
        tabs.forEach(t => t.classList.toggle('is-active', t.dataset.mode === next));
        soloFields.hidden = (next !== 'solo');
        submitLabel.textContent = next === 'solo' ? 'Start solo game' : 'Join the game';
        form.dataset.mode = next;
        showError('');
        if (next === 'solo' && soloCategory && soloCategory.options.length <= 1) loadCategories();
    };

    tabs.forEach(t => t.addEventListener('click', () => setMode(t.dataset.mode)));

    const loadCategories = async () => {
        try {
            const cats = await fetch('/api/categories', { credentials: 'same-origin' }).then(r => r.json());
            soloCategory.innerHTML = '<option value="">All categories (mixed)</option>' +
                cats.map(c => `<option value="${c.category.replace(/"/g,'&quot;')}">${c.category} (${c.count})</option>`).join('');
        } catch (e) { /* leave the placeholder */ }
    };

    form.addEventListener('submit', async (e) => {
        if (form.dataset.mode !== 'solo') return;  // standard POST flow
        e.preventDefault();
        showError('');
        const body = {
            team_name: nameInput.value.trim(),
            color: colorInput.value,
            emoji: emojiInput.value,
            category_filter: soloCategory ? soloCategory.value : '',
            target_question_count: Number(document.getElementById('solo-count').value) || 10,
        };
        submitBtn.disabled = true;
        submitLabel.textContent = 'Starting…';
        try {
            const res = await fetch('/api/solo/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify(body),
            });
            const data = await res.json();
            if (!res.ok) {
                showError(data.error || 'Could not start solo game.');
                submitBtn.disabled = false;
                submitLabel.textContent = 'Start solo game';
                return;
            }
            window.location.href = data.redirect || '/play';
        } catch (err) {
            showError(err.message || 'Network error.');
            submitBtn.disabled = false;
            submitLabel.textContent = 'Start solo game';
        }
    });
})();
