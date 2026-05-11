(() => {
    'use strict';
    const { fetchJSON, escapeHtml, connectSocket } = window.dt;

    /* -------------------- Tabs -------------------- */
    document.querySelectorAll('.admin-tabs .tab').forEach(t => {
        t.addEventListener('click', () => {
            document.querySelectorAll('.admin-tabs .tab').forEach(x => x.classList.remove('active'));
            t.classList.add('active');
            const target = t.dataset.tab;
            document.querySelectorAll('.tab-panel').forEach(p => {
                p.hidden = (p.id !== `panel-${target}`);
                if (p.id === `panel-${target}`) p.classList.add('active');
                else p.classList.remove('active');
            });
            if (target === 'questions') loadQuestions();
            if (target === 'teams') loadTeams();
        });
    });

    /* -------------------- Live game state -------------------- */
    let state = null;
    let timerInterval = null;

    const els = {
        statePill: document.getElementById('game-state-pill'),
        meta: document.getElementById('game-meta'),
        progressMeta: document.getElementById('game-progress-meta'),
        categorySelect: document.getElementById('game-category-select'),
        empty: document.getElementById('round-empty'),
        active: document.getElementById('round-active'),
        category: document.getElementById('round-category'),
        difficulty: document.getElementById('round-difficulty'),
        points: document.getElementById('round-points'),
        timer: document.getElementById('round-timer'),
        question: document.getElementById('round-question'),
        correct: document.getElementById('round-correct'),
        options: document.getElementById('round-options'),
        barFill: document.getElementById('answers-bar-fill'),
        barLabel: document.getElementById('answers-bar-label'),
        leaderboard: document.getElementById('leaderboard-list'),
        manualAdjustBody: document.getElementById('manual-adjust-body'),
        // Auto-host
        ahToggle: document.getElementById('auto-host-toggle'),
        ahConfig: document.getElementById('auto-host-config'),
        ahTarget: document.getElementById('ah-target-count'),
        ahReveal: document.getElementById('ah-reveal-delay'),
        ahNext: document.getElementById('ah-next-delay'),
        ahSave: document.getElementById('ah-save'),
    };

    const renderState = (payload) => {
        state = payload;
        const g = payload.game;
        if (!g) {
            els.statePill.textContent = 'No game';
            els.meta.textContent = 'Start a new game from the Settings tab.';
            els.progressMeta.textContent = '';
            els.empty.hidden = false;
            els.active.hidden = true;
            return;
        }
        els.statePill.textContent = g.state === 'active' ? `${g.phase}` : g.state;
        const categoryLabel = g.category_filter ? ` · ${g.category_filter}` : '';
        els.meta.textContent = `Game #${g.id} · ${payload.total_teams} team${payload.total_teams === 1 ? '' : 's'}${categoryLabel}`;
        // Progress + auto-host indicator
        const played = g.rounds_played || 0;
        const target = g.target_question_count;
        const progress = target ? `Round ${played} of ${target}` : `${played} rounds played`;
        const autoBadge = g.auto_host ? ' · Auto-Host on' : '';
        els.progressMeta.textContent = `${progress}${autoBadge}`;
        if (els.categorySelect) els.categorySelect.value = g.category_filter || '';
        // Sync auto-host controls with server truth
        if (els.ahToggle && document.activeElement !== els.ahToggle) {
            els.ahToggle.checked = !!g.auto_host;
            els.ahConfig.hidden = !g.auto_host;
        }
        if (els.ahTarget && document.activeElement !== els.ahTarget) {
            els.ahTarget.value = target != null ? target : '';
        }
        if (els.ahReveal && document.activeElement !== els.ahReveal) {
            els.ahReveal.value = g.auto_reveal_delay_s != null ? g.auto_reveal_delay_s : 3;
        }
        if (els.ahNext && document.activeElement !== els.ahNext) {
            els.ahNext.value = g.auto_next_delay_s != null ? g.auto_next_delay_s : '';
        }

        if (!payload.round) {
            els.empty.hidden = false;
            els.active.hidden = true;
            stopTimer();
        } else {
            els.empty.hidden = true;
            els.active.hidden = false;
            renderRound(payload.round);
        }
        renderLeaderboard(payload.leaderboard || []);
    };

    const renderRound = (round) => {
        const q = round.question;
        els.category.textContent = q.category;
        els.difficulty.textContent = q.difficulty;
        els.difficulty.dataset.d = q.difficulty;
        els.points.textContent = `+${q.points}`;
        els.question.textContent = q.text;
        els.correct.innerHTML = `<strong>Correct answer:</strong> ${escapeHtml(q.correct_answer || '—')}`;
        // Options list (admin view marks correct)
        els.options.innerHTML = '';
        (q.options || []).forEach(opt => {
            const li = document.createElement('li');
            li.textContent = opt;
            if (String(opt).trim().toLowerCase() === String(q.correct_answer || '').trim().toLowerCase()) {
                li.classList.add('is-correct');
            }
            els.options.appendChild(li);
        });
        renderAnswerCount({
            answer_count: round.answer_count,
            total_teams: state ? state.total_teams : 0,
        });
        startTimer(round, q.time_limit_s);
    };

    const renderAnswerCount = ({ answer_count, total_teams }) => {
        const total = Math.max(1, total_teams || 1);
        const pct = Math.min(100, Math.round((answer_count / total) * 100));
        els.barFill.style.width = `${pct}%`;
        els.barLabel.textContent = `${answer_count} / ${total_teams || 0} answered`;
    };

    const renderLeaderboard = (rows) => {
        els.leaderboard.innerHTML = '';
        if (!rows.length) {
            els.leaderboard.innerHTML = '<li class="leaderboard-empty">No teams have joined yet.</li>';
            els.manualAdjustBody.innerHTML = '';
            return;
        }
        rows.forEach(r => {
            const li = document.createElement('li');
            li.style.borderLeftColor = r.color || 'var(--ruby)';
            li.innerHTML = `
                <span class="leaderboard-rank">${r.rank}</span>
                <span class="leaderboard-emoji" style="color: ${r.color}">${window.dt.icon(r.emoji || 'target')}</span>
                <span class="leaderboard-name">${escapeHtml(r.team_name)}</span>
                <span class="leaderboard-score">${r.score}</span>
            `;
            els.leaderboard.appendChild(li);
        });

        els.manualAdjustBody.innerHTML = '';
        rows.forEach(r => {
            const row = document.createElement('div');
            row.className = 'manual-adjust-row';
            row.innerHTML = `
                <span class="name"><span style="color: ${r.color}">${window.dt.icon(r.emoji || 'target')}</span> ${escapeHtml(r.team_name)}</span>
                <button data-team="${r.team_id}" data-delta="-1" title="-1">−</button>
                <span class="score">${r.score}</span>
                <button data-team="${r.team_id}" data-delta="1" title="+1">+</button>
            `;
            els.manualAdjustBody.appendChild(row);
        });
        els.manualAdjustBody.querySelectorAll('button').forEach(btn => {
            btn.addEventListener('click', async () => {
                btn.disabled = true;
                try {
                    await fetchJSON('/api/admin/score/adjust', {
                        method: 'POST',
                        body: { team_id: Number(btn.dataset.team), delta: Number(btn.dataset.delta) },
                    });
                } catch (e) { console.error(e); }
                btn.disabled = false;
            });
        });
    };

    /* -------------------- Timer -------------------- */
    const stopTimer = () => {
        if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
        els.timer.textContent = '--';
    };

    const startTimer = (round, limit) => {
        stopTimer();
        if (!round.shown_at) return;
        const shownAt = new Date(round.shown_at).getTime();
        const tick = () => {
            const elapsed = (Date.now() - shownAt) / 1000;
            const remaining = Math.max(0, Math.ceil(limit - elapsed));
            els.timer.textContent = `${remaining}s`;
            if (remaining <= 0) stopTimer();
        };
        tick();
        timerInterval = setInterval(tick, 250);
    };

    /* -------------------- Category picker -------------------- */
    const loadCategoriesIntoSelect = async () => {
        if (!els.categorySelect) return;
        try {
            const cats = await fetchJSON('/api/admin/categories');
            const cur = els.categorySelect.value;
            els.categorySelect.innerHTML =
                '<option value="">All categories (mixed)</option>' +
                cats.map(c => `<option value="${escapeHtml(c.category)}">${escapeHtml(c.category)} (${c.count})</option>`).join('');
            els.categorySelect.value = cur;
        } catch (e) { console.error('Failed to load categories', e); }
    };
    if (els.categorySelect) {
        els.categorySelect.addEventListener('change', async () => {
            try {
                await fetchJSON('/api/admin/game/category', {
                    method: 'POST',
                    body: { category_filter: els.categorySelect.value },
                });
                refreshGame();
            } catch (err) { alert(err.message); }
        });
        loadCategoriesIntoSelect();
    }

    /* -------------------- Control buttons -------------------- */
    document.getElementById('btn-start-round').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try { await fetchJSON('/api/admin/game/start_round', { method: 'POST', body: {} }); }
        catch (err) { alert(err.message); }
        btn.disabled = false;
    });
    document.getElementById('btn-lock').addEventListener('click', async () => {
        try { await fetchJSON('/api/admin/game/lock', { method: 'POST' }); }
        catch (err) { alert(err.message); }
    });
    document.getElementById('btn-reveal').addEventListener('click', async () => {
        try { await fetchJSON('/api/admin/game/reveal', { method: 'POST' }); }
        catch (err) { alert(err.message); }
    });
    document.getElementById('btn-end-game').addEventListener('click', () => {
        confirmDialog('End this game and show the finale?', async () => {
            try { await fetchJSON('/api/admin/game/end', { method: 'POST' }); }
            catch (err) { alert(err.message); }
        });
    });

    /* -------------------- Sockets -------------------- */
    // Admins always re-fetch full state (with correct answers) from /api/admin/game.
    const sock = connectSocket({
        'state': () => refreshGame(),
        'leaderboard': (p) => { renderLeaderboard(p.leaderboard); },
        'answer_count': (p) => {
            if (state && state.round && p.round_id === state.round.round_id) {
                state.round.answer_count = p.answer_count;
                renderAnswerCount(p);
            }
        },
        'question_start': () => refreshGame(),
        'round_locked': () => refreshGame(),
        'reveal': () => refreshGame(),
        'finale': () => refreshGame(),
    });

    const refreshGame = async () => {
        try {
            const data = await fetchJSON('/api/admin/game');
            const payload = {
                game: data.state === 'none' ? null : data,
                round: data.current_round,
                leaderboard: data.leaderboard,
                total_teams: (data.leaderboard || []).length,
                pending_ready: data.pending_ready || [],
            };
            renderState(payload);
        } catch (e) { console.error(e); }
    };

    /* -------------------- Auto-host config -------------------- */
    const saveAutoHost = async () => {
        const body = {
            auto_host: els.ahToggle.checked,
            target_question_count: els.ahTarget.value === '' ? null : Number(els.ahTarget.value),
            auto_reveal_delay_s: Number(els.ahReveal.value) || 3,
            auto_next_delay_s: els.ahNext.value === '' ? null : Number(els.ahNext.value),
        };
        try {
            await fetchJSON('/api/admin/game/auto_host', { method: 'POST', body });
            refreshGame();
        } catch (err) { alert(err.message); }
    };
    if (els.ahToggle) {
        els.ahToggle.addEventListener('change', () => {
            els.ahConfig.hidden = !els.ahToggle.checked;
            saveAutoHost();
        });
    }
    if (els.ahSave) els.ahSave.addEventListener('click', saveAutoHost);

    /* -------------------- Questions tab -------------------- */
    let allQuestions = [];

    const loadQuestions = async () => {
        const tbody = document.getElementById('questions-tbody');
        tbody.innerHTML = '<tr><td colspan="8" class="loading">Loading…</td></tr>';
        try {
            allQuestions = await fetchJSON('/api/admin/questions');
            populateCategoryFilter();
            renderQuestions();
            loadCategoriesIntoSelect();
        } catch (e) {
            tbody.innerHTML = `<tr><td colspan="8" class="empty">Failed to load: ${e.message}</td></tr>`;
        }
    };

    const populateCategoryFilter = () => {
        const sel = document.getElementById('q-filter-cat');
        const current = sel.value;
        const cats = [...new Set(allQuestions.map(q => q.category))].sort();
        sel.innerHTML = '<option value="">All categories</option>' +
            cats.map(c => `<option value="${escapeHtml(c)}"${c === current ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('');
    };

    const renderQuestions = () => {
        const tbody = document.getElementById('questions-tbody');
        const q = document.getElementById('q-search').value.toLowerCase();
        const fcat = document.getElementById('q-filter-cat').value;
        const ftype = document.getElementById('q-filter-type').value;

        const rows = allQuestions.filter(x =>
            (!q || x.text.toLowerCase().includes(q) || (x.correct_answer || '').toLowerCase().includes(q)) &&
            (!fcat || x.category === fcat) &&
            (!ftype || x.type === ftype)
        );

        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="8" class="empty">No questions match — try clearing filters or add a new one.</td></tr>';
            return;
        }
        tbody.innerHTML = rows.map(r => `
            <tr>
                <td>${r.id}</td>
                <td class="question-text">${escapeHtml(r.text)}</td>
                <td>${typeLabel(r.type)}</td>
                <td>${escapeHtml(r.category)}</td>
                <td><span class="tag tag-difficulty" data-d="${escapeHtml(r.difficulty)}">${escapeHtml(r.difficulty)}</span></td>
                <td>${r.points}</td>
                <td>${r.time_limit_s}s</td>
                <td class="row-actions">
                    <button class="primary" data-act="push" data-id="${r.id}" title="Push this question to the game now">Push</button>
                    <button data-act="edit" data-id="${r.id}">Edit</button>
                    <button class="danger" data-act="del" data-id="${r.id}">Delete</button>
                </td>
            </tr>
        `).join('');
        tbody.querySelectorAll('button[data-act]').forEach(b => {
            b.addEventListener('click', () => handleQuestionAction(b.dataset.act, Number(b.dataset.id)));
        });
    };

    const typeLabel = (t) => ({
        multiple_choice: 'Multi',
        true_false: 'T/F',
        free_text: 'Free',
    })[t] || t;

    const handleQuestionAction = async (act, id) => {
        const q = allQuestions.find(x => x.id === id);
        if (act === 'edit') openQuestionModal(q);
        else if (act === 'push') {
            try {
                await fetchJSON('/api/admin/game/start_round', { method: 'POST', body: { question_id: id } });
                document.querySelector('.admin-tabs .tab[data-tab="live"]').click();
            } catch (e) { alert(e.message); }
        } else if (act === 'del') {
            confirmDialog(`Delete this question?\n\n"${q.text}"`, async () => {
                await fetchJSON(`/api/admin/questions/${id}`, { method: 'DELETE' });
                loadQuestions();
            });
        }
    };

    document.getElementById('q-search').addEventListener('input', renderQuestions);
    document.getElementById('q-filter-cat').addEventListener('change', renderQuestions);
    document.getElementById('q-filter-type').addEventListener('change', renderQuestions);
    document.getElementById('btn-new-question').addEventListener('click', () => openQuestionModal(null));

    /* -------------------- Question modal -------------------- */
    const qModal = document.getElementById('question-modal');
    const qForm = document.getElementById('question-form');

    const openQuestionModal = (q) => {
        document.getElementById('question-modal-title').textContent = q ? 'Edit question' : 'New question';
        document.getElementById('q-id').value = q ? q.id : '';
        document.getElementById('q-type').value = q ? q.type : 'multiple_choice';
        document.getElementById('q-text').value = q ? q.text : '';
        document.getElementById('q-correct').value = q ? q.correct_answer : '';
        document.getElementById('q-category').value = q ? q.category : 'General';
        document.getElementById('q-difficulty').value = q ? q.difficulty : 'medium';
        document.getElementById('q-points').value = q ? q.points : 5;
        document.getElementById('q-time').value = q ? q.time_limit_s : 30;
        document.getElementById('q-explanation').value = q && q.explanation ? q.explanation : '';
        renderOptionsEditor(q ? q.options : ['', '', '', '']);
        toggleOptionsByType();
        qModal.showModal();
    };

    document.getElementById('q-type').addEventListener('change', toggleOptionsByType);
    document.getElementById('q-add-option').addEventListener('click', () => {
        const list = document.getElementById('q-options-list');
        addOptionRow(list, '');
    });

    function toggleOptionsByType() {
        const t = document.getElementById('q-type').value;
        const wrap = document.getElementById('q-options-wrap');
        if (t === 'multiple_choice') {
            wrap.hidden = false;
        } else if (t === 'true_false') {
            renderOptionsEditor(['True', 'False']);
            wrap.hidden = true;
        } else {
            wrap.hidden = true;
        }
    }

    function renderOptionsEditor(opts) {
        const list = document.getElementById('q-options-list');
        list.innerHTML = '';
        (opts || []).forEach(o => addOptionRow(list, o));
        if (!list.children.length) {
            addOptionRow(list, ''); addOptionRow(list, '');
        }
    }
    function addOptionRow(list, value) {
        const row = document.createElement('div');
        row.className = 'option-row';
        row.innerHTML = `
            <input type="text" value="${escapeHtml(value)}" placeholder="Option text">
            <button type="button" class="ghost-btn" data-remove>×</button>
        `;
        row.querySelector('[data-remove]').addEventListener('click', () => row.remove());
        list.appendChild(row);
    }

    qForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('q-id').value;
        const t = document.getElementById('q-type').value;
        const opts = [...document.querySelectorAll('#q-options-list .option-row input')]
            .map(i => i.value.trim()).filter(Boolean);
        const body = {
            type: t,
            text: document.getElementById('q-text').value.trim(),
            correct_answer: document.getElementById('q-correct').value.trim(),
            options: t === 'multiple_choice' ? opts : (t === 'true_false' ? ['True', 'False'] : []),
            category: document.getElementById('q-category').value.trim() || 'General',
            difficulty: document.getElementById('q-difficulty').value,
            points: Number(document.getElementById('q-points').value) || 5,
            time_limit_s: Number(document.getElementById('q-time').value) || 30,
            explanation: document.getElementById('q-explanation').value.trim() || null,
        };
        try {
            if (id) await fetchJSON(`/api/admin/questions/${id}`, { method: 'PUT', body });
            else    await fetchJSON('/api/admin/questions', { method: 'POST', body });
            qModal.close();
            loadQuestions();
        } catch (err) {
            alert('Could not save: ' + err.message);
        }
    });
    qModal.addEventListener('click', (e) => { if (e.target === qModal) qModal.close(); });
    qModal.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => qModal.close()));

    /* -------------------- Import modal -------------------- */
    const importModal = document.getElementById('import-modal');
    document.getElementById('btn-import-questions').addEventListener('click', () => {
        document.getElementById('import-text').value = '';
        document.getElementById('import-result').hidden = true;
        importModal.showModal();
    });
    importModal.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => importModal.close()));
    document.getElementById('btn-do-import').addEventListener('click', async () => {
        let parsed;
        try { parsed = JSON.parse(document.getElementById('import-text').value); }
        catch (e) {
            const r = document.getElementById('import-result');
            r.hidden = false; r.classList.add('has-errors');
            r.textContent = 'Invalid JSON: ' + e.message;
            return;
        }
        try {
            const result = await fetchJSON('/api/admin/questions/import', { method: 'POST', body: parsed });
            const r = document.getElementById('import-result');
            r.hidden = false;
            r.classList.toggle('has-errors', (result.errors || []).length > 0);
            r.textContent = `Imported ${result.created} question(s).` +
                (result.errors && result.errors.length ? `  Errors: ${JSON.stringify(result.errors)}` : '');
            loadQuestions();
        } catch (err) { alert(err.message); }
    });

    /* -------------------- Teams tab -------------------- */
    const loadTeams = async () => {
        const tbody = document.getElementById('teams-tbody');
        tbody.innerHTML = '<tr><td colspan="5" class="loading">Loading…</td></tr>';
        try {
            const teams = await fetchJSON('/api/admin/teams');
            if (!teams.length) {
                tbody.innerHTML = '<tr><td colspan="5" class="empty">No teams yet.</td></tr>';
                return;
            }
            tbody.innerHTML = teams.map(t => `
                <tr>
                    <td><span style="color: ${escapeHtml(t.color)}">${window.dt.icon(t.emoji || 'target')}</span> ${escapeHtml(t.name)}</td>
                    <td><span class="swatch" style="background: ${escapeHtml(t.color)}"></span>${escapeHtml(t.color)}</td>
                    <td><strong>${t.score}</strong></td>
                    <td>${t.id}</td>
                    <td class="row-actions">
                        <button class="danger" data-act="delete" data-id="${t.id}">Delete</button>
                    </td>
                </tr>
            `).join('');
            tbody.querySelectorAll('button[data-act="delete"]').forEach(b => {
                b.addEventListener('click', () => {
                    confirmDialog('Delete this team? Their answers stay in the round results.', async () => {
                        await fetchJSON(`/api/admin/teams/${b.dataset.id}`, { method: 'DELETE' });
                        loadTeams();
                    });
                });
            });
        } catch (e) {
            tbody.innerHTML = `<tr><td colspan="5" class="empty">Failed to load: ${e.message}</td></tr>`;
        }
    };
    document.getElementById('btn-refresh-teams').addEventListener('click', loadTeams);

    /* -------------------- Settings tab -------------------- */
    document.getElementById('btn-new-game').addEventListener('click', () => {
        confirmDialog('Start a fresh game? The current game (if any) will end and scores will reset.', async () => {
            try {
                await fetchJSON('/api/admin/game/new', { method: 'POST', body: {} });
                refreshGame();
            } catch (e) { alert(e.message); }
        });
    });
    document.getElementById('btn-copy-link').addEventListener('click', async () => {
        const url = `${window.location.protocol}//${window.location.host}/login`;
        try { await navigator.clipboard.writeText(url); alert('Copied: ' + url); }
        catch { prompt('Copy this link:', url); }
    });

    /* -------------------- Confirm modal -------------------- */
    const confirmModal = document.getElementById('confirm-modal');
    const confirmMsg = document.getElementById('confirm-message');
    const confirmOk = document.getElementById('confirm-ok');
    const confirmCancel = document.getElementById('confirm-cancel');
    let confirmHandler = null;
    function confirmDialog(message, onConfirm) {
        confirmMsg.textContent = message;
        confirmHandler = onConfirm;
        confirmModal.showModal();
    }
    confirmOk.addEventListener('click', async () => {
        confirmModal.close();
        if (confirmHandler) {
            try { await confirmHandler(); } catch (e) { alert(e.message); }
            confirmHandler = null;
        }
    });
    confirmCancel.addEventListener('click', () => confirmModal.close());

    /* -------------------- Boot -------------------- */
    refreshGame();
})();
