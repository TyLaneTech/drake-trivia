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
        totalTeams: document.getElementById('total-teams'),

        standingsStrip: document.getElementById('standings-strip'),
        stripEmblem: document.getElementById('strip-emblem'),
        stripName: document.getElementById('strip-name'),
        stripRank: document.getElementById('strip-rank'),
        stripScore: document.getElementById('strip-score'),
        stripTotal: document.getElementById('strip-total'),

        roundOfStrip: document.getElementById('round-of-strip'),
        roundOfNow: document.getElementById('round-of-now'),
        roundOfTotal: document.getElementById('round-of-total'),

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

        subTracker: document.getElementById('submissions-tracker'),
        subList: document.getElementById('sub-track-list'),
        subCount: document.getElementById('sub-track-count'),

        readyBlock: document.getElementById('ready-block'),
        btnReady: document.getElementById('btn-ready'),
        readyConfirmed: document.getElementById('ready-confirmed'),
        readyWaiting: document.getElementById('ready-waiting'),
        readyWaitingList: document.getElementById('ready-waiting-list'),
        readyCountdown: document.getElementById('ready-countdown'),
        readyCountdownNum: document.getElementById('ready-countdown-num'),

        finaleLeader: document.getElementById('finale-leaderboard'),
        conn: document.getElementById('connection-status'),
    };

    let me = null;
    let currentRound = null;
    let currentGame = null;
    let mySubmittedAnswer = null;
    let timerInterval = null;
    let lastTotalScore = 0;
    let myReadyRoundId = null;
    let readyCountdownInterval = null;
    let cachedTeams = [];           // last leaderboard — used to render the submissions tracker
    let submittedSet = new Set();    // round-scoped: team_ids that have submitted

    /* ---------- Helpers ---------- */
    const showState = (key) => {
        Object.entries(states).forEach(([k, el]) => { el.hidden = (k !== key); });
        // Standings strip is visible during in-game phases only — the waiting
        // card already shows a bigger version, and finale gets the leaderboard.
        if (ui.standingsStrip) {
            ui.standingsStrip.hidden = !(key === 'asking' || key === 'locked' || key === 'revealed');
        }
        // Submissions tracker visibility depends on the active phase, refresh
        // whenever the visible card changes.
        renderSubmissionsTracker();
    };
    const setConn = (online) => {
        ui.conn.textContent = online ? 'connected' : 'offline';
        ui.conn.classList.toggle('conn-status-off', !online);
    };

    const stopTimer = () => {
        if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    };
    const TIMER_C = 131.95;  // 2 * pi * r where r=21
    const startTimer = (round, limit) => {
        stopTimer();
        if (!round.shown_at) return;
        const shownAt = new Date(round.shown_at).getTime();
        const total = limit;
        const tick = () => {
            const elapsed = (Date.now() - shownAt) / 1000;
            const remaining = Math.max(0, total - elapsed);
            ui.timerNum.textContent = Math.ceil(remaining);
            const pct = Math.max(0, remaining / total);
            ui.timerRing.style.strokeDashoffset = (TIMER_C * (1 - pct)).toFixed(2);
            ui.askTimerWrap.classList.toggle('warn', remaining <= total * 0.45 && remaining > total * 0.2);
            ui.askTimerWrap.classList.toggle('danger', remaining <= total * 0.2);
            if (remaining <= 0) stopTimer();
        };
        tick();
        timerInterval = setInterval(tick, 200);
    };

    const updateMyRankFromLeaderboard = (leaderboard) => {
        if (leaderboard && leaderboard.length) cachedTeams = leaderboard;
        if (!me || !me.team_id || !leaderboard || !leaderboard.length) {
            ui.myRankCard.hidden = true;
            ui.stripName.textContent = (me && me.team_name) || '';
            ui.stripRank.textContent = '—';
            ui.stripScore.textContent = '0';
            ui.stripTotal.textContent = '—';
            renderSubmissionsTracker();
            return;
        }
        const mine = leaderboard.find(r => r.team_id === me.team_id);
        if (!mine) {
            ui.myRankCard.hidden = true;
            return;
        }
        ui.myRankCard.hidden = false;
        ui.rankTile.textContent = mine.rank;
        ui.myScore.textContent = mine.score;
        ui.totalTeams.textContent = leaderboard.length;
        lastTotalScore = mine.score;
        // Always-on strip mirrors these numbers
        ui.stripName.textContent = mine.team_name;
        ui.stripRank.textContent = mine.rank;
        ui.stripScore.textContent = mine.score;
        ui.stripTotal.textContent = leaderboard.length;
        ui.stripEmblem.style.color = mine.color || 'var(--accent)';
        ui.stripEmblem.innerHTML = `<svg class="icon"><use href="/static/images/sprite.svg#i-${mine.emoji || 'target'}"/></svg>`;
        renderSubmissionsTracker();
    };

    const renderSubmissionsTracker = () => {
        if (!ui.subTracker) return;
        // Multi-team only. Show during asking + locked. Hide elsewhere.
        const visiblePhase = Object.entries(states).find(([, el]) => !el.hidden);
        const phaseKey = visiblePhase ? visiblePhase[0] : null;
        const showOnPhase = phaseKey === 'asking' || phaseKey === 'locked';
        const teams = cachedTeams || [];
        if (!showOnPhase || teams.length < 2) {
            ui.subTracker.hidden = true;
            return;
        }
        ui.subTracker.hidden = false;
        ui.subCount.textContent = `${submittedSet.size}/${teams.length}`;
        // Order: submitted first, then pending (stable name order within each).
        const sorted = [...teams].sort((a, b) => {
            const aS = submittedSet.has(a.team_id) ? 0 : 1;
            const bS = submittedSet.has(b.team_id) ? 0 : 1;
            if (aS !== bS) return aS - bS;
            return (a.team_name || '').localeCompare(b.team_name || '');
        });
        ui.subList.innerHTML = sorted.map(t => {
            const submitted = submittedSet.has(t.team_id);
            const isMe = me && me.team_id === t.team_id;
            return `
                <li class="sub-chip ${submitted ? 'is-in' : 'is-pending'}${isMe ? ' is-me' : ''}"
                    style="--team-color: ${t.color || 'var(--accent)'};"
                    title="${escapeHtml(t.team_name)}${submitted ? ' — submitted' : ''}">
                    <span class="sub-chip-emblem">${window.dt.icon(t.emoji || 'target')}</span>
                    <span class="sub-chip-name">${escapeHtml(t.team_name)}</span>
                    ${submitted ? '<span class="sub-chip-check">' + window.dt.icon('check') + '</span>' : ''}
                </li>
            `;
        }).join('');
    };

    const renderRoundOf = () => {
        if (!currentGame || !currentGame.target_question_count) {
            ui.roundOfStrip.hidden = true;
            return;
        }
        ui.roundOfStrip.hidden = false;
        const seq = currentRound ? currentRound.sequence : (currentGame.rounds_played || 0) + 1;
        ui.roundOfNow.textContent = seq;
        ui.roundOfTotal.textContent = currentGame.target_question_count;
    };

    const stopReadyCountdown = () => {
        if (readyCountdownInterval) { clearInterval(readyCountdownInterval); readyCountdownInterval = null; }
        ui.readyCountdown.hidden = true;
    };

    const renderReadyBlock = (round, pending) => {
        // Only show during reveal in auto-host mode.
        if (!currentGame || !currentGame.auto_host || !round || round.phase !== 'revealed') {
            ui.readyBlock.hidden = true;
            stopReadyCountdown();
            return;
        }
        ui.readyBlock.hidden = false;
        const myTeamId = me && me.team_id;
        // Trust the local "I clicked ready for THIS round" signal — the pending
        // list from the server can be empty momentarily before the state event
        // arrives, and we don't want to falsely declare ourselves ready.
        const iAmReady = myReadyRoundId === round.round_id;
        if (iAmReady) {
            ui.btnReady.hidden = true;
            ui.readyConfirmed.hidden = false;
        } else {
            ui.btnReady.hidden = false;
            ui.btnReady.disabled = false;
            ui.readyConfirmed.hidden = true;
        }
        // Waiting-on list — every team still pending, excluding me.
        const others = (pending || []).filter(p => p.team_id !== myTeamId);
        if (others.length) {
            ui.readyWaiting.hidden = false;
            ui.readyWaitingList.innerHTML = others.map(p => `
                <li>
                    <span class="ready-team-icon" style="color: ${p.color || 'var(--accent)'}">${window.dt.icon(p.emoji || 'target')}</span>
                    <span class="ready-team-name">${escapeHtml(p.team_name)}</span>
                </li>
            `).join('');
        } else {
            ui.readyWaiting.hidden = true;
            ui.readyWaitingList.innerHTML = '';
        }
        // Countdown if the host configured an auto_next_delay
        const delay = currentGame.auto_next_delay_s;
        if (delay && round.revealed_at) {
            const revealedAt = new Date(round.revealed_at).getTime();
            const tick = () => {
                const remaining = Math.max(0, Math.ceil(delay - (Date.now() - revealedAt) / 1000));
                ui.readyCountdownNum.textContent = `${remaining}s`;
                if (remaining <= 0) stopReadyCountdown();
            };
            stopReadyCountdown();
            ui.readyCountdown.hidden = false;
            tick();
            readyCountdownInterval = setInterval(tick, 250);
        } else {
            stopReadyCountdown();
        }
    };

    if (ui.btnReady) {
        ui.btnReady.addEventListener('click', () => {
            if (!currentRound) return;
            myReadyRoundId = currentRound.round_id;
            ui.btnReady.disabled = true;
            ui.btnReady.hidden = true;
            ui.readyConfirmed.hidden = false;
            sock.emit('team_ready', { round_id: currentRound.round_id });
        });
    }

    /* ---------- Renderers per phase ---------- */
    const renderAsking = (round) => {
        currentRound = round;
        mySubmittedAnswer = null;
        // New round → reset ready state and any reveal countdown
        myReadyRoundId = null;
        // Reset submissions tracker for the new round, seed from the round
        // payload so reconnecting mid-round still shows accurate state.
        submittedSet = new Set(round.submitted_team_ids || []);
        ui.readyBlock.hidden = true;
        stopReadyCountdown();
        renderRoundOf();
        const q = round.question;
        ui.askCategory.textContent = q.category;
        ui.askDifficulty.textContent = q.difficulty;
        ui.askDifficulty.dataset.d = q.difficulty;
        ui.askPoints.textContent = `+${q.points}`;
        ui.askQuestion.textContent = q.text;

        // Reset both answer surfaces every round
        ui.choicesList.innerHTML = '';
        ui.freeTextInput.value = '';
        ui.freeTextInput.disabled = false;
        ui.freeTextForm.hidden = true;
        ui.answerArea.hidden = false;
        ui.answeredState.hidden = true;
        ui.lockedAnswerText.textContent = '';

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
            setTimeout(() => ui.freeTextInput.focus(), 100);
        }

        showState('asking');
        renderSubmissionsTracker();
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

    const renderRevealed = (round, pending) => {
        stopTimer();
        currentRound = round;
        const q = round.question;
        const myAns = (round.answers || []).find(a => a.team_id === (me && me.team_id));
        const correctAnswerStr = String(q.correct_answer || '').split('|')[0];
        ui.revealAnswerPill.textContent = correctAnswerStr;
        if (q.explanation) {
            ui.revealExplanation.textContent = q.explanation;
            ui.revealExplanation.hidden = false;
        } else {
            ui.revealExplanation.hidden = true;
        }

        const banner = document.getElementById('reveal-banner');
        banner.classList.remove('correct', 'wrong');
        const iconHTML = (slug) => `<svg class="icon icon-lg"><use href="/static/images/sprite.svg#i-${slug}"/></svg>`;

        if (!myAns) {
            ui.revealIcon.innerHTML = iconHTML('hourglass');
            ui.revealHeadline.textContent = 'No answer recorded';
            ui.revealSub.textContent = "You didn't submit in time.";
            ui.revealDelta.textContent = '+0';
            ui.revealDelta.classList.add('zero');
        } else if (myAns.is_correct) {
            ui.revealIcon.innerHTML = iconHTML('check');
            banner.classList.add('correct');
            ui.revealHeadline.textContent = myAns.is_first_correct ? "First & correct!" : 'Correct!';
            ui.revealSub.textContent = myAns.is_first_correct
                ? "+3 bonus for being fastest"
                : "Well played.";
            ui.revealDelta.textContent = `+${myAns.points_awarded}`;
            ui.revealDelta.classList.remove('zero');
            playSfx('correct');
        } else {
            ui.revealIcon.innerHTML = iconHTML('cross');
            banner.classList.add('wrong');
            ui.revealHeadline.textContent = 'Not quite';
            ui.revealSub.textContent = `You said: ${escapeHtml(myAns.answer_text || '—')}`;
            ui.revealDelta.textContent = '+0';
            ui.revealDelta.classList.add('zero');
            playSfx('wrong');
        }
        ui.revealTotal.textContent = lastTotalScore;
        showState('revealed');
        renderReadyBlock(round, pending);
    };

    const renderFinale = (payload) => {
        ui.finaleLeader.innerHTML = '';
        (payload.leaderboard || []).forEach(r => {
            const li = document.createElement('li');
            if (me && r.team_id === me.team_id) li.classList.add('is-me');
            li.innerHTML = `
                <span class="ml-rank">${r.rank}</span>
                <span class="ml-emoji" style="color: ${r.color}">${window.dt.icon(r.emoji || 'target')}</span>
                <span class="ml-name">${escapeHtml(r.team_name)}</span>
                <span class="ml-score">${r.score}</span>
            `;
            ui.finaleLeader.appendChild(li);
        });
        const recapLink = document.getElementById('finale-recap-link');
        if (recapLink && payload.game_id) recapLink.href = `/recap/${payload.game_id}`;

        // One-tap "play again" — only sensible for solo games (single team).
        const replayBtn = document.getElementById('finale-replay-btn');
        const isSolo = (payload.leaderboard || []).length === 1;
        if (replayBtn) {
            const eligible = isSolo && payload.game_id != null;
            replayBtn.hidden = !eligible;
            if (eligible) {
                replayBtn.onclick = () => restartSolo(payload.game_id, replayBtn);
            }
        }
        showState('finale');
    };

    const restartSolo = async (prevGameId, btn) => {
        const label = btn.querySelector('.finale-replay-label');
        btn.disabled = true;
        if (label) label.textContent = 'Starting…';
        try {
            const recap = await fetchJSON(`/api/games/${prevGameId}/recap`);
            const team = (recap.leaderboard || [])[0] || {};
            const body = {
                team_name: team.team_name || (me && me.team_name) || '',
                color: team.color || (me && me.team_color) || '#ff6b4a',
                emoji: team.emoji || (me && me.team_emoji) || 'target',
                category_filter: recap.game.category_filter || '',
                target_question_count: recap.game.target_question_count || 10,
            };
            const res = await fetch('/api/solo/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify(body),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Could not start a new solo game.');
            window.location.href = data.redirect || '/play';
        } catch (e) {
            btn.disabled = false;
            if (label) label.textContent = 'Start another solo run';
            alert(e.message);
        }
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
            currentGame = null;
            ui.roundOfStrip.hidden = true;
            showState('waiting');
            return;
        }
        currentGame = payload.game;
        updateMyRankFromLeaderboard(payload.leaderboard);
        if (payload.game.state === 'ended') return renderFinale(payload);

        const phase = payload.game.phase;
        const round = payload.round;
        if (phase === 'waiting' || !round) { showState('waiting'); stopTimer(); ui.roundOfStrip.hidden = !(currentGame && currentGame.target_question_count); renderRoundOf(); return; }
        // Track which DOM state we're showing so we can detect phase changes
        // even when the round_id stays the same.
        const visibleState = Object.entries(states).find(([, el]) => !el.hidden);
        const visiblePhase = visibleState ? visibleState[0] : null;

        if (phase === 'asking') {
            // Re-render if this is a new round, OR if we're not currently
            // showing the asking screen (covers transitions from revealed →
            // asking when a fresh round starts under the same client).
            if (!currentRound || round.round_id !== currentRound.round_id || visiblePhase !== 'asking') {
                renderAsking(round);
            } else {
                renderRoundOf();
                startTimer(round, round.question.time_limit_s);
            }
            return;
        }
        if (phase === 'locked') { renderLocked(); return; }
        if (phase === 'revealed') { renderRevealed(round, payload.pending_ready); return; }
    };

    const sock = connectSocket({
        connect: () => setConn(true),
        disconnect: () => setConn(false),
        state: handleState,
        question_start: (round) => {
            // A new question started — own the phase transition here so we
            // don't accidentally route through the stale currentGame.phase
            // (that would render the new round as a broken "revealed" view).
            if (currentGame) currentGame.phase = 'asking';
            currentRound = null;
            renderAsking(round);
        },
        round_locked: () => {
            if (currentGame) currentGame.phase = 'locked';
            renderLocked();
        },
        reveal: (round) => {
            if (currentGame) currentGame.phase = 'revealed';
            renderRevealed(round, []);
        },
        ready_update: (data) => {
            // Re-render the waiting list / counted state if we're on the reveal screen.
            if (!currentRound || currentRound.round_id !== data.round_id) return;
            renderReadyBlock(currentRound, data.pending || []);
        },
        ready_accepted: (data) => {
            myReadyRoundId = data.round_id;
        },
        leaderboard: (payload) => updateMyRankFromLeaderboard(payload.leaderboard),
        finale: renderFinale,
        answer_accepted: (data) => {
            ui.lockedAnswerText.textContent = mySubmittedAnswer ?? '(submitted)';
            ui.answeredState.hidden = false;
            if (me && me.team_id != null) {
                submittedSet.add(me.team_id);
                renderSubmissionsTracker();
            }
        },
        answer_count: (data) => {
            if (!currentRound || data.round_id !== currentRound.round_id) return;
            submittedSet = new Set(data.submitted_team_ids || []);
            renderSubmissionsTracker();
        },
        error: (e) => console.warn('socket error:', e),
    });

    /* ---------- Bootstrap from /api/state in case socket lags ---------- */
    fetchJSON('/api/state').then(handleState).catch(() => {});
})();
