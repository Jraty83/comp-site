/**
 * Croatia Amazing Race — UI application
 */
(function () {
  const SESSION_KEY = "race_session_v1";
  const cfg = () => window.RACE_CONFIG || {};

  let session = null;
  let tickTimer = null;

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
    return new Date(ts).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
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
    return `<div class="countdown${urgent ? " countdown--urgent" : ""}">
      ${units.map((u) => `<div class="countdown-unit"><span>${u.v}</span><small>${u.l}</small></div>`).join("")}
    </div>`;
  }

  function maxPoints(state) {
    return Math.max(1, ...state.teams.map((t) => t.points || 0), 10);
  }

  function renderScoreboardTable(state) {
    const sorted = [...state.teams].sort((a, b) => (b.points || 0) - (a.points || 0));
    const max = maxPoints(state);
    return `<table class="scoreboard-table">
      <thead><tr><th>#</th><th>Team</th><th>Points</th></tr></thead>
      <tbody>
        ${sorted
          .map((t, i) => {
            const pct = ((t.points || 0) / max) * 100;
            return `<tr class="${i === 0 ? "leader" : ""}">
              <td>${i + 1}</td>
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

  /* ---------- Views ---------- */

  function renderLogin() {
    return `
      <section class="login-hero">
        <h2>🏁 ${esc(cfg().raceName || "Family Amazing Race")}</h2>
        <p>Private family competition — sign in with your team code or admin access.</p>
      </section>
      <div class="login-tabs">
        <button type="button" class="active" data-tab="team">Team login</button>
        <button type="button" data-tab="admin">Admin</button>
      </div>
      <div class="card login-card" id="panel-team">
        <label for="team-code">Team access code</label>
        <input type="text" id="team-code" placeholder="e.g. A3K9F2" autocomplete="off" autocapitalize="characters" />
        <button type="button" class="btn btn-primary btn-block" id="btn-team-login">Enter race</button>
      </div>
      <div class="card login-card hidden" id="panel-admin">
        <label for="admin-pass">Admin password</label>
        <input type="password" id="admin-pass" autocomplete="current-password" />
        <button type="button" class="btn btn-primary btn-block" id="btn-admin-login">Admin panel</button>
      </div>
      <p class="alert alert-info" style="max-width:400px;margin:1.5rem auto 0">
        ${RaceStore && window.firebase && !cfg().firebase
          ? "Demo mode: data stays in this browser only. Add Firebase in config.js before Croatia so all phones sync."
          : cfg().firebase
            ? "Connected — all teams share live data."
            : "Demo mode — configure Firebase for multi-device sync."}
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
          <button type="button" class="btn btn-secondary btn-sm" id="btn-scoreboard">Scoreboard</button>
          ${state.race.status === "ended" ? '<button type="button" class="btn btn-accent btn-sm" id="btn-scrapbook">Scrapbook</button>' : ""}
          <button type="button" class="btn btn-ghost btn-sm" id="btn-logout">Logout</button>
        </div>
      </header>`;
  }

  function renderAdmin(state) {
    const r = state.race;
    const designerId = RaceStore.designerTeamId();
    const designer = designerId ? RaceStore.getTeam(designerId) : null;
    const scoringTask = state.tasks.find((t) => t.status === "scoring");
    const current = RaceStore.getCurrentTask();

    return `
      ${renderHeader(state)}
      <div class="tabs" id="admin-tabs">
        <button type="button" class="active" data-admin-tab="setup">Setup</button>
        <button type="button" data-admin-tab="teams">Teams</button>
        <button type="button" data-admin-tab="race">Race control</button>
        <button type="button" data-admin-tab="score">Scoring</button>
      </div>

      <div class="tab-panel" data-panel="setup">
        <div class="card">
          <h2>Competition schedule</h2>
          <label>Race name</label>
          <input type="text" id="race-name" value="${esc(r.name)}" />
          <div class="field-row">
            <div><label>Start</label><input type="datetime-local" id="race-start" value="${toInputDatetime(r.startAt)}" /></div>
            <div><label>End</label><input type="datetime-local" id="race-end" value="${toInputDatetime(r.endAt)}" /></div>
          </div>
          <button type="button" class="btn btn-primary" id="btn-save-schedule">Save schedule</button>
        </div>
        <div class="card">
          <h2>Data & backup</h2>
          <button type="button" class="btn btn-secondary btn-sm" id="btn-export">Export JSON</button>
          <label style="margin-top:1rem">Import JSON (restore backup)</label>
          <textarea id="import-json" placeholder="Paste exported JSON…"></textarea>
          <button type="button" class="btn btn-secondary" id="btn-import">Import</button>
          <button type="button" class="btn btn-ghost btn-sm" id="btn-reset" style="margin-top:0.5rem;color:#c92a2a">Reset all data</button>
        </div>
      </div>

      <div class="tab-panel hidden" data-panel="teams">
        <div class="card">
          <h2>Teams (2–4 members)</h2>
          <label>Team name</label>
          <input type="text" id="new-team-name" placeholder="The Dubrovnik Dashers" />
          <label>Members (comma-separated)</label>
          <input type="text" id="new-team-members" placeholder="Alex, Sam, Jordan" />
          <button type="button" class="btn btn-primary" id="btn-add-team">Add team</button>
          <div style="margin-top:1.25rem" id="team-list">
            ${state.teams
              .map(
                (t) => `
              <div class="team-list-item">
                <div><span class="team-dot" style="background:${esc(t.color)}"></span>
                  <strong>${esc(t.name)}</strong> — ${esc(t.members.join(", "))}
                  <div class="team-code" style="margin-top:0.35rem">Code: ${esc(t.code)}</div>
                </div>
                <button type="button" class="btn btn-ghost btn-sm btn-remove-team" data-id="${t.id}">Remove</button>
              </div>`
              )
              .join("") || '<p class="empty-state"><span>👥</span>No teams yet</p>'}
          </div>
          <p class="alert alert-warn" style="margin-top:1rem">Share each team’s code privately — this is your “password” for the public site.</p>
        </div>
      </div>

      <div class="tab-panel hidden" data-panel="race">
        <div class="card">
          <h2>Race control</h2>
          <p>Status: <strong>${esc(r.status)}</strong>
            ${r.startAt ? ` · Starts ${formatDate(r.startAt)}` : ""}
            ${r.endAt ? ` · Ends ${formatDate(r.endAt)}` : ""}</p>
          ${designer ? `<p>Next task designer: <strong>${esc(designer.name)}</strong></p>` : ""}
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:1rem">
            ${r.status === "setup" || r.status === "scheduled" ? '<button type="button" class="btn btn-primary" id="btn-start-race">Start race</button>' : ""}
            ${r.status === "active" ? '<button type="button" class="btn btn-accent" id="btn-end-race">End race & announce winner</button>' : ""}
          </div>
        </div>
        ${current ? renderActiveTask(state, current, null) : ""}
        ${!current && r.status === "active" && !scoringTask
          ? (designer
              ? `<div class="card"><p>Waiting for <strong>${esc(designer.name)}</strong> to create the next challenge (or publish below as admin).</p></div>${renderTaskCreator(state)}`
              : `<div class="card"><p>Add teams and start the race.</p></div>`)
          : ""}
        ${scoringTask ? renderScoringPanel(state, scoringTask) : ""}
      </div>

      <div class="tab-panel hidden" data-panel="score">
        <div class="card">
          <h2>Live scoreboard</h2>
          ${renderScoreboardTable(state)}
        </div>
      </div>
      ${r.status === "ended" ? renderWinner(state) : ""}`;
  }

  function renderTeamDashboard(state) {
    const team = RaceStore.getTeam(session.teamId);
    const r = state.race;
    const current = RaceStore.getCurrentTask();
    const designerId = RaceStore.designerTeamId();
    const isDesigner = designerId === session.teamId && !current;
    const scoringTask = state.tasks.find((t) => t.status === "scoring");

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
          ${designerId && !current && !scoringTask
            ? `<p>🎨 Task designer: <strong>${esc(RaceStore.getTeam(designerId)?.name)}</strong>${isDesigner ? " (that's you!)" : ""}</p>`
            : ""}
        </div>
      </div>
      ${isDesigner && r.status === "active" ? renderTaskCreator(state) : ""}
      ${current ? renderActiveTask(state, current, team) : ""}
      ${scoringTask ? `<div class="card"><p>⏳ Challenge ended — scoring in progress.</p></div>` : ""}
      ${!current && !isDesigner && r.status === "active" && !scoringTask
        ? `<div class="card empty-state"><span>⏳</span>Waiting for the next challenge…</div>`
        : ""}
      ${r.status === "ended" ? renderWinner(state) : ""}`;
  }

  function renderTaskCreator(state) {
    return `
      <div class="card" style="border-left:5px solid var(--gold)">
        <h2>🎨 Create a challenge for all teams</h2>
        <label>Title</label>
        <input type="text" id="task-title" placeholder="Find the red door in the old town" />
        <label>Instructions</label>
        <textarea id="task-desc" placeholder="What must every team do?"></textarea>
        <label>Type</label>
        <select id="task-type">
          <option value="photo">Do it + upload photo</option>
          <option value="quiz">Multiple choice quiz</option>
          <option value="text">Text answer</option>
          <option value="combo">Photo + quiz</option>
        </select>
        <label>Time limit</label>
        <select id="task-duration">
          <option value="1d">24 hours (1 day)</option>
          <option value="1w">7 days (1 week)</option>
          <option value="1month">30 days (1 month)</option>
        </select>
        <label>Max points</label>
        <input type="number" id="task-points" value="10" min="1" max="100" />
        <div id="quiz-fields" class="hidden">
          <label>Quiz options (one per line, prefix with A. B. C. D.)</label>
          <textarea id="task-quiz" placeholder="A. Option one&#10;B. Option two"></textarea>
          <label>Correct answer letter</label>
          <select id="task-correct">
            <option value="0">A</option><option value="1">B</option>
            <option value="2">C</option><option value="3">D</option>
          </select>
        </div>
        <button type="button" class="btn btn-accent btn-block" id="btn-publish-task">Publish challenge</button>
      </div>`;
  }

  function renderActiveTask(state, task, team) {
    const sub = team ? RaceStore.getSubmission(task.id, team.id) : null;
    const allSubs = state.teams.map((t) => ({
      team: t,
      sub: RaceStore.getSubmission(task.id, t.id),
    }));
    const comments = RaceStore.getComments(task.id);
    const creator = RaceStore.getTeam(task.createdByTeamId);

    const typeTags = [];
    if (task.type === "photo" || task.type === "combo") typeTags.push('<span class="tag tag--photo">Photo</span>');
    if (task.type === "quiz" || task.type === "combo") typeTags.push('<span class="tag tag--quiz">Quiz</span>');
    if (task.type === "text") typeTags.push('<span class="tag">Text</span>');

    let submitSection = "";
    if (team && task.status === "active") {
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

      submitSection = `
        <hr style="border:none;border-top:1px solid #eee;margin:1.25rem 0"/>
        <h3>Your submission</h3>
        ${task.type !== "quiz" ? `
          <div class="upload-zone" id="upload-zone">
            <input type="file" id="photo-input" accept="image/*" capture="environment" />
            <p>📷 Tap to upload photo</p>
            ${sub?.photoUrl ? `<img class="upload-preview" id="preview" src="${esc(sub.photoUrl)}" alt="preview"/>` : '<img class="upload-preview hidden" id="preview" alt="preview"/>'}
          </div>` : ""}
        ${task.type === "text" ? `<textarea id="text-answer" placeholder="Your answer…">${esc(sub?.textAnswer || "")}</textarea>` : ""}
        ${quizHtml}
        <button type="button" class="btn btn-primary" id="btn-submit-task">${sub ? "Update submission" : "Submit"}</button>`;
    }

    return `
      <div class="card task-active" data-task-id="${task.id}">
        <div class="task-meta">${typeTags.join("")}
          <span class="tag">${durationLabel(task.duration)}</span>
          ${creator ? `<span class="tag">By ${esc(creator.name)}</span>` : ""}
        </div>
        <h2>${esc(task.title)}</h2>
        <p>${esc(task.description)}</p>
        ${task.status === "active" ? renderCountdown(task.endsAt) : "<p><strong>Ended</strong></p>"}
        ${submitSection}
        <h3>All submissions</h3>
        <div class="submission-grid">
          ${allSubs
            .map(({ team: t, sub: s }) =>
              s?.photoUrl
                ? `<div class="submission-card"><img src="${esc(s.photoUrl)}" alt=""/><span class="team-label">${esc(t.name)}</span></div>`
                : `<div class="submission-card" style="aspect-ratio:1;display:flex;align-items:center;justify-content:center;font-size:0.75rem;color:#999">${esc(t.name)}<br/>pending</div>`
            )
            .join("")}
        </div>
        <h3>Comments</h3>
        <div class="comments" id="comments-list">
          ${comments.map((c) => `<div class="comment"><strong>${esc(c.author)}</strong><time>${formatDate(c.at)}</time><br/>${esc(c.text)}</div>`).join("") || "<p style='color:#999'>No comments yet.</p>"}
        </div>
        ${team ? `
          <div class="field-row">
            <input type="text" id="comment-text" placeholder="Add a comment…" style="margin-bottom:0"/>
            <button type="button" class="btn btn-secondary btn-sm" id="btn-comment">Post</button>
          </div>` : ""}
      </div>`;
  }

  function renderScoringPanel(state, task) {
    const subs = state.teams.map((t) => ({
      team: t,
      sub: RaceStore.getSubmission(task.id, t.id),
    }));

    return `
      <div class="card">
        <h2>⚖️ Score: ${esc(task.title)}</h2>
        <p>Challenge ended. Award points (max ${task.maxPoints}) or auto-score.</p>
        ${subs
          .map(({ team, sub }) => {
            if (!sub) {
              return `<div class="score-row"><span>${esc(team.name)}</span> — <em>No submission</em>
                <input type="number" class="score-input" data-sub-id="" data-team="${team.id}" data-task="${task.id}" placeholder="0" min="0" max="${task.maxPoints}"/></div>`;
            }
            return `<div class="score-row">
              ${sub.photoUrl ? `<img src="${esc(sub.photoUrl)}" alt=""/>` : ""}
              <div style="flex:1">
                <strong>${esc(team.name)}</strong>
                ${sub.quizAnswer != null ? `<br/>Quiz: ${esc(task.quizOptions?.[sub.quizAnswer] || sub.quizAnswer)}` : ""}
                ${sub.textAnswer ? `<br/>${esc(sub.textAnswer)}` : ""}
              </div>
              <input type="number" class="score-input" data-sub-id="${sub.id}" value="${sub.points ?? ""}" min="0" max="${task.maxPoints}" placeholder="pts"/>
            </div>`;
          })
          .join("")}
        <div style="margin-top:1rem;display:flex;gap:0.5rem;flex-wrap:wrap">
          <button type="button" class="btn btn-primary" id="btn-save-scores" data-task="${task.id}">Save scores</button>
          <button type="button" class="btn btn-secondary" id="btn-auto-score" data-task="${task.id}">Auto-score (AI-style)</button>
          <button type="button" class="btn btn-accent" id="btn-next-round" data-task="${task.id}">Next round →</button>
        </div>
      </div>`;
  }

  function renderWinner(state) {
    const winner = state.teams.find((t) => t.id === state.race.winnerId);
    const sorted = [...state.teams].sort((a, b) => (b.points || 0) - (a.points || 0));
    const top = winner || sorted[0];
    const photos = RaceScrapbook.collectPhotos(state).slice(0, 12);

    return `
      <div class="winner-banner">
        <h2>🏆 Winner: ${esc(top?.name || "TBD")}</h2>
        <p>${top?.points || 0} points · Race complete!</p>
      </div>
      <div class="card">
        <h2>Memory scrapbook</h2>
        <div class="scrapbook-preview">${photos.map((p) => `<img src="${esc(p.url)}" alt=""/>`).join("")}</div>
        <button type="button" class="btn btn-accent" id="btn-scrapbook-dl" style="margin-top:1rem">Download scrapbook (HTML slideshow)</button>
      </div>`;
  }

  function toInputDatetime(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  /* ---------- Render root ---------- */

  function render() {
    const app = document.getElementById("app");
    const state = RaceStore.getState();

    RaceStore.expireTaskIfNeeded();
    if (RaceStore.getState().race !== state.race) {
      RaceStore.persist();
    }

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
  }

  /* ---------- Bindings ---------- */

  function bindLogin() {
    document.querySelectorAll(".login-tabs button").forEach((btn) => {
      btn.addEventListener("click", () => {
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
        "Live scoreboard",
        renderScoreboardTable(RaceStore.getState()),
        '<button type="button" class="btn btn-primary" id="modal-close">Close</button>'
      );
      document.getElementById("modal-close")?.addEventListener("click", closeModal);
    });

    document.getElementById("btn-scrapbook")?.addEventListener("click", () => downloadScrapbook());
    document.getElementById("btn-scrapbook-dl")?.addEventListener("click", () => downloadScrapbook());
  }

  function downloadScrapbook() {
    const state = RaceStore.getState();
    RaceScrapbook.downloadScrapbook(state, state.race.name);
    toast("Scrapbook downloaded — open the HTML file in any browser");
  }

  function bindAdmin(state) {
    document.querySelectorAll("#admin-tabs button").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#admin-tabs button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const tab = btn.dataset.adminTab;
        document.querySelectorAll(".tab-panel").forEach((p) => {
          p.classList.toggle("hidden", p.dataset.panel !== tab);
        });
      });
    });

    document.getElementById("btn-save-schedule")?.addEventListener("click", async () => {
      RaceStore.configureRace({
        name: document.getElementById("race-name").value,
        startAt: document.getElementById("race-start").value,
        endAt: document.getElementById("race-end").value,
      });
      await RaceStore.persist();
      toast("Schedule saved");
      render();
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
      const t = RaceStore.addTeam(name, members);
      await RaceStore.persist();
      toast(`Team "${t.name}" created — code: ${t.code}`);
      render();
    });

    document.querySelectorAll(".btn-remove-team").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Remove this team?")) return;
        RaceStore.removeTeam(btn.dataset.id);
        await RaceStore.persist();
        render();
      });
    });

    document.getElementById("btn-start-race")?.addEventListener("click", async () => {
      if (state.teams.length < 2) {
        toast("Add at least 2 teams first", "error");
        return;
      }
      RaceStore.startRace();
      await RaceStore.persist();
      toast("Race started! First team can create a challenge.");
      render();
    });

    document.getElementById("btn-end-race")?.addEventListener("click", async () => {
      if (!confirm("End the entire competition?")) return;
      RaceStore.endRace();
      await RaceStore.persist();
      toast("Race ended — winner announced!");
      render();
    });

    document.getElementById("btn-export")?.addEventListener("click", () => {
      const blob = new Blob([RaceStore.exportState()], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "race-backup.json";
      a.click();
    });

    document.getElementById("btn-import")?.addEventListener("click", async () => {
      try {
        await RaceStore.importState(document.getElementById("import-json").value);
        toast("Import successful");
        render();
      } catch {
        toast("Invalid JSON", "error");
      }
    });

    document.getElementById("btn-reset")?.addEventListener("click", async () => {
      if (!confirm("Delete ALL race data? Cannot undo.")) return;
      await RaceStore.resetAll();
      toast("Reset complete");
      render();
    });

    bindScoring();
    bindTaskCreator();
  }

  function bindTeam(state) {
    bindTaskCreator();
    bindSubmission(state);
    bindComments();
  }

  function bindTaskCreator() {
    const typeSel = document.getElementById("task-type");
    typeSel?.addEventListener("change", () => {
      const show = ["quiz", "combo"].includes(typeSel.value);
      document.getElementById("quiz-fields")?.classList.toggle("hidden", !show);
    });

    document.getElementById("btn-publish-task")?.addEventListener("click", async () => {
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

      const teamId = session.role === "admin" ? RaceStore.designerTeamId() : session.teamId;

      RaceStore.createTask({
        title,
        description: document.getElementById("task-desc").value,
        type,
        duration: document.getElementById("task-duration").value,
        maxPoints: parseInt(document.getElementById("task-points").value, 10) || 10,
        createdByTeamId: teamId,
        quizOptions,
        quizCorrect,
      });
      await RaceStore.persist();
      toast("Challenge is live!");
      render();
    });
  }

  function bindSubmission(state) {
    const team = RaceStore.getTeam(session.teamId);
    const task = RaceStore.getCurrentTask();
    if (!task || !team) return;

    let photoFile = null;
    let photoDataUrl = null;

    const zone = document.getElementById("upload-zone");
    const input = document.getElementById("photo-input");
    const preview = document.getElementById("preview");

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
      };
      reader.readAsDataURL(file);
    }

    document.querySelectorAll(".quiz-option").forEach((label) => {
      label.addEventListener("click", () => {
        document.querySelectorAll(".quiz-option").forEach((l) => l.classList.remove("selected"));
        label.classList.add("selected");
        label.querySelector("input").checked = true;
      });
    });

    document.getElementById("btn-submit-task")?.addEventListener("click", async () => {
      const quizEl = document.querySelector('input[name="quiz"]:checked');
      const quizAnswer = quizEl ? parseInt(quizEl.value, 10) : null;
      const textAnswer = document.getElementById("text-answer")?.value || null;

      if ((task.type === "photo" || task.type === "combo") && !photoDataUrl) {
        const existing = RaceStore.getSubmission(task.id, team.id);
        if (!existing?.photoUrl) {
          toast("Please upload a photo", "error");
          return;
        }
      }

      try {
        await RaceStore.submitTask(team.id, task.id, {
          photoFile,
          photoDataUrl,
          quizAnswer,
          textAnswer,
        });
        toast("Submitted!");
        render();
      } catch (e) {
        toast("Upload failed — try a smaller photo", "error");
        console.error(e);
      }
    });
  }

  function bindComments() {
    document.getElementById("btn-comment")?.addEventListener("click", async () => {
      const task = RaceStore.getCurrentTask();
      const text = document.getElementById("comment-text")?.value;
      if (!task || !text?.trim()) return;
      RaceStore.addComment(task.id, session.teamId, session.teamName, text);
      await RaceStore.persist();
      render();
    });
  }

  function bindScoring() {
    document.getElementById("btn-auto-score")?.addEventListener("click", async () => {
      const taskId = document.getElementById("btn-auto-score").dataset.task;
      RaceStore.autoScoreTask(taskId);
      await RaceStore.persist();
      toast("Auto-scored (quiz = exact match, photo = full points)");
      render();
    });

    document.getElementById("btn-save-scores")?.addEventListener("click", async () => {
      document.querySelectorAll(".score-input").forEach((inp) => {
        const subId = inp.dataset.subId;
        const val = inp.value === "" ? null : parseInt(inp.value, 10);
        if (subId && val != null) RaceStore.scoreSubmission(subId, val);
      });
      await RaceStore.persist();
      toast("Scores saved");
      render();
    });

    document.getElementById("btn-next-round")?.addEventListener("click", async () => {
      const taskId = document.getElementById("btn-next-round").dataset.task;
      const task = RaceStore.getTask(taskId);
      if (task) task.status = "closed";
      RaceStore.advanceAfterScoring();
      RaceStore._state.race.currentTaskId = null;
      await RaceStore.persist();
      toast("Next team’s turn to design a challenge");
      render();
    });
  }

  /* ---------- Init ---------- */

  async function init() {
    session = loadSession();
    await RaceStore.init();
    RaceStore.subscribe(() => render());

    tickTimer = setInterval(async () => {
      const expired = RaceStore.expireTaskIfNeeded();
      if (expired) {
        await RaceStore.persist();
        render();
        if (session?.role === "admin") toast(`"${expired.title}" ended — time to score!`);
      } else if (session && RaceStore.getCurrentTask()) {
        const task = RaceStore.getCurrentTask();
        const el = document.querySelector(".countdown");
        if (el && task) {
          const tmp = document.createElement("div");
          tmp.innerHTML = renderCountdown(task.endsAt);
          el.replaceWith(tmp.firstElementChild);
        }
      }

      const state = RaceStore.getState();
      if (state.race.status === "active" && state.race.endAt && Date.now() > state.race.endAt) {
        RaceStore.endRace();
        await RaceStore.persist();
        render();
      }
    }, 1000);

    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
