(() => {
    'use strict';
    const { fetchJSON, escapeHtml } = window.dt;

    const gameId = window.RECAP_GAME_ID;
    if (!gameId) return;

    const els = {
        title: document.getElementById('recap-title'),
        meta: document.getElementById('recap-meta'),
        standings: document.getElementById('recap-standings'),
        awardsSection: document.getElementById('recap-awards-section'),
        awards: document.getElementById('recap-awards'),
        rounds: document.getElementById('recap-rounds'),
        roundsCount: document.getElementById('recap-rounds-count'),
        toggleAll: document.getElementById('recap-toggle-all'),
        otherList: document.getElementById('recap-other-list'),
    };

    const fmtTime = (iso) => {
        if (!iso) return '';
        const d = new Date(iso);
        return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    };
    const fmtDuration = (a, b) => {
        if (!a || !b) return '';
        const ms = new Date(b) - new Date(a);
        if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
        const m = Math.floor(ms / 60_000);
        const s = Math.round((ms % 60_000) / 1000);
        return `${m}m ${s}s`;
    };
    const fmtMs = (ms) => (ms == null ? '—' : (ms / 1000).toFixed(1) + 's');

    const renderStandings = (rows) => {
        els.standings.innerHTML = '';
        if (!rows || !rows.length) {
            els.standings.innerHTML = '<li class="recap-empty-row">No teams played in this game.</li>';
            return;
        }
        const top = rows[0].score;
        rows.forEach((r, i) => {
            const li = document.createElement('li');
            li.className = 'recap-standing';
            if (r.score === top && top > 0 && i === 0) li.classList.add('is-winner');
            li.style.setProperty('--team-color', r.color || 'var(--accent)');
            li.innerHTML = `
                <span class="rs-rank">#${r.rank}</span>
                <span class="rs-emoji" style="color: ${r.color}">${window.dt.icon(r.emoji || 'target', { className: 'icon-2xl' })}</span>
                <span class="rs-name">${escapeHtml(r.team_name)}</span>
                <span class="rs-score">${r.score}<span class="rs-pts">pts</span></span>
            `;
            els.standings.appendChild(li);
        });
    };

    const renderAwards = (awards) => {
        if (!awards || !awards.length) {
            els.awardsSection.hidden = true;
            return;
        }
        els.awardsSection.hidden = false;
        // Split into positive (Hall of Fame) and negative (Hall of Shame)
        const positives = awards.filter(a => a.tone !== 'negative');
        const negatives = awards.filter(a => a.tone === 'negative');
        const renderOne = (a) => `
            <li class="recap-award ${a.tone === 'negative' ? 'is-negative' : 'is-positive'}">
                <span class="ra-icon">${window.dt.icon(a.icon || 'medal', { className: 'icon-2xl' })}</span>
                <div class="ra-text">
                    <div class="ra-title">${escapeHtml(a.title)}</div>
                    <div class="ra-sub">${escapeHtml(a.subtitle || '')}</div>
                </div>
                <span class="ra-team" style="color: ${a.team.color}">
                    ${window.dt.icon(a.team.emoji || 'target')}
                    <span>${escapeHtml(a.team.team_name)}</span>
                </span>
            </li>
        `;
        let html = '';
        if (positives.length) {
            html += `<h3 class="awards-subhead">Hall of Fame</h3><ul class="recap-awards-group">${positives.map(renderOne).join('')}</ul>`;
        }
        if (negatives.length) {
            html += `<h3 class="awards-subhead is-shame">Hall of Shame</h3><ul class="recap-awards-group">${negatives.map(renderOne).join('')}</ul>`;
        }
        els.awards.innerHTML = html;
    };

    const renderRounds = (rounds) => {
        els.rounds.innerHTML = '';
        if (!rounds || !rounds.length) {
            els.rounds.innerHTML = '<li class="recap-empty-row">No rounds were played in this game.</li>';
            els.roundsCount.textContent = '';
            return;
        }
        els.roundsCount.textContent = `${rounds.length} round${rounds.length === 1 ? '' : 's'}`;
        rounds.forEach(r => {
            const q = r.question;
            const correctText = String(q.correct_answer || '').split('|')[0];
            const optionsHtml = (q.options && q.options.length)
                ? `<ul class="rr-options">${q.options.map(o => {
                        const isC = String(o).trim().toLowerCase() === String(q.correct_answer || '').trim().toLowerCase();
                        return `<li class="${isC ? 'is-correct' : ''}">${escapeHtml(o)}</li>`;
                    }).join('')}</ul>`
                : '';
            const answersHtml = r.answers && r.answers.length
                ? `<ol class="rr-answers">${r.answers.map(a => `
                        <li class="rr-answer ${a.is_correct ? 'is-correct' : 'is-wrong'}">
                            <span class="ra-tick">${window.dt.icon(a.is_correct ? 'check' : 'cross', { className: a.is_correct ? 'icon-success' : 'icon-danger' })}</span>
                            <span class="ra-team-emoji" style="color: ${a.team_color}">${window.dt.icon(a.team_emoji || 'target')}</span>
                            <span class="ra-team-name">${escapeHtml(a.team_name)}${a.is_first_correct ? '<span class="ra-first">First</span>' : ''}</span>
                            <span class="ra-answer-text">${escapeHtml(a.answer_text || '—')}</span>
                            <span class="ra-time">${fmtMs(a.response_time_ms)}</span>
                            <span class="ra-pts ${a.is_correct ? 'pos' : 'zero'}">${a.is_correct ? '+' : ''}${a.points_awarded}</span>
                        </li>
                    `).join('')}</ol>`
                : '<p class="rr-no-answers">No answers were submitted.</p>';
            const explanationHtml = q.explanation
                ? `<p class="rr-explanation">${escapeHtml(q.explanation)}</p>`
                : '';

            const li = document.createElement('li');
            li.className = 'recap-round';
            li.innerHTML = `
                <details class="rr-details">
                    <summary>
                        <span class="rr-num">Q${r.sequence}</span>
                        <span class="rr-cat">${escapeHtml(q.category)}</span>
                        <span class="rr-q-text">${escapeHtml(q.text)}</span>
                        <span class="rr-correct-pill"><span class="rr-correct-label">Answer:</span> ${escapeHtml(correctText)}</span>
                        <span class="rr-chev" aria-hidden="true">▾</span>
                    </summary>
                    <div class="rr-body">
                        <div class="rr-meta">
                            <span class="tag tag-difficulty" data-d="${escapeHtml(q.difficulty)}">${escapeHtml(q.difficulty)}</span>
                            <span class="tag">+${q.points} pts</span>
                            <span class="tag">${q.time_limit_s}s limit</span>
                        </div>
                        ${optionsHtml}
                        ${explanationHtml}
                        <h4 class="rr-answers-heading">Submissions</h4>
                        ${answersHtml}
                    </div>
                </details>
            `;
            els.rounds.appendChild(li);
        });
    };

    const renderHeader = (game, totalRounds) => {
        els.title.textContent = game.name || 'Drake Trivia';
        const parts = [];
        if (game.ended_at) parts.push(`Finished ${fmtTime(game.ended_at)}`);
        if (game.started_at && game.ended_at) parts.push(fmtDuration(game.started_at, game.ended_at) + ' total');
        parts.push(`${totalRounds} round${totalRounds === 1 ? '' : 's'}`);
        if (game.category_filter) parts.push(game.category_filter);
        if (game.auto_host) parts.push('Auto-Host');
        els.meta.textContent = parts.join(' · ');
        document.title = `${game.name || 'Game'} · Recap — Drake Trivia`;
    };

    const renderOtherGames = async () => {
        try {
            const recent = await fetchJSON('/api/games/recent');
            const others = (recent || []).filter(g => g.id !== gameId);
            if (!others.length) {
                els.otherList.innerHTML = '<li class="recap-other-empty">No other recaps yet.</li>';
                return;
            }
            els.otherList.innerHTML = others.map(g => `
                <li>
                    <a href="/recap/${g.id}">
                        <span class="ro-name">${escapeHtml(g.name)}</span>
                        <span class="ro-when">${fmtTime(g.ended_at)}</span>
                    </a>
                </li>
            `).join('');
        } catch (e) {
            els.otherList.innerHTML = '<li class="recap-other-empty">Could not load.</li>';
        }
    };

    const wireReplay = (data) => {
        const btn = document.getElementById('recap-replay-btn');
        if (!btn) return;
        const isSolo = (data.leaderboard || []).length === 1;
        if (!isSolo) { btn.hidden = true; return; }
        btn.hidden = false;
        btn.onclick = async () => {
            const label = btn.querySelector('.recap-replay-label');
            btn.disabled = true;
            if (label) label.textContent = 'Starting…';
            try {
                const team = data.leaderboard[0] || {};
                const body = {
                    team_name: team.team_name,
                    color: team.color || '#ff6b4a',
                    emoji: team.emoji || 'target',
                    category_filter: data.game.category_filter || '',
                    target_question_count: data.game.target_question_count || 10,
                };
                const res = await fetch('/api/solo/start', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify(body),
                });
                const result = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(result.error || 'Could not start a new solo game.');
                window.location.href = result.redirect || '/play';
            } catch (e) {
                btn.disabled = false;
                if (label) label.textContent = 'Play another solo run';
                alert(e.message);
            }
        };
    };

    const init = async () => {
        try {
            const data = await fetchJSON(`/api/games/${gameId}/recap`);
            renderHeader(data.game, (data.rounds || []).length);
            renderStandings(data.leaderboard);
            renderAwards(data.awards);
            renderRounds(data.rounds);
            wireReplay(data);
        } catch (e) {
            const msg = e && e.data && e.data.error ? e.data.error : (e.message || 'Could not load this game.');
            els.title.textContent = 'Recap unavailable';
            els.meta.textContent = msg;
            els.standings.innerHTML = '';
            els.rounds.innerHTML = '';
            els.roundsCount.textContent = '';
        }
        renderOtherGames();
    };

    if (els.toggleAll) {
        els.toggleAll.addEventListener('click', () => {
            const items = els.rounds.querySelectorAll('details');
            const allOpen = [...items].every(d => d.open);
            items.forEach(d => { d.open = !allOpen; });
            els.toggleAll.textContent = allOpen ? 'Expand all' : 'Collapse all';
        });
    }

    init();
})();
