/**
 * Race data store — Firebase when configured, else localStorage (single-browser demo).
 */
(function (global) {
  const STORAGE_KEY = "croatia_race_v1";
  const cfg = () => global.RACE_CONFIG || {};

  let db = null;
  let storage = null;
  let unsub = null;

  function uid() {
    return crypto.randomUUID?.() || "id-" + Math.random().toString(36).slice(2, 11);
  }

  function defaultRace() {
    const now = Date.now();
    return {
      id: "race-main",
      name: cfg().raceName || "Family Amazing Race",
      status: "setup",
      startAt: null,
      endAt: null,
      teamOrder: [],
      designerIndex: 0,
      currentTaskId: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  function emptyState() {
    return {
      race: defaultRace(),
      teams: [],
      tasks: [],
      submissions: [],
      comments: [],
    };
  }

  function initFirebase() {
    const fb = cfg().firebase;
    if (!fb || !global.firebase) return false;
    try {
      if (!global._raceApp) {
        global._raceApp = global.firebase.initializeApp(fb);
      }
      db = global.firebase.firestore();
      storage = global.firebase.storage();
      return true;
    } catch (e) {
      console.warn("Firebase init failed", e);
      return false;
    }
  }

  function useFirebase() {
    return !!db;
  }

  function loadLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyState();
      return JSON.parse(raw);
    } catch {
      return emptyState();
    }
  }

  function saveLocal(state) {
    state.race.updatedAt = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  async function loadCloud() {
    const doc = await db.collection("races").doc("main").get();
    if (!doc.exists) {
      const s = emptyState();
      await db.collection("races").doc("main").set(s);
      return s;
    }
    return doc.data();
  }

  async function saveCloud(state) {
    state.race.updatedAt = Date.now();
    await db.collection("races").doc("main").set(state);
  }

  const Store = {
    _state: emptyState(),
    _listeners: [],

    async init() {
      if (initFirebase()) {
        this._state = await loadCloud();
        unsub = db.collection("races").doc("main").onSnapshot((snap) => {
          if (snap.exists) {
            this._state = snap.data();
            this._notify();
          }
        });
      } else {
        this._state = loadLocal();
      }
      return this._state;
    },

    getState() {
      return this._state;
    },

    async persist() {
      if (useFirebase()) await saveCloud(this._state);
      else saveLocal(this._state);
      this._notify();
    },

    subscribe(fn) {
      this._listeners.push(fn);
      return () => {
        this._listeners = this._listeners.filter((f) => f !== fn);
      };
    },

    _notify() {
      this._listeners.forEach((f) => f(this._state));
    },

    destroy() {
      if (unsub) unsub();
    },

    /* --- Teams --- */
    addTeam(name, members, color) {
      const code = Math.random().toString(36).slice(2, 8).toUpperCase();
      const team = {
        id: uid(),
        name: name.trim(),
        members: members.filter(Boolean).map((m) => m.trim()),
        code,
        color: color || randomColor(),
        points: 0,
        createdAt: Date.now(),
      };
      this._state.teams.push(team);
      if (!this._state.race.teamOrder.includes(team.id)) {
        this._state.race.teamOrder.push(team.id);
      }
      return team;
    },

    removeTeam(teamId) {
      this._state.teams = this._state.teams.filter((t) => t.id !== teamId);
      this._state.race.teamOrder = this._state.race.teamOrder.filter((id) => id !== teamId);
    },

    findTeamByCode(code) {
      return this._state.teams.find(
        (t) => t.code.toUpperCase() === String(code).trim().toUpperCase()
      );
    },

    getTeam(id) {
      return this._state.teams.find((t) => t.id === id);
    },

    /* --- Race lifecycle --- */
    configureRace({ name, startAt, endAt }) {
      const r = this._state.race;
      if (name) r.name = name;
      r.startAt = startAt ? new Date(startAt).getTime() : r.startAt;
      r.endAt = endAt ? new Date(endAt).getTime() : r.endAt;
      r.status = "scheduled";
    },

    startRace() {
      const r = this._state.race;
      r.status = "active";
      if (!r.startAt) r.startAt = Date.now();
      if (r.teamOrder.length && !r.currentTaskId) {
        r.designerIndex = 0;
      }
    },

    endRace() {
      this._state.race.status = "ended";
      const sorted = [...this._state.teams].sort((a, b) => b.points - a.points);
      this._state.race.winnerId = sorted[0]?.id || null;
    },

    /* --- Tasks --- */
    createTask(payload) {
      const durationMs = durationToMs(payload.duration);
      const startsAt = Date.now();
      const task = {
        id: uid(),
        title: payload.title,
        description: payload.description || "",
        type: payload.type || "photo",
        duration: payload.duration || "1d",
        startsAt,
        endsAt: startsAt + durationMs,
        createdByTeamId: payload.createdByTeamId,
        quizOptions: payload.quizOptions || [],
        quizCorrect: payload.quizCorrect ?? null,
        maxPoints: payload.maxPoints ?? 10,
        status: "active",
      };
      this._state.tasks.push(task);
      this._state.race.currentTaskId = task.id;
      return task;
    },

    getCurrentTask() {
      const id = this._state.race.currentTaskId;
      return this._state.tasks.find((t) => t.id === id && t.status === "active");
    },

    getTask(id) {
      return this._state.tasks.find((t) => t.id === id);
    },

    expireTaskIfNeeded() {
      const task = this.getCurrentTask();
      if (!task || Date.now() < task.endsAt) return null;
      task.status = "scoring";
      this._state.race.currentTaskId = null;
      return task;
    },

    advanceAfterScoring() {
      const r = this._state.race;
      if (r.teamOrder.length) {
        r.designerIndex = (r.designerIndex + 1) % r.teamOrder.length;
      }
    },

    designerTeamId() {
      const r = this._state.race;
      return r.teamOrder[r.designerIndex] || null;
    },

    /* --- Submissions --- */
    getSubmission(taskId, teamId) {
      return this._state.submissions.find(
        (s) => s.taskId === taskId && s.teamId === teamId
      );
    },

    async submitTask(teamId, taskId, data) {
      let photoUrl = data.photoDataUrl || null;
      if (data.photoFile && useFirebase() && storage) {
        const ref = storage.ref(`photos/${taskId}/${teamId}_${Date.now()}.jpg`);
        await ref.put(data.photoFile);
        photoUrl = await ref.getDownloadURL();
      } else if (data.photoDataUrl) {
        photoUrl = await compressDataUrl(data.photoDataUrl, cfg().maxPhotoBytes || 800000);
      }

      let existing = this.getSubmission(taskId, teamId);
      if (existing) {
        Object.assign(existing, {
          photoUrl,
          quizAnswer: data.quizAnswer,
          textAnswer: data.textAnswer,
          submittedAt: Date.now(),
        });
      } else {
        existing = {
          id: uid(),
          taskId,
          teamId,
          photoUrl,
          quizAnswer: data.quizAnswer,
          textAnswer: data.textAnswer,
          points: null,
          scoredAt: null,
          submittedAt: Date.now(),
        };
        this._state.submissions.push(existing);
      }
      await this.persist();
      return existing;
    },

    scoreSubmission(submissionId, points) {
      const sub = this._state.submissions.find((s) => s.id === submissionId);
      if (!sub) return;
      const prev = sub.points || 0;
      sub.points = points;
      sub.scoredAt = Date.now();
      const team = this.getTeam(sub.teamId);
      if (team) team.points = (team.points || 0) - prev + points;
    },

    allScoredForTask(taskId) {
      const task = this.getTask(taskId);
      if (!task) return true;
      const activeTeams = this._state.teams;
      return activeTeams.every((t) => {
        const s = this.getSubmission(taskId, t.id);
        return s && s.points != null;
      });
    },

    autoScoreTask(taskId) {
      const task = this.getTask(taskId);
      if (!task) return;
      this._state.teams.forEach((team) => {
        const sub = this.getSubmission(taskId, team.id);
        if (!sub) return;
        if (sub.points != null) return;
        let pts = 5;
        if (task.type === "quiz" && task.quizCorrect != null) {
          pts = sub.quizAnswer === task.quizCorrect ? task.maxPoints : 0;
        } else if (sub.photoUrl) {
          pts = task.maxPoints;
        } else if (sub.textAnswer) {
          pts = Math.round(task.maxPoints * 0.6);
        }
        this.scoreSubmission(sub.id, pts);
      });
    },

    /* --- Comments --- */
    addComment(taskId, teamId, author, text) {
      this._state.comments.push({
        id: uid(),
        taskId,
        teamId,
        author,
        text: text.trim(),
        at: Date.now(),
      });
    },

    getComments(taskId) {
      return this._state.comments
        .filter((c) => c.taskId === taskId)
        .sort((a, b) => a.at - b.at);
    },

    /* --- Utils --- */
    exportState() {
      return JSON.stringify(this._state, null, 2);
    },

    async importState(json) {
      this._state = JSON.parse(json);
      await this.persist();
    },

    resetAll() {
      this._state = emptyState();
      return this.persist();
    },
  };

  function durationToMs(d) {
    const map = { "1d": 86400000, "1w": 604800000, "1month": 2592000000 };
    return map[d] || 86400000;
  }

  function randomColor() {
    const colors = ["#1a5f7a", "#e85d04", "#4a6741", "#9b2226", "#7b2cbf", "#0077b6"];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  function compressDataUrl(dataUrl, maxBytes) {
    return new Promise((resolve) => {
      if (dataUrl.length * 0.75 < maxBytes) {
        resolve(dataUrl);
        return;
      }
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let w = img.width;
        let h = img.height;
        const scale = Math.min(1, 1200 / Math.max(w, h));
        w = Math.round(w * scale);
        h = Math.round(h * scale);
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        let q = 0.85;
        let out = canvas.toDataURL("image/jpeg", q);
        while (out.length * 0.75 > maxBytes && q > 0.35) {
          q -= 0.1;
          out = canvas.toDataURL("image/jpeg", q);
        }
        resolve(out);
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  global.RaceStore = Store;
  global.durationLabel = function (d) {
    return { "1d": "24 hours", "1w": "7 days", "1month": "30 days" }[d] || d;
  };
})(window);
