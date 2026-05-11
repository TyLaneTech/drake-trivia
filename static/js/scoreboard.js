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
        gameName: document.getElementById('board-game-name'),
        sub: document.getElementById('board-sub'),
        roundNum: document.getElementById('board-round-num'),

        leaderList: document.getElementById('board-leader-list'),
        statusText: document.getElementById('board-status-text'),

        boardSide: document.querySelector('.board-side'),
        category: document.getElementById('board-category'),
        difficulty: document.getElementById('board-difficulty'),
        points: document.getElementById('board-points'),
        qText: document.getElementById('board-question-text'),
        choices: document.getElementById('board-choices'),
        timerNum: document.getElementById('board-timer-num'),
        timerRing: document.getElementById('board-timer-fg'),
        countDone: document.getElementById('board-count-done'),
        countTotal: document.getElementById('board-count-total'),

        revealAnswer: document.getElementById('board-reveal-answer'),
        revealExplanation: document.getElementById('board-reveal-explanation'),
        revealResults: document.getElementById('board-round-results'),

        podium: document.getElementById('finale-podium'),
        awards: document.getElementById('finale-awards-list'),
        conn: document.getElementById('board-conn-status'),
    };

    let currentRound = null;
    let timerInterval = null;
    let lastScores = {}; // team_id -> score, for bump animation

    const showStage = (key) => {
        Object.entries(stages).forEach(([k, el]) => el.hidden = (k !== key));
    };
    const setConn = (online) => {
        ui.conn.textContent = online ? 'connected' : 'offline';
        ui.conn.classList.toggle('conn-status-off', !online);
    };

    /* -------- Fullscreen + mute shortcuts -------- */
    document.addEventListener('keydown', (e) => {
        if (e.key === 'f' || e.key === 'F') {
            if (document.fullscreenElement) document.exitFullscreen();
            else document.documentElement.requestFullscreen();
        }
        if (e.key === 'm' || e.key === 'M') {
            window.boardMuted = !window.boardMuted;
        }
    });

    /* -------- Timer ring (R=46, circumference = 2πr ≈ 289.03) -------- */
    const TIMER_C = 289.03;
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
            ui.boardSide.classList.toggle('warn', remaining <= limit * 0.4 && remaining > limit * 0.2);
            ui.boardSide.classList.toggle('danger', remaining <= limit * 0.2);
            if (remaining <= 0) stopTimer();
        };
        tick();
        timerInterval = setInterval(tick, 250);
    };

    /* -------- Renderers -------- */
    const renderLeaderboard = (rows) => {
        ui.leaderList.innerHTML = '';
        if (!rows || !rows.length) {
            ui.leaderList.innerHTML = '<li class="board-leader-empty">Awaiting teams…</li>';
            return;
        }
        const leaderScore = rows[0].score;
        rows.forEach(r => {
            const li = document.createElement('li');
            if (r.score === leaderScore && leaderScore > 0) li.classList.add('is-leader');
            li.style.borderLeftColor = r.color || 'var(--brand)';
            const bump = (lastScores[r.team_id] != null && r.score > lastScores[r.team_id]);
            li.innerHTML = `
                <span class="board-leader-rank">${r.rank}</span>
                <span class="board-leader-emoji">${escapeHtml(r.emoji || '🎯')}</span>
                <span class="board-leader-name">${escapeHtml(r.team_name)}</span>
                <span class="board-leader-score ${bump ? 'bump' : ''}">${r.score}</span>
            `;
            ui.leaderList.appendChild(li);
            lastScores[r.team_id] = r.score;
        });
    };

    const renderAsking = (round, totalTeams) => {
        currentRound = round;
        const q = round.question;
        ui.category.textContent = q.category;
        ui.difficulty.textContent = q.difficulty;
        ui.difficulty.dataset.d = q.difficulty;
        ui.points.textContent = `+${q.points}`;
        ui.qText.textContent = q.text;
        ui.roundNum.textContent = round.sequence;

        ui.choices.innerHTML = '';
        const opts = q.options || (q.type === 'true_false' ? ['True', 'False'] : []);
        opts.forEach((o, i) => {
            const li = document.createElement('li');
            li.innerHTML = `<span class="choice-letter">${String.fromCharCode(65 + i)}</span><span>${escapeHtml(o)}</span>`;
            ui.choices.appendChild(li);
        });

        ui.countDone.textContent = round.answer_count;
        ui.countTotal.textContent = totalTeams || 0;
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
            li.innerHTML = `
                <span class="result-status">${correct ? '✓' : '✗'}</span>
                <span class="result-emoji">${escapeHtml(a.team_emoji || '🎯')}</span>
                <span class="result-name">${escapeHtml(a.team_name)}${a.is_first_correct ? '<span class="first-badge">First</span>' : ''}</span>
                <span class="result-answer">${escapeHtml(a.answer_text || '—')}</span>
                <span class="result-points ${correct ? 'correct' : 'zero'}">${correct ? '+' : ''}${a.points_awarded}</span>
            `;
            ui.revealResults.appendChild(li);
        });
        showStage('revealed');
    };

    const renderFinale = (payload) => {
        const lb = payload.leaderboard || [];
        // Podium: 1st (center), 2nd (left), 3rd (right)
        ui.podium.innerHTML = '';
        const medals = ['🥇', '🥈', '🥉'];
        const slots = [
            lb.find(r => r.rank === 2),
            lb.find(r => r.rank === 1),
            lb.find(r => r.rank === 3),
        ];
        const classes = ['second', 'first', 'third'];
        const medalIdx = [1, 0, 2];
        slots.forEach((team, i) => {
            const div = document.createElement('div');
            div.className = `podium-spot ${classes[i]}`;
            if (!team) {
                div.innerHTML = `<div class="podium-medal">—</div><div class="podium-name">—</div>`;
            } else {
                div.innerHTML = `
                    <div class="podium-medal">${medals[medalIdx[i]]}</div>
                    <div class="podium-emoji">${escapeHtml(team.emoji || '🎯')}</div>
                    <div class="podium-name" style="color: ${team.color}">${escapeHtml(team.team_name)}</div>
                    <div class="podium-score">${team.score} pts</div>
                `;
            }
            ui.podium.appendChild(div);
        });
        // Awards
        ui.awards.innerHTML = '';
        (payload.awards || []).forEach(a => {
            const li = document.createElement('li');
            li.innerHTML = `
                <span class="award-emoji">${a.emoji || '🏅'}</span>
                <span>
                    <div class="award-title">${escapeHtml(a.title)}</div>
                    <div class="award-sub">${escapeHtml(a.subtitle || '')}</div>
                </span>
                <span class="award-team" style="color: ${a.team.color}">${escapeHtml(a.team.emoji || '')} ${escapeHtml(a.team.team_name)}</span>
            `;
            ui.awards.appendChild(li);
        });
        showStage('finale');
    };

    /* -------- State router -------- */
    const handleState = (payload) => {
        if (!payload || !payload.game) {
            ui.sub.textContent = 'No game running.';
            renderLeaderboard([]);
            showStage('waiting');
            return;
        }
        ui.gameName.textContent = payload.game.name || 'Drake Trivia';
        if (payload.game.state === 'ended') return renderFinale(payload);
        const phase = payload.game.phase;
        renderLeaderboard(payload.leaderboard);

        if (!payload.round || phase === 'waiting') {
            ui.sub.textContent = 'Standby for the next question…';
            ui.statusText.textContent = 'Next question coming up…';
            showStage('waiting');
            stopTimer();
            return;
        }
        ui.sub.textContent = `Round ${payload.round.sequence} · ${payload.round.question.category}`;
        ui.roundNum.textContent = payload.round.sequence;
        if (phase === 'asking') renderAsking(payload.round, payload.total_teams);
        else if (phase === 'locked') showStage('locked');
        else if (phase === 'revealed') renderRevealed(payload.round);
    };

    const sock = connectSocket({
        connect: () => setConn(true),
        disconnect: () => setConn(false),
        state: handleState,
        question_start: (round) => {
            currentRound = round;
            const totalTeams = Number(ui.countTotal.textContent) || 0;
            renderAsking(round, totalTeams);
        },
        round_locked: () => showStage('locked'),
        reveal: renderRevealed,
        leaderboard: (p) => renderLeaderboard(p.leaderboard),
        answer_count: (p) => {
            ui.countDone.textContent = p.answer_count;
            ui.countTotal.textContent = p.total_teams;
        },
        finale: renderFinale,
    });

    fetchJSON('/api/state').then(handleState).catch(() => {});
})();
