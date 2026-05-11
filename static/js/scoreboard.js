(() => {
    'use strict';
    const { connectSocket, escapeHtml, fetchJSON } = window.dt;

    const stages = {
        waiting: document.getElementById('stage-waiting'),
        asking: document.getElementById('stage-asking'),
        locked: document.getElementById('stage-locked'),
        revealed: document.getElementById('stage-revealed'),
        finale: document.getElementById('stage-finale'),
    };

    const ui = {
        sub: document.getElementById('board-sub'),
        roundNum: document.getElementById('board-round-num'),
        roundOfWrap: document.getElementById('board-round-of'),
        roundTotal: document.getElementById('board-round-total'),
        autohostChip: document.getElementById('board-autohost-chip'),
        phase: document.getElementById('board-phase'),
        statusText: document.getElementById('board-status-text'),

        leaderList: document.getElementById('board-leader-list'),

        category: document.getElementById('board-category'),
        difficulty: document.getElementById('board-difficulty'),
        points: document.getElementById('board-points'),
        qText: document.getElementById('board-question-text'),
        choices: document.getElementById('board-choices'),

        timerWrap: document.getElementById('board-timer-wrap'),
        timerNum: document.getElementById('board-timer-num'),
        timerRing: document.getElementById('board-timer-fg'),
        countDone: document.getElementById('board-count-done'),
        countTotal: document.getElementById('board-count-total'),
        acBar: document.getElementById('ac-bar-fill'),

        revealAnswer: document.getElementById('board-reveal-answer'),
        revealExplanation: document.getElementById('board-reveal-explanation'),
        revealResults: document.getElementById('board-round-results'),

        podium: document.getElementById('finale-podium'),
        awards: document.getElementById('finale-awards-list'),
        conn: document.getElementById('board-conn-status'),
    };

    let currentRound = null;
    let timerInterval = null;
    let lastScores = {};

    const showStage = (key) => {
        Object.entries(stages).forEach(([k, el]) => el.hidden = (k !== key));
    };
    const setConn = (online) => {
        ui.conn.textContent = online ? 'connected' : 'offline';
        ui.conn.classList.toggle('conn-status-off', !online);
    };
    const setPhase = (label) => { if (ui.phase) ui.phase.textContent = label; };

    document.addEventListener('keydown', (e) => {
        if (e.key === 'f' || e.key === 'F') {
            if (document.fullscreenElement) document.exitFullscreen();
            else document.documentElement.requestFullscreen();
        }
    });

    /* Timer ring — circumference 2*pi*54 = 339.29 */
    const TIMER_C = 339.29;
    const stopTimer = () => { if (timerInterval) { clearInterval(timerInterval); timerInterval = null; } };
    const startTimer = (round, limit) => {
        stopTimer();
        if (!round.shown_at) return;
        const shownAt = new Date(round.shown_at).getTime();
        const tick = () => {
            const elapsed = (Date.now() - shownAt) / 1000;
            const remaining = Math.max(0, limit - elapsed);
            ui.timerNum.textContent = Math.ceil(remaining);
            const pct = Math.max(0, remaining / limit);
            ui.timerRing.style.strokeDashoffset = (TIMER_C * (1 - pct)).toFixed(2);
            ui.timerWrap.classList.toggle('warn', remaining <= limit * 0.45 && remaining > limit * 0.2);
            ui.timerWrap.classList.toggle('danger', remaining <= limit * 0.2);
            if (remaining <= 0) stopTimer();
        };
        tick();
        timerInterval = setInterval(tick, 250);
    };

    const renderLeaderboard = (rows) => {
        ui.leaderList.innerHTML = '';
        if (!rows || !rows.length) {
            ui.leaderList.innerHTML = '<li class="standings-empty">Enrollment in progress — awaiting teams…</li>';
            return;
        }
        const leaderScore = rows[0].score;
        rows.forEach(r => {
            const li = document.createElement('li');
            li.style.setProperty('--rank-color', r.color || 'var(--ruby)');
            if (r.score === leaderScore && leaderScore > 0) li.classList.add('is-leader');
            const bump = (lastScores[r.team_id] != null && r.score > lastScores[r.team_id]);
            li.innerHTML = `
                <span class="s-rank">${r.rank}</span>
                <span class="s-emoji" style="color: ${r.color}">${window.dt.icon(r.emoji || 'target', { className: 'icon-2xl' })}</span>
                <span class="s-name" style="color: ${r.color}">${escapeHtml(r.team_name)}</span>
                <span class="s-score ${bump ? 'bump' : ''}">${r.score}</span>
            `;
            ui.leaderList.appendChild(li);
            lastScores[r.team_id] = r.score;
        });
    };

    const updateAnswerBar = () => {
        if (!ui.acBar) return;
        const done = Number(ui.countDone.textContent) || 0;
        const total = Math.max(1, Number(ui.countTotal.textContent) || 1);
        const pct = Math.min(100, Math.round((done / total) * 100));
        ui.acBar.style.width = `${pct}%`;
    };

    const renderAsking = (round, totalTeams) => {
        currentRound = round;
        const q = round.question;
        ui.roundNum.textContent = round.sequence;
        ui.category.textContent = q.category;
        ui.difficulty.textContent = q.difficulty;
        ui.difficulty.dataset.d = q.difficulty;
        ui.points.textContent = `+${q.points}`;
        ui.qText.textContent = q.text;

        ui.choices.innerHTML = '';
        const opts = q.options || (q.type === 'true_false' ? ['True', 'False'] : []);
        opts.forEach((o, i) => {
            const li = document.createElement('li');
            li.innerHTML = `<span class="choice-letter">${String.fromCharCode(65 + i)}</span><span>${escapeHtml(o)}</span>`;
            ui.choices.appendChild(li);
        });

        ui.countDone.textContent = round.answer_count;
        ui.countTotal.textContent = totalTeams || 0;
        updateAnswerBar();
        setPhase('Asking');
        showStage('asking');
        startTimer(round, q.time_limit_s);
    };

    const renderRevealed = (round) => {
        stopTimer();
        const q = round.question;
        const correctStr = String(q.correct_answer || '').split('|')[0];
        ui.revealAnswer.textContent = correctStr;
        if (q.explanation) {
            ui.revealExplanation.textContent = q.explanation;
            ui.revealExplanation.hidden = false;
        } else {
            ui.revealExplanation.hidden = true;
        }

        ui.revealResults.innerHTML = '';
        (round.answers || []).forEach(a => {
            const li = document.createElement('li');
            const correct = a.is_correct;
            const tickIcon = window.dt.icon(correct ? 'check' : 'cross', { className: correct ? 'icon-success' : 'icon-danger' });
            const emblemIcon = window.dt.icon(a.team_emoji || 'target', { color: a.team_color });
            li.innerHTML = `
                <span class="rt-tick">${tickIcon}</span>
                <span class="rt-emoji">${emblemIcon}</span>
                <span class="rt-name">${escapeHtml(a.team_name)}${a.is_first_correct ? '<span class="first-badge">First</span>' : ''}</span>
                <span class="rt-answer">${escapeHtml(a.answer_text || '—')}</span>
                <span class="rt-pts ${correct ? 'correct' : ''}">${correct ? '+' : ''}${a.points_awarded}</span>
            `;
            ui.revealResults.appendChild(li);
        });
        setPhase('Revealed');
        showStage('revealed');
    };

    const renderFinale = (payload) => {
        const lb = payload.leaderboard || [];
        ui.podium.innerHTML = '';
        const slots = [lb.find(r => r.rank === 2), lb.find(r => r.rank === 1), lb.find(r => r.rank === 3)];
        const classes = ['second', 'first', 'third'];
        const placeText = ['SECOND', 'FIRST', 'THIRD'];
        const placeIcon = ['medal', 'trophy', 'medal'];
        const placeIconColor = ['var(--ink-3)', 'var(--mustard)', 'var(--rust)'];
        slots.forEach((team, i) => {
            const div = document.createElement('div');
            div.className = `podium-spot ${classes[i]}`;
            if (!team) {
                div.innerHTML = `<div class="podium-medal-text">—</div><div class="podium-name">—</div>`;
            } else {
                div.innerHTML = `
                    <div class="podium-medal">${window.dt.icon(placeIcon[i], { className: 'icon-2xl', color: placeIconColor[i] })}</div>
                    <div class="podium-place">${placeText[i]}</div>
                    <div class="podium-emoji" style="color: ${team.color}">${window.dt.icon(team.emoji || 'target', { className: 'icon-3xl' })}</div>
                    <div class="podium-name" style="color: ${team.color}">${escapeHtml(team.team_name)}</div>
                    <div class="podium-score">${team.score}</div>
                    <div class="podium-pts">points</div>
                `;
            }
            ui.podium.appendChild(div);
        });

        ui.awards.innerHTML = '';
        (payload.awards || []).forEach(a => {
            const li = document.createElement('li');
            const aSlug = a.icon || 'medal';
            li.innerHTML = `
                <span class="award-emoji">${window.dt.icon(aSlug, { className: 'icon-2xl', color: 'var(--mustard)' })}</span>
                <span>
                    <div class="award-title">${escapeHtml(a.title)}</div>
                    <div class="award-sub">${escapeHtml(a.subtitle || '')}</div>
                </span>
                <span class="award-team" style="color: ${a.team.color}">
                    ${window.dt.icon(a.team.emoji || 'target', { color: a.team.color })}
                    ${escapeHtml(a.team.team_name)}
                </span>
            `;
            ui.awards.appendChild(li);
        });
        setPhase('Finale');
        showStage('finale');
    };

    const renderHeaderChips = (game, round) => {
        if (!game) {
            if (ui.roundOfWrap) ui.roundOfWrap.hidden = true;
            if (ui.autohostChip) ui.autohostChip.hidden = true;
            return;
        }
        // Round "X of N" — only show /N when the host configured a target count
        if (ui.roundOfWrap) {
            if (game.target_question_count) {
                ui.roundOfWrap.hidden = false;
                ui.roundTotal.textContent = game.target_question_count;
            } else {
                ui.roundOfWrap.hidden = true;
            }
        }
        if (ui.autohostChip) ui.autohostChip.hidden = !game.auto_host;
        if (ui.roundNum) {
            ui.roundNum.textContent = round ? round.sequence : (game.rounds_played || 0);
        }
    };

    const handleState = (payload) => {
        if (!payload || !payload.game) {
            setPhase('Standby');
            ui.statusText.textContent = 'No game running.';
            renderLeaderboard([]);
            renderHeaderChips(null, null);
            showStage('waiting');
            return;
        }
        if (payload.game.state === 'ended') return renderFinale(payload);
        const phase = payload.game.phase;
        renderLeaderboard(payload.leaderboard);
        renderHeaderChips(payload.game, payload.round);

        if (!payload.round || phase === 'waiting') {
            setPhase('Standby');
            if (ui.statusText) ui.statusText.textContent = 'The next question is being prepared';
            stopTimer();
            showStage('waiting');
            return;
        }
        if (phase === 'asking') renderAsking(payload.round, payload.total_teams);
        else if (phase === 'locked') { setPhase('Locked'); showStage('locked'); stopTimer(); }
        else if (phase === 'revealed') renderRevealed(payload.round);
    };

    connectSocket({
        connect: () => setConn(true),
        disconnect: () => setConn(false),
        state: handleState,
        question_start: (round) => {
            currentRound = round;
            const totalTeams = Number(ui.countTotal.textContent) || 0;
            renderAsking(round, totalTeams);
        },
        round_locked: () => { setPhase('Locked'); showStage('locked'); stopTimer(); },
        reveal: renderRevealed,
        leaderboard: (p) => renderLeaderboard(p.leaderboard),
        answer_count: (p) => {
            ui.countDone.textContent = p.answer_count;
            ui.countTotal.textContent = p.total_teams;
            updateAnswerBar();
        },
        finale: renderFinale,
    });

    fetchJSON('/api/state').then(handleState).catch(() => {});
})();
