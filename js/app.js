/**
 * Croatia Amazing Race — UI application
 */
(function () {
  const SESSION_KEY = "race_session_v1";
  const cfg = () => window.RACE_CONFIG || {};

  let session = null;
  let tickTimer = null;
  let countdownTimer = null;
  let uiState = { loginTab: "team", adminTab: "manage" };

  function loadSession() {
    try {
      return JSON.parse(sessionStorage.getItem(SESSION_KEY));
    } catch {
      return null;
    }
  }

  function saveSession(s) {
    session = s;
    if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else sessionStorage.removeItem(SESSION_KEY);
  }

  function toast(msg, type) {
    const root = document.getElementById("toast-root");
    const el = document.createElement("div");
    el.className = "toast" + (type === "error" ? " toast--error" : "");
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  function openModal(title, bodyHtml, actionsHtml) {
    const root = document.getElementById("modal-root");
    root.innerHTML = `
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal" role="dialog">
          <h2>${title}</h2>
          <div class="modal-body">${bodyHtml}</div>
          <div class="modal-actions" style="margin-top:1rem;display:flex;gap:0.5rem;flex-wrap:wrap">${actionsHtml || ""}</div>
        </div>
      </div>`;
    root.querySelector("#modal-overlay")?.addEventListener("click", (e) => {
      if (e.target.id === "modal-overlay") closeModal();
    });
  }

  function closeModal() {
    document.getElementById("modal-root").innerHTML = "";
  }

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s ?? "";
    return d.innerHTML;
  }

  function formatDate(ts) {
    if (!ts) return "—";
    const d = new Date(ts);
    const date = d.toLocaleDateString(undefined, { dateStyle: "medium" });
    const hour = String(d.getHours()).padStart(2, "0");
    return `${date}, ${hour}:00`;
  }

  function toInputDate(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function toInputHour(ts) {
    if (!ts) return "";
    return String(new Date(ts).getHours());
  }

  function renderHourOptions(selected) {
    const h = selected === "" || selected == null ? "" : Number(selected);
    return Array.from({ length: 24 }, (_, i) => {
      const label = `${String(i).padStart(2, "0")}:00`;
      return `<option value="${i}"${h === i ? " selected" : ""}>${label}</option>`;
    }).join("");
  }

  function readScheduleFromForm() {
    const startDate = document.getElementById("race-start-date")?.value;
    const startHour = document.getElementById("race-start-hour")?.value;
    const endDate = document.getElementById("race-end-date")?.value;
    const endHour = document.getElementById("race-end-hour")?.value;

    function parse(date, hour) {
      if (!date || hour === "") return null;
      const [y, m, d] = date.split("-").map(Number);
      return new Date(y, m - 1, d, parseInt(hour, 10), 0, 0, 0).getTime();
    }

    return {
      startAt: parse(startDate, startHour),
      endAt: parse(endDate, endHour),
    };
  }

  function validateRaceSetup(state) {
    if (state.teams.length < RaceStore.MIN_TEAMS) {
      throw new Error(`Add at least ${RaceStore.MIN_TEAMS} teams`);
    }
    if (!RaceStore.getScheduledTasks().filter((t) => t.status === "pending").length) {
      throw new Error("Add at least one challenge");
    }
    if (!state.race.startAt || !state.race.endAt) {
      throw new Error("Save a start and end time first");
    }
  }

  function remainingMs(endsAt) {
    return Math.max(0, endsAt - Date.now());
  }

  function renderCountdown(endsAt, urgentAt) {
    const ms = remainingMs(endsAt);
    const urgent = ms < (urgentAt || 3600000);
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n) => String(n).padStart(2, "0");
    const units = [];
    if (d) units.push({ v: d, l: "days" });
    units.push({ v: pad(h), l: "hrs" }, { v: pad(m), l: "min" }, { v: pad(sec), l: "sec" });
    return `<div class="countdown${urgent ? " countdown--urgent" : ""}" data-ends-at="${endsAt}">
      ${units.map((u) => `<div class="countdown-unit"><span>${u.v}</span><small>${u.l}</small></div>`).join("")}
    </div>`;
  }

  function updateCountdowns() {
    document.querySelectorAll(".countdown[data-ends-at]").forEach((el) => {
      const endsAt = parseInt(el.dataset.endsAt, 10);
      if (!endsAt) return;
      const tmp = document.createElement("div");
      tmp.innerHTML = renderCountdown(endsAt);
      const next = tmp.firstElementChild;
      if (next) el.replaceWith(next);
    });
  }

  function renderPhotoPointsHint() {
    const labels = ["1st", "2nd", "3rd", "4th", "5th"];
    const parts = RaceStore.UPLOAD_POINTS.map((pts, i) => `${labels[i] || `${i + 1}th`} ${pts}`);
    return `<p class="photo-points-hint"><strong>Photo points:</strong> ${parts.join(" · ")}</p>`;
  }

  function scoreboardTitle(state) {
    return state.race.status === "ended" ? "Final scores" : "Live scoreboard";
  }

  function maxPoints(state) {
    return Math.max(1, ...state.teams.map((t) => t.points || 0), 100);
  }

  function renderScoreboardTable(state) {
    const ranked = RaceStore.rankTeams(state);
    const max = maxPoints(state);
    return `<table class="scoreboard-table">
      <thead><tr><th>#</th><th>Team</th><th>Points</th></tr></thead>
      <tbody>
        ${ranked
          .map(({ team: t, rank }) => {
            const pct = ((t.points || 0) / max) * 100;
            const medal = RaceStore.medalForRank(rank);
            return `<tr>
              <td>${medal ? `${medal} ` : ""}${rank}</td>
              <td><span class="team-dot" style="background:${esc(t.color)}"></span> ${esc(t.name)}</td>
              <td><strong>${t.points || 0}</strong>
                <div class="rank-bar"><div class="rank-bar-inner" style="width:${pct}%"></div></div>
              </td>
            </tr>`;
          })
          .join("")}
      </tbody>
    </table>`;
  }

  function renderDurationOptions(selected) {
    const opts = [
      ["30m", "30 minutes"],
      ["1h", "1 hour"],
      ["1d", "24 hours"],
      ["1w", "7 days"],
      ["1month", "30 days"],
    ];
    return opts
      .map(([v, l]) => `<option value="${v}"${selected === v ? " selected" : ""}>${l}</option>`)
      .join("");
  }

  function renderLogin() {
    return `
      <section class="login-hero">
        <h2>🏁 ${esc(cfg().raceName || "Family Amazing Race")}</h2>
        <p>Private family competition — sign in with your team code or admin access.</p>
      </section>
      <div class="login-tabs">
        <button type="button" class="${uiState.loginTab === "team" ? "active" : ""}" data-tab="team">Team login</button>
        <button type="button" class="${uiState.loginTab === "admin" ? "active" : ""}" data-tab="admin">Admin</button>
      </div>
      <div class="card login-card ${uiState.loginTab === "team" ? "" : "hidden"}" id="panel-team">
        <label for="team-code">Team access code</label>
        <input type="text" id="team-code" placeholder="e.g. A3K9F2" autocomplete="off" autocapitalize="characters" />
        <button type="button" class="btn btn-primary btn-block" id="btn-team-login">Enter race</button>
      </div>
      <div class="card login-card ${uiState.loginTab === "admin" ? "" : "hidden"}" id="panel-admin">
        <label for="admin-pass">Admin password</label>
        <input type="password" id="admin-pass" autocomplete="current-password" />
        <button type="button" class="btn btn-primary btn-block" id="btn-admin-login">Admin panel</button>
      </div>
      <p class="alert alert-info" style="max-width:400px;margin:1.5rem auto 0">
        ${cfg().firebase
          ? "Connected — all teams share live data."
          : "Demo mode: data stays in this browser only. Add Firebase in config.js before Croatia so all phones sync."}
      </p>`;
  }

  function renderHeader(state) {
    const live = state.race.status === "active";
    const role = session.role === "admin" ? "Admin" : session.teamName;
    return `
      <header class="site-header">
        <div class="logo">
          <span class="logo-icon">🇭🇷</span>
          <div>
            <h1>${esc(state.race.name)}</h1>
            <p>${esc(role)}</p>
          </div>
        </div>
        <div class="header-actions">
          ${live ? '<span class="badge badge--live">● LIVE</span>' : `<span class="badge">${esc(state.race.status)}</span>`}
          <button type="button" class="btn btn-secondary btn-sm" id="btn-scoreboard">${state.race.status === "ended" ? "Final scores" : "Scoreboard"}</button>
          ${state.race.status === "ended" ? '<button type="button" class="btn btn-accent btn-sm" id="btn-scrapbook">Scrapbook</button>' : ""}
          <button type="button" class="btn btn-ghost btn-sm" id="btn-logout">Logout</button>
        </div>
      </header>`;
  }

  function renderAdminTaskList(state) {
    const tasks = RaceStore.getScheduledTasks();
    if (!tasks.length) {
      return '<p class="empty-state"><span>📋</span>Add challenges below — they run in order when the race starts.</p>';
    }
    const canEdit = RaceStore.canEditSetup();
    let pendingQueue = 0;
    return `<div class="task-queue">
      ${tasks
        .map((t) => {
          const statusLabel =
            t.status === "active"
              ? "● LIVE"
              : t.status === "closed" && !t.startsAt
                ? "Skipped"
                : t.status === "closed"
                  ? "Done"
                  : `Queued #${++pendingQueue}`;
          const actions = [];
          if (canEdit) {
            actions.push(
              `<button type="button" class="btn btn-ghost btn-sm btn-remove-task" data-id="${t.id}">Remove</button>`
            );
          }
          if (RaceStore.canRequeueTask(t)) {
            actions.push(
              `<button type="button" class="btn btn-ghost btn-sm btn-requeue-task" data-id="${t.id}">Requeue</button>`
            );
          }
          return `<div class="task-queue-item">
            <div>
              <strong>${esc(t.title)}</strong>
              <div class="task-meta" style="margin-top:0.35rem">
                <span class="tag">${esc(t.type)}</span>
                <span class="tag">${durationLabel(t.duration)}</span>
                <span class="tag">${statusLabel}</span>
              </div>
            </div>
            ${actions.length ? `<div class="btn-row" style="margin:0;gap:0.35rem">${actions.join("")}</div>` : ""}
          </div>`;
        })
        .join("")}
    </div>`;
  }

  function renderAdminTaskForm() {
    return `
      <div class="grid-2" style="margin-top:1rem">
        <div>
          <label>Challenge title</label>
          <input type="text" id="task-title" placeholder="Find the red door" />
        </div>
        <div>
          <label>Type</label>
          <select id="task-type">
            <option value="photo">Photo challenge</option>
            <option value="quiz">Multiple choice quiz</option>
            <option value="text">Text answer</option>
            <option value="combo">Photo + quiz</option>
          </select>
        </div>
      </div>
      <label>Instructions</label>
      <textarea id="task-desc" placeholder="What must every team do?"></textarea>
      <label>Time limit (capped at race end)</label>
      <select id="task-duration">${renderDurationOptions("1d")}</select>
      <div id="quiz-fields" class="hidden">
        <label>Quiz options (one per line)</label>
        <textarea id="task-quiz" placeholder="A. Option one&#10;B. Option two"></textarea>
        <label>Correct answer</label>
        <select id="task-correct">
          <option value="0">A</option><option value="1">B</option>
          <option value="2">C</option><option value="3">D</option>
        </select>
      </div>
      <button type="button" class="btn btn-accent" id="btn-add-task">Add to queue</button>
      <p class="alert alert-info" style="margin-top:0.75rem;margin-bottom:0">
        Points: 1st upload 100 · 2nd 80 · 3rd 60 · 4th 40 · 5th 20 (auto-awarded)
      </p>`;
  }

  function renderAdminManage(state) {
    const r = state.race;
    const canEdit = RaceStore.canEditSetup();
    const current = RaceStore.getCurrentTask();

    return `
      <div class="card">
        <h2>Competition schedule</h2>
        <label>Race name</label>
        <input type="text" id="race-name" value="${esc(r.name)}" ${canEdit ? "" : "disabled"} />
        <div class="field-row field-row--schedule">
          <div>
            <label>Start date</label>
            <input type="date" id="race-start-date" value="${toInputDate(r.startAt)}" ${canEdit ? "" : "disabled"} />
          </div>
          <div>
            <label>Start hour</label>
            <select id="race-start-hour" ${canEdit ? "" : "disabled"}>
              <option value="">—</option>
              ${renderHourOptions(toInputHour(r.startAt))}
            </select>
          </div>
          <div>
            <label>End date</label>
            <input type="date" id="race-end-date" value="${toInputDate(r.endAt)}" ${canEdit ? "" : "disabled"} />
          </div>
          <div>
            <label>End hour</label>
            <select id="race-end-hour" ${canEdit ? "" : "disabled"}>
              <option value="">—</option>
              ${renderHourOptions(toInputHour(r.endAt))}
            </select>
          </div>
        </div>
        ${canEdit ? `
          <div class="btn-row">
            <button type="button" class="btn btn-primary" id="btn-save-schedule">Save schedule</button>
          </div>` : ""}
      </div>

      <div class="card">
        <h2>Teams (${RaceStore.MIN_TEAMS}–${RaceStore.MAX_TEAMS} teams, 2–4 members each)</h2>
        ${canEdit ? `
          <label>Team name</label>
          <input type="text" id="new-team-name" placeholder="The Dubrovnik Dashers" />
          <label>Members (comma-separated)</label>
          <input type="text" id="new-team-members" placeholder="Alex, Sam, Jordan" />
          <button type="button" class="btn btn-primary" id="btn-add-team">Add team</button>
        ` : ""}
        <div style="margin-top:1rem" id="team-list">
          ${state.teams
            .map(
              (t) => `
            <div class="team-list-item">
              <div><span class="team-dot" style="background:${esc(t.color)}"></span>
                <strong>${esc(t.name)}</strong> — ${esc(t.members.join(", "))}
                <div class="team-code" style="margin-top:0.35rem">Code: ${esc(t.code)}</div>
              </div>
              ${!RaceStore.isRaceEnded() ? `
                <div style="display:flex;gap:0.35rem">
                  <button type="button" class="btn btn-secondary btn-sm btn-edit-team" data-id="${t.id}">Edit</button>
                  ${canEdit ? `<button type="button" class="btn btn-ghost btn-sm btn-remove-team" data-id="${t.id}">Remove</button>` : ""}
                </div>` : ""}
            </div>`
            )
            .join("") || '<p class="empty-state"><span>👥</span>No teams yet</p>'}
        </div>
        <p class="alert alert-warn" style="margin-top:1rem;margin-bottom:0">Share each team’s code privately.</p>
      </div>

      <div class="card">
        <h2>Challenges (admin assigns all before start)</h2>
        ${renderAdminTaskList(state)}
        ${canEdit ? renderAdminTaskForm() : "<p style='color:var(--muted)'>Challenges are locked while race is running.</p>"}
      </div>

      ${current ? renderActiveTask(state, current, null, false, true) : ""}

      ${renderRaceControl(state)}`;
  }

  function renderRaceControl(state) {
    const r = state.race;
    const canStart = r.status === "setup" || r.status === "scheduled";
    const isActive = r.status === "active";
    const isEnded = r.status === "ended";
    const pendingCount = RaceStore.getPendingTaskCount();
    const canContinue = isEnded && pendingCount > 0;
    const canNewRace = isEnded || isActive;
    const archivedCount = RaceStore.getArchivedRacesCount();

    return `
      <div class="card card--race-control">
        <h2>Race control</h2>
        <p>Status: <strong>${esc(r.status)}</strong>
          ${r.startAt ? ` · Starts ${formatDate(r.startAt)}` : ""}
          ${r.endAt ? ` · Ends ${formatDate(r.endAt)}` : ""}</p>
        ${canContinue ? `<p class="alert alert-warn" style="margin-bottom:0.75rem">${pendingCount} challenge${pendingCount === 1 ? "" : "s"} still queued — you can continue the race.</p>` : ""}
        ${archivedCount ? `<p style="color:var(--muted);margin:0 0 0.75rem;font-size:0.9rem">${archivedCount} previous race${archivedCount === 1 ? "" : "s"} archived locally.</p>` : ""}
        <div class="btn-row">
          ${canStart ? `
          ${r.status === "scheduled" ? `<p class="alert alert-info" style="margin:0 0 0.75rem;width:100%">Waiting to start automatically at <strong>${formatDate(r.startAt)}</strong>.</p>` : ""}
          ${r.status !== "scheduled" ? '<button type="button" class="btn btn-primary" id="btn-schedule-race">Start scheduled race</button>' : ""}
          <button type="button" class="btn btn-accent" id="btn-start-now">Start now</button>
          ` : ""}
          ${isActive ? '<button type="button" class="btn btn-accent" id="btn-end-race">End entire race early</button>' : ""}
          ${canNewRace ? '<button type="button" class="btn btn-secondary" id="btn-new-race">New race</button>' : ""}
          ${canContinue ? '<button type="button" class="btn btn-primary" id="btn-continue-race">Continue race</button>' : ""}
          <button type="button" class="btn btn-ghost btn-sm" id="btn-reset" style="color:#c92a2a">Reset all data</button>
        </div>
      </div>`;
  }

  function renderStartRaceSummary(state) {
    const r = state.race;
    const tasks = RaceStore.getScheduledTasks();
    return `
      <p><strong>${esc(r.name)}</strong></p>
      <p>${r.startAt ? formatDate(r.startAt) : "—"} → ${r.endAt ? formatDate(r.endAt) : "—"}</p>
      <h3 style="margin:1rem 0 0.5rem;font-size:1rem">Teams (${state.teams.length})</h3>
      <ul style="margin:0;padding-left:1.25rem">
        ${state.teams.map((t) => `<li><strong>${esc(t.name)}</strong> — ${esc(t.members.join(", "))} <span class="team-code">Code: ${esc(t.code)}</span></li>`).join("")}
      </ul>
      <h3 style="margin:1rem 0 0.5rem;font-size:1rem">Challenges (${tasks.length})</h3>
      <ol style="margin:0;padding-left:1.25rem">
        ${tasks.map((t) => `<li><strong>${esc(t.title)}</strong> — ${durationLabel(t.duration)} · ${esc(t.type)}</li>`).join("")}
      </ol>
      <p class="alert alert-warn" style="margin-top:1rem;margin-bottom:0">Starting locks teams & challenges. Make sure setup is correct.</p>`;
  }

  function renderAdminResults(state) {
    return `
      <div class="card">
        <h2>${scoreboardTitle(state)}</h2>
        ${renderScoreboardTable(state)}
      </div>
      ${renderAllSubmissionsGallery(state, true)}
      ${state.race.status === "ended" ? renderWinner(state) : ""}
      ${state.race.status === "ended" ? renderScrapbookSection(state) : ""}`;
  }

  function renderAdmin(state) {
    return `
      ${renderHeader(state)}
      <div class="tabs" id="admin-tabs">
        <button type="button" class="${uiState.adminTab === "manage" ? "active" : ""}" data-admin-tab="manage">Setup</button>
        <button type="button" class="${uiState.adminTab === "results" ? "active" : ""}" data-admin-tab="results">Results</button>
      </div>
      <div class="tab-panel${uiState.adminTab === "manage" ? "" : " hidden"}" data-panel="manage">${renderAdminManage(state)}</div>
      <div class="tab-panel${uiState.adminTab === "results" ? "" : " hidden"}" data-panel="results">${renderAdminResults(state)}</div>`;
  }

  function renderTeamDashboard(state) {
    const team = RaceStore.getTeam(session.teamId);
    const r = state.race;
    const ended = r.status === "ended";
    const current = RaceStore.getCurrentTask();

    if (ended) {
      return `
        ${renderHeader(state)}
        <div class="grid-2">
          <div class="card">
            <h2>Final scores</h2>
            ${renderScoreboardTable(state)}
            <p style="font-size:0.85rem;color:var(--muted);margin:0">Your team: <strong>${team?.points || 0}</strong> pts</p>
          </div>
          <div class="card">
            <h2>Race status</h2>
            <p><strong>ended</strong></p>
            ${r.endAt ? `<p>Ended: ${formatDate(r.endAt)}</p>` : ""}
          </div>
        </div>
        ${renderAllSubmissionsGallery(state, true)}
        ${renderWinner(state)}
        ${renderScrapbookSection(state)}`;
    }

    return `
      ${renderHeader(state)}
      <div class="grid-2">
        <div class="card">
          <h2>Live scoreboard</h2>
          ${renderScoreboardTable(state)}
          <p style="font-size:0.85rem;color:var(--muted);margin:0">Your team: <strong>${team?.points || 0}</strong> pts</p>
        </div>
        <div class="card">
          <h2>Race status</h2>
          <p><strong>${esc(r.status)}</strong></p>
          ${r.endAt ? `<p>Comp ends: ${formatDate(r.endAt)}</p>` : ""}
          ${renderPhotoPointsHint()}
        </div>
      </div>
      ${current ? renderActiveTask(state, current, team, true, false) : `<div class="card empty-state"><span>⏳</span>Waiting for the next challenge…</div>`}`;
  }

  function renderActiveTask(state, task, team, editable, isAdmin) {
    const sub = team ? RaceStore.getSubmission(task.id, team.id) : null;
    const allSubs = state.teams.map((t) => ({
      team: t,
      sub: RaceStore.getSubmission(task.id, t.id),
    }));
    const ended = state.race.status === "ended";
    const canEdit = editable && team && task.status === "active" && !ended;
    const isPhotoTask = task.type === "photo" || task.type === "combo";

    const typeTags = [];
    if (task.type === "photo" || task.type === "combo") typeTags.push('<span class="tag tag--photo">Photo</span>');
    if (task.type === "quiz" || task.type === "combo") typeTags.push('<span class="tag tag--quiz">Quiz</span>');
    if (task.type === "text") typeTags.push('<span class="tag">Text</span>');

    let submitSection = "";
    if (canEdit) {
      const quizHtml =
        task.quizOptions?.length
          ? `<div class="quiz-options" id="quiz-options">
              ${task.quizOptions
                .map(
                  (opt, i) => `
                <label class="quiz-option">
                  <input type="radio" name="quiz" value="${i}" ${sub?.quizAnswer === i ? "checked" : ""} />
                  <span>${esc(opt)}</span>
                </label>`
                )
                .join("")}
            </div>`
          : "";

      if (isPhotoTask) {
        submitSection = `
        <hr style="border:none;border-top:1px solid #eee;margin:1.25rem 0"/>
        <h3>Your submission</h3>
        ${sub?.points != null ? `<p class="alert alert-info">You earned <strong>${sub.points}</strong> pts for this challenge.</p>` : ""}
        <div class="upload-zone" id="upload-zone">
          <input type="file" id="photo-input" accept="image/*" capture="environment" />
          <p>📷 Tap to upload photo</p>
          ${sub?.photoUrl ? `<img class="upload-preview" id="preview" src="${esc(sub.photoUrl)}" alt="preview"/>` : '<img class="upload-preview hidden" id="preview" alt="preview"/>'}
        </div>
        ${quizHtml}
        <div class="field-row post-row">
          <input type="text" id="comment-text" placeholder="Add a comment…" value="${esc(sub?.comment || "")}" style="margin-bottom:0"/>
          <button type="button" class="btn btn-secondary btn-sm" id="btn-post-submission">Post</button>
        </div>`;
      } else {
        submitSection = `
        <hr style="border:none;border-top:1px solid #eee;margin:1.25rem 0"/>
        <h3>Your submission</h3>
        ${sub?.points != null ? `<p class="alert alert-info">You earned <strong>${sub.points}</strong> pts for this challenge.</p>` : ""}
        ${task.type === "text" ? `<textarea id="text-answer" placeholder="Your answer…">${esc(sub?.textAnswer || "")}</textarea>` : ""}
        ${quizHtml}
        <button type="button" class="btn btn-primary" id="btn-submit-task">${sub ? "Update submission" : "Submit"}</button>`;
      }
    } else if (sub?.points != null && team) {
      submitSection = `<p class="alert alert-info">Your score: <strong>${sub.points}</strong> pts</p>`;
    }

    return `
      <div class="card task-active" data-task-id="${task.id}">
        <div class="task-meta">${typeTags.join("")}
          <span class="tag">${durationLabel(task.duration)}</span>
        </div>
        <h2>${esc(task.title)}</h2>
        <p>${esc(task.description)}</p>
        ${task.status === "active" ? renderCountdown(task.endsAt) : "<p><strong>Ended</strong></p>"}
        ${isPhotoTask && task.status === "active" ? renderPhotoPointsHint() : ""}
        ${isAdmin && task.status === "active" && state.race.status === "active" ? `
          <div class="btn-row" style="margin-bottom:1rem">
            <button type="button" class="btn btn-accent btn-sm" id="btn-end-task" data-task="${task.id}">End this challenge early → next</button>
          </div>` : ""}
        ${submitSection}
        <h3>All submissions</h3>
        ${renderSubmissionGrid(allSubs, false)}
      </div>`;
  }

  function renderSubmissionGrid(allSubs, selectable) {
    return `<div class="submission-grid${selectable ? " submission-grid--select" : ""}">
      ${allSubs
        .map(({ team: t, sub: s }) => {
          if (!s?.photoUrl) {
            return `<div class="submission-card submission-card--pending"><span>${esc(t.name)}<br/>pending</span></div>`;
          }
          const caption = s.comment
            ? `<p class="submission-comment">${esc(s.comment)}</p>`
            : "";
          if (selectable) {
            return `<label class="submission-card submission-card--selectable submission-card--with-caption" data-url="${esc(s.photoUrl)}" data-filename="${esc((t.name + "-" + s.id).replace(/\s+/g, "-") + ".jpg")}">
              <input type="checkbox" class="photo-select" />
              <img src="${esc(s.photoUrl)}" alt=""/>
              <div class="submission-caption">
                <strong>${esc(t.name)}</strong>
                ${caption}
              </div>
            </label>`;
          }
          return `<div class="submission-card submission-card--with-caption">
            <img src="${esc(s.photoUrl)}" alt=""/>
            <div class="submission-caption">
              <strong>${esc(t.name)}</strong>
              ${caption}
            </div>
          </div>`;
        })
        .join("")}
    </div>`;
  }

  function renderAllSubmissionsGallery(state, selectable) {
    const photos = RaceScrapbook.collectPhotos(state);
    if (!photos.length) {
      return `<div class="card"><h2>All submissions</h2><p style="color:var(--muted)">No photos uploaded.</p></div>`;
    }

    const byTask = {};
    photos.forEach((p) => {
      if (!byTask[p.task]) byTask[p.task] = [];
      byTask[p.task].push(p);
    });

    return `
      <div class="card">
        <h2>All submissions</h2>
        ${selectable ? `
          <div class="download-toolbar">
            <button type="button" class="btn btn-secondary btn-sm" id="btn-sel-all">Select all</button>
            <button type="button" class="btn btn-secondary btn-sm" id="btn-sel-none">Clear</button>
            <button type="button" class="btn btn-accent btn-sm" id="btn-dl-selected">Download selected</button>
          </div>` : ""}
        ${Object.entries(byTask)
          .map(
            ([taskName, items]) => `
          <h3 style="font-size:1rem;margin:1rem 0 0.5rem">${esc(taskName)}</h3>
          <div class="submission-grid submission-grid--select">
            ${items
              .map(
                (p) => `
              <label class="submission-card submission-card--selectable submission-card--with-caption" data-url="${esc(p.url)}" data-filename="${esc(p.filename)}">
                ${selectable ? '<input type="checkbox" class="photo-select" />' : ""}
                <img src="${esc(p.url)}" alt=""/>
                <div class="submission-caption">
                  <strong>${esc(p.team)}</strong>
                  ${p.comment ? `<p class="submission-comment">${esc(p.comment)}</p>` : ""}
                </div>
              </label>`
              )
              .join("")}
          </div>`
          )
          .join("")}
      </div>`;
  }

  function renderWinner(state) {
    const winners = RaceStore.getWinners(state);
    if (!winners.length) return "";

    const names = winners.map((t) => esc(t.name)).join(" & ");
    const pts = winners[0].points || 0;
    const label = winners.length > 1 ? "Winners" : "Winner";

    return `
      <div class="winner-banner">
        <h2>🏆 ${label}: ${names}</h2>
        <p>${pts} points${winners.length > 1 ? " each" : ""} · Race complete!</p>
      </div>`;
  }

  function renderScrapbookSection(state) {
    const photos = RaceScrapbook.collectPhotos(state).slice(0, 8);
    return `
      <div class="card">
        <h2>Memory scrapbook</h2>
        <div class="scrapbook-preview">${photos.map((p) => `<img src="${esc(p.url)}" alt=""/>`).join("")}</div>
        <button type="button" class="btn btn-accent" id="btn-scrapbook-open" style="margin-top:1rem">Open slideshow</button>
      </div>`;
  }


  function render() {
    const app = document.getElementById("app");
    const state = RaceStore.getState();

    if (RaceStore.checkAutoStart()) {
      RaceStore.persist();
    }

    const expired = RaceStore.expireTaskIfNeeded();
    if (expired) RaceStore.persist();

    if (!session) {
      app.innerHTML = renderLogin();
      bindLogin();
      return;
    }

    if (session.role === "admin") {
      app.innerHTML = renderAdmin(state);
      bindAdmin(state);
    } else {
      app.innerHTML = renderTeamDashboard(state);
      bindTeam(state);
    }

    bindCommon(state);
    updateCountdowns();
  }

  function bindLogin() {
    document.querySelectorAll(".login-tabs button").forEach((btn) => {
      btn.addEventListener("click", () => {
        uiState.loginTab = btn.dataset.tab;
        document.querySelectorAll(".login-tabs button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const tab = btn.dataset.tab;
        document.getElementById("panel-team").classList.toggle("hidden", tab !== "team");
        document.getElementById("panel-admin").classList.toggle("hidden", tab !== "admin");
      });
    });

    document.getElementById("btn-team-login")?.addEventListener("click", () => {
      const code = document.getElementById("team-code")?.value;
      const team = RaceStore.findTeamByCode(code);
      if (!team) {
        toast("Invalid team code", "error");
        return;
      }
      saveSession({ role: "team", teamId: team.id, teamName: team.name });
      toast(`Welcome, ${team.name}!`);
      render();
    });

    document.getElementById("btn-admin-login")?.addEventListener("click", () => {
      const pass = document.getElementById("admin-pass")?.value;
      if (pass !== cfg().adminPassword) {
        toast("Wrong admin password", "error");
        return;
      }
      saveSession({ role: "admin" });
      toast("Admin access granted");
      render();
    });
  }

  function bindCommon(state) {
    document.getElementById("btn-logout")?.addEventListener("click", () => {
      saveSession(null);
      render();
    });

    document.getElementById("btn-scoreboard")?.addEventListener("click", () => {
      openModal(
        scoreboardTitle(RaceStore.getState()),
        renderScoreboardTable(RaceStore.getState()),
        '<button type="button" class="btn btn-primary" id="modal-close">Close</button>'
      );
      document.getElementById("modal-close")?.addEventListener("click", closeModal);
    });

    document.getElementById("btn-scrapbook")?.addEventListener("click", () => openScrapbook());
    document.getElementById("btn-scrapbook-open")?.addEventListener("click", () => openScrapbook());

    bindPhotoDownloads();
  }

  function openScrapbook() {
    const state = RaceStore.getState();
    RaceScrapbook.openScrapbook(state, state.race.name);
  }

  function bindPhotoDownloads() {
    document.getElementById("btn-sel-all")?.addEventListener("click", () => {
      document.querySelectorAll(".photo-select").forEach((cb) => {
        cb.checked = true;
        cb.closest(".submission-card--selectable")?.classList.add("selected");
      });
    });

    document.getElementById("btn-sel-none")?.addEventListener("click", () => {
      document.querySelectorAll(".photo-select").forEach((cb) => {
        cb.checked = false;
        cb.closest(".submission-card--selectable")?.classList.remove("selected");
      });
    });

    document.querySelectorAll(".submission-card--selectable").forEach((card) => {
      card.addEventListener("click", (e) => {
        const cb = card.querySelector(".photo-select");
        if (!cb) return;
        if (e.target === cb) {
          card.classList.toggle("selected", cb.checked);
          return;
        }
        cb.checked = !cb.checked;
        card.classList.toggle("selected", cb.checked);
      });
    });

    document.getElementById("btn-dl-selected")?.addEventListener("click", async () => {
      const selected = [];
      document.querySelectorAll(".submission-card--selectable").forEach((card) => {
        const cb = card.querySelector(".photo-select");
        if (cb?.checked) {
          selected.push({
            url: card.dataset.url,
            filename: card.dataset.filename,
          });
        }
      });
      if (!selected.length) {
        toast("Select at least one photo", "error");
        return;
      }
      await RaceScrapbook.downloadPhotosAsZip(selected, "selected-photos.zip");
      toast(`Downloading ${selected.length} photo(s)…`);
    });
  }

  function bindAdmin(state) {
    document.querySelectorAll("#admin-tabs button").forEach((btn) => {
      btn.addEventListener("click", () => {
        uiState.adminTab = btn.dataset.adminTab;
        document.querySelectorAll("#admin-tabs button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const tab = btn.dataset.adminTab;
        document.querySelectorAll(".tab-panel").forEach((p) => {
          p.classList.toggle("hidden", p.dataset.panel !== tab);
        });
      });
    });

    document.getElementById("btn-save-schedule")?.addEventListener("click", async () => {
      try {
        const { startAt, endAt } = readScheduleFromForm();
        RaceStore.configureRace({
          name: document.getElementById("race-name").value,
          startAt,
          endAt,
        });
        await RaceStore.persist();
        toast("Schedule saved");
        render();
      } catch (e) {
        toast(e.message, "error");
      }
    });

    document.getElementById("btn-add-team")?.addEventListener("click", async () => {
      const name = document.getElementById("new-team-name").value.trim();
      const membersRaw = document.getElementById("new-team-members").value;
      const members = membersRaw.split(/[,;]+/).map((m) => m.trim());
      if (!name) {
        toast("Team name required", "error");
        return;
      }
      if (members.length < 2 || members.length > 4) {
        toast("Add 2–4 member names (comma-separated)", "error");
        return;
      }
      try {
        const t = RaceStore.addTeam(name, members);
        await RaceStore.persist();
        toast(`Team "${t.name}" created — code: ${t.code}`);
        render();
      } catch (e) {
        toast(e.message, "error");
      }
    });

    document.querySelectorAll(".btn-remove-team").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Remove this team?")) return;
        try {
          RaceStore.removeTeam(btn.dataset.id);
          await RaceStore.persist();
          render();
        } catch (e) {
          toast(e.message, "error");
        }
      });
    });

    document.querySelectorAll(".btn-edit-team").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        const team = RaceStore.getTeam(id);
        if (!team) return;
        openModal(
          "Edit team",
          `<label>Team name</label>
           <input type="text" id="edit-team-name" value="${esc(team.name)}" />
           <label>Members (comma-separated)</label>
           <input type="text" id="edit-team-members" value="${esc(team.members.join(", "))}" />
           <p style="font-size:0.85rem;color:var(--muted)">Team code stays: <strong>${esc(team.code)}</strong></p>`,
          `<button type="button" class="btn btn-primary" id="btn-save-team-edit">Save</button>
           <button type="button" class="btn btn-ghost" id="modal-close">Cancel</button>`
        );
        document.getElementById("btn-save-team-edit")?.addEventListener("click", async () => {
          const name = document.getElementById("edit-team-name").value.trim();
          const members = document.getElementById("edit-team-members").value.split(/[,;]+/).map((m) => m.trim());
          if (!name) {
            toast("Team name required", "error");
            return;
          }
          try {
            RaceStore.updateTeam(id, { name, members });
            await RaceStore.persist();
            closeModal();
            toast("Team updated");
            render();
          } catch (e) {
            toast(e.message, "error");
          }
        });
        document.getElementById("modal-close")?.addEventListener("click", closeModal);
      });
    });

    const typeSel = document.getElementById("task-type");
    typeSel?.addEventListener("change", () => {
      const show = ["quiz", "combo"].includes(typeSel.value);
      document.getElementById("quiz-fields")?.classList.toggle("hidden", !show);
    });

    document.getElementById("btn-add-task")?.addEventListener("click", async () => {
      const title = document.getElementById("task-title")?.value.trim();
      if (!title) {
        toast("Title required", "error");
        return;
      }
      const type = document.getElementById("task-type").value;
      let quizOptions = [];
      let quizCorrect = null;
      if (type === "quiz" || type === "combo") {
        quizOptions = document
          .getElementById("task-quiz")
          .value.split("\n")
          .map((l) => l.trim())
          .filter(Boolean);
        if (quizOptions.length < 2) {
          toast("Add at least 2 quiz options", "error");
          return;
        }
        quizCorrect = parseInt(document.getElementById("task-correct").value, 10);
      }
      try {
        RaceStore.addScheduledTask({
          title,
          description: document.getElementById("task-desc").value,
          type,
          duration: document.getElementById("task-duration").value,
          quizOptions,
          quizCorrect,
        });
        await RaceStore.persist();
        toast("Challenge added to queue");
        render();
      } catch (e) {
        toast(e.message, "error");
      }
    });

    document.querySelectorAll(".btn-remove-task").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Remove this challenge?")) return;
        try {
          RaceStore.removeScheduledTask(btn.dataset.id);
          await RaceStore.persist();
          render();
        } catch (e) {
          toast(e.message, "error");
        }
      });
    });

    document.querySelectorAll(".btn-requeue-task").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const task = RaceStore.getTask(btn.dataset.id);
        if (!task || !confirm(`Requeue "${task.title}" to the end of the challenge list?`)) return;
        try {
          RaceStore.requeueTask(btn.dataset.id);
          await RaceStore.persist();
          toast(`"${task.title}" moved back to the queue`);
          render();
        } catch (e) {
          toast(e.message, "error");
        }
      });
    });

    function openStartModal(title, confirmId, onConfirm) {
      const state = RaceStore.getState();
      try {
        validateRaceSetup(state);
      } catch (e) {
        toast(e.message, "error");
        return;
      }

      openModal(
        title,
        renderStartRaceSummary(state),
        `<button type="button" class="btn btn-primary" id="${confirmId}">Confirm</button>
         <button type="button" class="btn btn-ghost" id="modal-close">Not yet</button>`
      );

      document.getElementById(confirmId)?.addEventListener("click", async () => {
        try {
          await onConfirm();
          closeModal();
          render();
        } catch (e) {
          toast(e.message, "error");
        }
      });
      document.getElementById("modal-close")?.addEventListener("click", closeModal);
    }

    document.getElementById("btn-schedule-race")?.addEventListener("click", () => {
      openStartModal("Start on schedule?", "btn-confirm-schedule", async () => {
        RaceStore.scheduleRaceStart();
        await RaceStore.persist();
        const startAt = RaceStore.getState().race.startAt;
        toast(`Race scheduled — starts automatically at ${formatDate(startAt)}`);
      });
    });

    document.getElementById("btn-start-now")?.addEventListener("click", () => {
      openStartModal("Start race now?", "btn-confirm-start-now", async () => {
        RaceStore.startRaceNow();
        await RaceStore.persist();
        toast("Race started — first challenge is live!");
      });
    });

    document.getElementById("btn-end-task")?.addEventListener("click", async () => {
      const task = RaceStore.getCurrentTask();
      if (!task || !confirm(`End "${task.title}" now and start the next challenge?`)) return;
      RaceStore.refreshBeforeAction();
      RaceStore.endTaskEarly();
      await RaceStore.persist();
      toast(
        RaceStore.getState().race.status === "ended"
          ? "Last challenge ended — race complete!"
          : "Challenge ended — next one starting if queued"
      );
      render();
    });

    document.getElementById("btn-end-race")?.addEventListener("click", async () => {
      if (!confirm("End the entire competition?")) return;
      RaceStore.refreshBeforeAction();
      RaceStore.endRace();
      await RaceStore.persist();
      toast("Race ended — winner announced!");
      render();
    });

    document.getElementById("btn-new-race")?.addEventListener("click", async () => {
      if (
        !confirm(
          "Archive this race and start fresh setup?\n\nTeams are kept (codes unchanged). Challenges, photos and scores are archived — not deleted."
        )
      )
        return;
      await RaceStore.newRace();
      toast("New race ready — previous race archived");
      render();
    });

    document.getElementById("btn-continue-race")?.addEventListener("click", async () => {
      const pending = RaceStore.getPendingTaskCount();
      if (
        !confirm(
          `Resume this race and start the next challenge?\n\n${pending} challenge${pending === 1 ? "" : "s"} still in the queue.`
        )
      )
        return;
      try {
        await RaceStore.continueRace();
        toast("Race resumed — next challenge is live!");
        render();
      } catch (e) {
        toast(e.message, "error");
      }
    });

    document.getElementById("btn-reset")?.addEventListener("click", async () => {
      if (!confirm("Delete ALL race data? Cannot undo.")) return;
      await RaceStore.resetAll();
      toast("Reset complete");
      render();
    });
  }

  function bindTeam(state) {
    bindSubmission(state);
  }

  function bindSubmission(state) {
    const team = RaceStore.getTeam(session.teamId);
    const task = RaceStore.getCurrentTask();
    if (!task || !team || state.race.status === "ended") return;

    const isPhotoTask = task.type === "photo" || task.type === "combo";
    let photoFile = null;
    let photoDataUrl = null;
    const existing = RaceStore.getSubmission(task.id, team.id);

    const zone = document.getElementById("upload-zone");
    const input = document.getElementById("photo-input");
    const preview = document.getElementById("preview");

    function updatePostButton() {
      const btn = document.getElementById("btn-post-submission");
      const commentInput = document.getElementById("comment-text");
      if (!btn || !commentInput) return;
      const hasComment = commentInput.value.trim().length > 0;
      const hasPhoto = !!(photoDataUrl || preview?.src && !preview.classList.contains("hidden") || existing?.photoUrl);
      const canPost = hasComment && hasPhoto;
      btn.classList.toggle("btn-post-ready", canPost);
    }

    zone?.addEventListener("click", () => input?.click());
    zone?.addEventListener("dragover", (e) => {
      e.preventDefault();
      zone.classList.add("dragover");
    });
    zone?.addEventListener("dragleave", () => zone.classList.remove("dragover"));
    zone?.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.classList.remove("dragover");
      const f = e.dataTransfer.files[0];
      if (f) handleFile(f);
    });

    input?.addEventListener("change", () => {
      const f = input.files[0];
      if (f) handleFile(f);
    });

    function handleFile(file) {
      photoFile = file;
      const reader = new FileReader();
      reader.onload = () => {
        photoDataUrl = reader.result;
        if (preview) {
          preview.src = photoDataUrl;
          preview.classList.remove("hidden");
        }
        updatePostButton();
      };
      reader.readAsDataURL(file);
    }

    document.getElementById("comment-text")?.addEventListener("input", updatePostButton);
    updatePostButton();

    document.querySelectorAll(".quiz-option").forEach((label) => {
      label.addEventListener("click", () => {
        document.querySelectorAll(".quiz-option").forEach((l) => l.classList.remove("selected"));
        label.classList.add("selected");
        label.querySelector("input").checked = true;
      });
    });

    document.getElementById("btn-post-submission")?.addEventListener("click", async () => {
      const comment = document.getElementById("comment-text")?.value?.trim();
      const quizEl = document.querySelector('input[name="quiz"]:checked');
      const quizAnswer = quizEl ? parseInt(quizEl.value, 10) : null;

      if (!comment) {
        toast("Kommentti vaaditaan", "error");
        return;
      }
      if (!photoDataUrl && !existing?.photoUrl) {
        toast("Lataa ensin kuva", "error");
        return;
      }

      try {
        const sub = await RaceStore.submitTask(team.id, task.id, {
          photoFile,
          photoDataUrl,
          quizAnswer,
          comment,
        });
        toast(sub.points != null ? `Posted! +${sub.points} pts` : "Posted!");
        render();
      } catch (e) {
        toast(e.message || "Upload failed — try a smaller photo", "error");
        console.error(e);
      }
    });

    if (!isPhotoTask) {
      document.getElementById("btn-submit-task")?.addEventListener("click", async () => {
        const quizEl = document.querySelector('input[name="quiz"]:checked');
        const quizAnswer = quizEl ? parseInt(quizEl.value, 10) : null;
        const textAnswer = document.getElementById("text-answer")?.value || null;

        try {
          const sub = await RaceStore.submitTask(team.id, task.id, {
            quizAnswer,
            textAnswer,
          });
          toast(sub.points != null ? `Submitted! +${sub.points} pts` : "Submitted!");
          render();
        } catch (e) {
          toast(e.message || "Submit failed", "error");
          console.error(e);
        }
      });
    }
  }

  async function init() {
    session = loadSession();
    try {
      await RaceStore.init();
    } catch (e) {
      console.error("RaceStore init failed", e);
      document.getElementById("app").innerHTML =
        `<div class="card" style="max-width:480px;margin:2rem auto"><h2>Could not connect</h2><p>${String(e.message || e)}</p><p style="color:var(--muted);font-size:0.9rem">Try refreshing. If photos fail, run: <code>firebase deploy --only firestore:rules</code></p></div>`;
      return;
    }
    RaceStore.subscribe(() => {
      if (!session) return;
      render();
    });

    tickTimer = setInterval(async () => {
      RaceStore.syncFromDisk();

      if (RaceStore.checkAutoStart()) {
        await RaceStore.persist();
        if (session) render();
        return;
      }

      const expired = RaceStore.expireTaskIfNeeded();
      if (expired) {
        await RaceStore.persist();
        if (session) render();
      }

      const state = RaceStore.getState();
      if (state.race.status === "active" && state.race.endAt && Date.now() > state.race.endAt) {
        RaceStore.refreshBeforeAction();
        RaceStore.endRace();
        await RaceStore.persist();
        if (session) render();
      }
    }, 4000);

    countdownTimer = setInterval(updateCountdowns, 1000);

    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
