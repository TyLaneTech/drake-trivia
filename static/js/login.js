(() => {
    'use strict';
    const nameInput = document.getElementById('team-name-input');
    const emojiInput = document.getElementById('emoji-input');
    const colorInput = document.getElementById('color-input');
    const previewName = document.getElementById('preview-name');
    const previewEmoji = document.getElementById('preview-emoji');
    const preview = document.getElementById('team-preview');

    const update = () => {
        previewName.textContent = (nameInput.value || 'Your team name');
        previewName.style.color = colorInput.value;
        previewEmoji.textContent = emojiInput.value || '🎯';
        preview.style.borderColor = colorInput.value;
        preview.style.boxShadow = `0 0 0 1px ${colorInput.value}33, 0 8px 24px ${colorInput.value}26`;
    };

    nameInput.addEventListener('input', update);
    emojiInput.addEventListener('input', update);
    colorInput.addEventListener('input', update);

    document.querySelectorAll('.existing-teams button[data-name]').forEach(btn => {
        btn.addEventListener('click', () => {
            nameInput.value = btn.dataset.name;
            colorInput.value = btn.dataset.color || '#d61f2b';
            emojiInput.value = btn.dataset.emoji || '🎯';
            update();
            nameInput.focus();
        });
    });

    update();
})();
