(() => {
    'use strict';
    const { connectSocket, escapeHtml, fetchJSON } = window.dt;

    const states = {
        waiting: document.getElementById('state-waiting'),
        asking: document.getElementById('state-asking'),
        locked: document.getElementById('state-locked'),
        revealed: document.getElementById('state-revealed'),
        finale: document.getElementById('state-finale'),
    };

    const ui = {
        myTeam: document.getElementById('my-team-name'),
        myRankCard: document.getElementById('my-rank-card'),
        rankTile: document.getElementById('rank-tile'),
        myScore: document.getElementById('my-score'),
        myRank: document.getElementById('my-rank'),
        totalTeams: document.getElementById('total-teams'),

        askCategory: document.getElementById('ask-category'),
        askDifficulty: document.getElementById('ask-difficulty'),
        askPoints: document.getElementById('ask-points'),
        askQuestion: document.getElementById('ask-question'),
        askTimerWrap: document.getElementById('ask-timer'),
        timerNum: document.getElementById('timer-num'),
        timerRing: document.getElementById('timer-ring-fg'),

        choicesList: document.getElementById('choices-list'),
        freeTextForm: document.getElementById('free-text-form'),
        freeTextInput: document.getElementById('free-text-input'),
        answerArea: document.getElementById('answer-area'),
        answeredState: document.getElementById('answered-state'),
        lockedAnswerText: document.getElementById('locked-answer-text'),

        revealIcon: document.getElementById('reveal-icon'),
        revealHeadline: document.getElementById('reveal-headline'),
        revealSub: document.getElementById('reveal-sub'),
        revealAnswerPill: document.getElementById('reveal-answer-pill'),
        revealExplanation: document.getElementById('reveal-explanation'),
        revealDelta: document.getElementById('reveal-score-delta'),
        revealTotal: document.getElementById('reveal-score-total'),

        finaleLeader: document.getElementById('finale-leaderboard'),
        conn: document.getElementById('connection-status'),
    };

    let me = null;
    let currentRound = null;
    let mySubmittedAnswer = null;
    let timerInterval = null;
    let lastTotalScore = 0;

    /* ---------- Helpers ---------- */
    const showState = (key) => {
        Object.entries(states).forEach(([k, el]) => { el.hidden = (k !== key); });
    };
    const setConn = (online) => {
        ui.conn.textContent = online ? 'connected' : 'offline';
        ui.conn.classList.toggle('conn-status-off', !online);
    };

    const stopTimer = () => {
        if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    };
    const startTimer = (round, limit) => {
        stopTimer();
        if (!round.shown_at) return;
        const shownAt = new Date(round.shown_at).getTime();
        const total = limit;
        const tick = () => {
            const elapsed = (Date.now() - shownAt) / 1000;
            const remaining = Math.max(0, total - elapsed);
            const intRem = Math.ceil(remaining);
            ui.timerNum.textContent = intRem;
            // Ring: circumference 113.1 = 2*pi*18
            const pct = Math.max(0, remaining / total);
            ui.timerRing.style.strokeDashoffset = (113.1 * (1 - pct)).toFixed(2);
            ui.askTimerWrap.classList.toggle('warn', remaining <= total * 0.4 && remaining > total * 0.2);
            ui.askTimerWrap.classList.toggle('danger', remaining <= total * 0.2);
            if (remaining <= 0) { stopTimer(); }
        };
        tick();
        timerInterval = setInterval(tick, 200);
    };

    const updateMyRankFromLeaderboard = (leaderboard) => {
        if (!me || !me.team_id || !leaderboard || !leaderboard.length) {
            ui.myRankCard.hidden = true;
            return;
        }
        const mine = leaderboard.find(r => r.team_id === me.team_id);
        if (!mine) { ui.myRankCard.hidden = true; return; }
        ui.myRankCard.hidden = false;
        ui.rankTile.textContent = `#${mine.rank}`;
        ui.myScore.textContent = mine.score;
        ui.myRank.textContent = mine.rank;
        ui.totalTeams.textContent = leaderboard.length;
        ui.rankTile.style.background = mine.color
            ? `linear-gradient(135deg, ${mine.color}, ${mine.color}cc)`
            : 'linear-gradient(135deg, var(--brand), var(--brand-2))';
        lastTotalScore = mine.score;
    };

    /* ---------- Renderers per phase ---------- */
    const renderAsking = (round) => {
        currentRound = round;
        mySubmittedAnswer = null;
        const q = round.question;
        ui.askCategory.textContent = q.category;
        ui.askDifficulty.textContent = q.difficulty;
        ui.askDifficulty.dataset.d = q.difficulty;
        ui.askPoints.textContent = `+${q.points}`;
        ui.askQuestion.textContent = q.text;

        ui.choicesList.innerHTML = '';
        ui.freeTextForm.hidden = true;
        ui.answerArea.hidden = false;
        ui.answeredState.hidden = true;

        if (q.type === 'multiple_choice' || q.type === 'true_false') {
            const opts = q.options || (q.type === 'true_false' ? ['True', 'False'] : []);
            opts.forEach((o, i) => {
                const li = document.createElement('li');
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'choice-btn';
                btn.innerHTML = `<span class="choice-letter">${String.fromCharCode(65 + i)}</span><span>${escapeHtml(o)}</span>`;
                btn.addEventListener('click', () => submitAnswer(o, btn));
                li.appendChild(btn);
                ui.choicesList.appendChild(li);
            });
        } else {
            ui.freeTextForm.hidden = false;
            ui.freeTextInput.value = '';
            ui.freeTextInput.disabled = false;
            setTimeout(() => ui.freeTextInput.focus(), 100);
        }

        showState('asking');
        startTimer(round, q.time_limit_s);
    };

    const renderLocked = () => {
        stopTimer();
        if (mySubmittedAnswer != null) {
            // Player already answered — keep their card, just dim it via the locked state
            showState('locked');
        } else {
            showState('locked');
        }
    };

    const renderRevealed = (round) => {
        stopTimer();
        const q = round.question;
        // Find my answer
        const myAns = (round.answers || []).find(a => a.team_id === (me && me.team_id));
        const correctAnswerStr = String(q.correct_answer || '').split('|')[0];
        ui.revealAnswerPill.textContent = correctAnswerStr;
        if (q.explanation) {
            ui.revealExplanation.textContent = q.explanation;
            ui.revealExplanation.hidden = false;
        } else {
            ui.revealExplanation.hidden = true;
        }

        if (!myAns) {
            ui.revealIcon.textContent = '—';
            ui.revealIcon.className = 'reveal-icon';
            ui.revealHeadline.textContent = 'No answer recorded';
            ui.revealSub.textContent = "You didn't submit in time.";
            ui.revealDelta.textContent = '+0';
            ui.revealDelta.classList.add('zero');
        } else if (myAns.is_correct) {
            ui.revealIcon.textContent = '✓';
            ui.revealIcon.className = 'reveal-icon correct';
            ui.revealHeadline.textContent = myAns.is_first_correct ? "First & correct!" : 'Correct!';
            ui.revealSub.textContent = myAns.is_first_correct
                ? "+3 bonus for being fastest"
                : "Nice one";
            ui.revealDelta.textContent = `+${myAns.points_awarded}`;
            ui.revealDelta.classList.remove('zero');
            playSfx('correct');
        } else {
            ui.revealIcon.textContent = '✗';
            ui.revealIcon.className = 'reveal-icon wrong';
            ui.revealHeadline.textContent = 'Not quite';
            ui.revealSub.textContent = `You said: ${escapeHtml(myAns.answer_text || '—')}`;
            ui.revealDelta.textContent = '+0';
            ui.revealDelta.classList.add('zero');
            playSfx('wrong');
        }
        ui.revealTotal.textContent = lastTotalScore;
        showState('revealed');
    };

    const renderFinale = (payload) => {
        ui.finaleLeader.innerHTML = '';
        (payload.leaderboard || []).forEach(r => {
            const li = document.createElement('li');
            if (me && r.team_id === me.team_id) li.classList.add('is-me');
            li.innerHTML = `
                <span class="leaderboard-rank">#${r.rank}</span>
                <span class="leaderboard-emoji">${escapeHtml(r.emoji || '🎯')}</span>
                <span class="leaderboard-name">${escapeHtml(r.team_name)}</span>
                <span class="leaderboard-score">${r.score}</span>
            `;
            ui.finaleLeader.appendChild(li);
        });
        showState('finale');
    };

    /* ---------- Answer submission ---------- */
    const submitAnswer = (text, btnEl) => {
        if (!currentRound) return;
        mySubmittedAnswer = text;
        sock.emit('submit_answer', { answer: text, round_id: currentRound.round_id });
        // Optimistic UI
        if (btnEl) {
            [...ui.choicesList.querySelectorAll('.choice-btn')].forEach(b => {
                b.disabled = true;
                if (b !== btnEl) b.style.opacity = 0.4;
                else b.classList.add('selected');
            });
        }
        ui.lockedAnswerText.textContent = text;
        ui.answeredState.hidden = false;
        ui.freeTextInput.disabled = true;
    };

    ui.freeTextForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const v = ui.freeTextInput.value.trim();
        if (!v) return;
        submitAnswer(v, null);
    });

    /* ---------- Audio (tiny synthesized SFX) ---------- */
    let audioCtx = null;
    const playSfx = (kind) => {
        try {
            audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
            const t = audioCtx.currentTime;
            const o = audioCtx.createOscillator();
            const g = audioCtx.createGain();
            o.connect(g); g.connect(audioCtx.destination);
            g.gain.setValueAtTime(0.001, t);
            if (kind === 'correct') {
                o.type = 'sine';
                o.frequency.setValueAtTime(880, t);
                o.frequency.exponentialRampToValueAtTime(1320, t + 0.15);
                g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
                g.gain.exponentialRampToValueAtTime(0.0005, t + 0.4);
                o.start(t); o.stop(t + 0.4);
            } else {
                o.type = 'sawtooth';
                o.frequency.setValueAtTime(220, t);
                o.frequency.exponentialRampToValueAtTime(110, t + 0.2);
                g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
                g.gain.exponentialRampToValueAtTime(0.0005, t + 0.3);
                o.start(t); o.stop(t + 0.3);
            }
        } catch (e) { /* audio disabled */ }
    };

    /* ---------- Socket plumbing ---------- */
    const handleState = (payload) => {
        if (payload && payload.me) me = payload.me;
        if (!payload || !payload.game) {
            ui.myRankCard.hidden = true;
            showState('waiting');
            return;
        }
        updateMyRankFromLeaderboard(payload.leaderboard);
        if (payload.game.state === 'ended') return renderFinale(payload);

        const phase = payload.game.phase;
        const round = payload.round;
        if (phase === 'waiting' || !round) { showState('waiting'); stopTimer(); return; }
        if (phase === 'asking') {
            // Only re-render if this is a different round than current
            if (!currentRound || round.round_id !== currentRound.round_id) renderAsking(round);
            else {
                // Same round, maybe reconnected — keep UI but ensure timer is alive
                startTimer(round, round.question.time_limit_s);
            }
            return;
        }
        if (phase === 'locked') { renderLocked(); return; }
        if (phase === 'revealed') { renderRevealed(round); return; }
    };

    const sock = connectSocket({
        connect: () => setConn(true),
        disconnect: () => setConn(false),
        state: handleState,
        question_start: (payload) => {
            currentRound = null; // force re-render
            handleState({ game: { state: 'active', phase: 'asking' }, round: payload, me });
        },
        round_locked: () => renderLocked(),
        reveal: (round) => renderRevealed(round),
        leaderboard: (payload) => updateMyRankFromLeaderboard(payload.leaderboard),
        finale: renderFinale,
        answer_accepted: (data) => {
            ui.lockedAnswerText.textContent = mySubmittedAnswer ?? '(submitted)';
            ui.answeredState.hidden = false;
        },
        error: (e) => console.warn('socket error:', e),
    });

    /* ---------- Bootstrap from /api/state in case socket lags ---------- */
    fetchJSON('/api/state').then(handleState).catch(() => {});
})();
