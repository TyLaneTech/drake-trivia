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
})();
