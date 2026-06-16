/**
 * Race data store — Firebase when configured, else localStorage (single-browser demo).
 */
(function (global) {
  const STORAGE_KEY = "croatia_race_v2";
  const MAX_TEAMS = 5;
  const MIN_TEAMS = 2;
  const UPLOAD_POINTS = [100, 80, 60, 40, 20];

  const cfg = () => global.RACE_CONFIG || {};

  let db = null;
  let unsub = null;
  let photoUnsub = null;
  let _photoMap = {};

  function photoDocId(taskId, teamId) {
    return `${taskId}_${teamId}`;
  }

  function photosCollection() {
    return db.collection("races").doc("main").collection("photos");
  }

  function applyPhotoMap(state, photoMap) {
    if (!state?.submissions) return;
    state.submissions.forEach((sub) => {
      const url = photoMap[photoDocId(sub.taskId, sub.teamId)];
      if (url) sub.photoUrl = url;
    });
  }

  function stripPhotos(state) {
    const copy = JSON.parse(JSON.stringify(state));
    (copy.submissions || []).forEach((s) => {
      delete s.photoUrl;
    });
    return copy;
  }

  async function loadPhotoMap() {
    try {
      const map = {};
      const snap = await photosCollection().get();
      snap.forEach((doc) => {
        const data = doc.data();
        if (data?.photoUrl) map[doc.id] = data.photoUrl;
      });
      return map;
    } catch (e) {
      console.warn("Could not load photos from Firestore", e);
      return {};
    }
  }

  async function savePhotosToCloud(state) {
    try {
      const batch = db.batch();
      let count = 0;
      (state.submissions || []).forEach((sub) => {
        if (!sub.photoUrl) return;
        const ref = photosCollection().doc(photoDocId(sub.taskId, sub.teamId));
        batch.set(ref, {
          photoUrl: sub.photoUrl,
          taskId: sub.taskId,
          teamId: sub.teamId,
          updatedAt: Date.now(),
        });
        count++;
      });
      if (count) await batch.commit();
    } catch (e) {
      console.warn("Could not save photos to Firestore", e);
      throw new Error("Photo save failed — deploy Firestore rules: firebase deploy --only firestore:rules");
    }
  }

  async function deleteAllPhotos() {
    const snap = await photosCollection().get();
    if (snap.empty) return;
    const batch = db.batch();
    snap.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    _photoMap = {};
  }

  async function migrateInlinePhotos(state) {
    try {
      const toMigrate = (state.submissions || []).filter((s) => s.photoUrl);
      if (!toMigrate.length) return;
      const batch = db.batch();
      toMigrate.forEach((sub) => {
        const id = photoDocId(sub.taskId, sub.teamId);
        batch.set(photosCollection().doc(id), {
          photoUrl: sub.photoUrl,
          taskId: sub.taskId,
          teamId: sub.teamId,
          updatedAt: Date.now(),
        });
        _photoMap[id] = sub.photoUrl;
      });
      await batch.commit();
      await db.collection("races").doc("main").set(stripPhotos(state));
    } catch (e) {
      console.warn("Photo migration skipped", e);
    }
  }

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
      currentTaskId: null,
      taskQueueIndex: 0,
      winnerId: null,
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
      archivedRaces: [],
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
      if (!raw) {
        const legacy = localStorage.getItem("croatia_race_v1");
        if (legacy) return migrateState(JSON.parse(legacy));
        return emptyState();
      }
      return JSON.parse(raw);
    } catch {
      return emptyState();
    }
  }

  function migrateState(old) {
    const s = emptyState();
    s.race = { ...s.race, ...old.race, taskQueueIndex: 0 };
    delete s.race.designerIndex;
    delete s.race.teamOrder;
    s.teams = old.teams || [];
    s.tasks = (old.tasks || []).map((t, i) => ({
      ...t,
      order: t.order ?? i,
      status: t.status === "active" ? "closed" : t.status === "scoring" ? "closed" : t.status || "closed",
    }));
    s.submissions = old.submissions || [];
    s.comments = old.comments || [];
    s.archivedRaces = old.archivedRaces || [];
    return s;
  }

  function saveLocal(state) {
    state.race.updatedAt = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  async function loadCloud() {
    const doc = await db.collection("races").doc("main").get();
    if (!doc.exists) {
      const s = emptyState();
      await db.collection("races").doc("main").set(stripPhotos(s));
      return s;
    }
    const state = doc.data();
    _photoMap = await loadPhotoMap();
    applyPhotoMap(state, _photoMap);
    if ((state.submissions || []).some((s) => s.photoUrl)) {
      await migrateInlinePhotos(state);
      applyPhotoMap(state, _photoMap);
    }
    return state;
  }

  async function saveCloud(state) {
    await savePhotosToCloud(state);
    const stripped = stripPhotos(state);
    stripped.race.updatedAt = Date.now();
    await db.collection("races").doc("main").set(stripped);
  }

  function durationToMs(d) {
    const map = {
      "30m": 1800000,
      "1h": 3600000,
      "1d": 86400000,
      "1w": 604800000,
      "1month": 2592000000,
    };
    return map[d] || 86400000;
  }

  function roundToHour(ts) {
    if (ts == null) return null;
    const d = new Date(ts);
    d.setMinutes(0, 0, 0);
    return d.getTime();
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

  function pointsForUploadRank(rank) {
    return UPLOAD_POINTS[rank] ?? 0;
  }

  function recalculateTeamPoints(state) {
    state.teams.forEach((t) => {
      t.points = 0;
    });
    state.submissions.forEach((s) => {
      if (s.points == null) return;
      const team = state.teams.find((t) => t.id === s.teamId);
      if (team) team.points += s.points;
    });
  }

  function mergeSubmissions(a, b) {
    const map = new Map();
    [...(a || []), ...(b || [])].forEach((s) => {
      const k = `${s.taskId}-${s.teamId}`;
      const ex = map.get(k);
      if (!ex) {
        map.set(k, { ...s });
        return;
      }
      map.set(k, {
        ...ex,
        ...s,
        photoUrl: s.photoUrl || ex.photoUrl,
        comment: s.comment || ex.comment,
        points: s.points != null ? s.points : ex.points,
        submittedAt: Math.max(s.submittedAt || 0, ex.submittedAt || 0),
      });
    });
    return [...map.values()];
  }

  function mergeTasks(a, b) {
    const rank = { closed: 3, active: 2, scoring: 2, pending: 1 };
    const map = new Map();
    [...(a || []), ...(b || [])].forEach((t) => {
      const ex = map.get(t.id);
      if (!ex) {
        map.set(t.id, { ...t });
        return;
      }
      const pick = (rank[t.status] || 0) >= (rank[ex.status] || 0) ? t : ex;
      map.set(t.id, { ...ex, ...pick });
    });
    return [...map.values()];
  }

  function mergeTeams(a, b) {
    const map = new Map((a || []).map((t) => [t.id, { ...t }]));
    (b || []).forEach((t) => {
      const ex = map.get(t.id);
      map.set(t.id, ex ? { ...ex, ...t, code: ex.code, color: ex.color } : { ...t });
    });
    return [...map.values()];
  }

  function mergeArchived(a, b) {
    const map = new Map();
    [...(a || []), ...(b || [])].forEach((ar) => {
      const ex = map.get(ar.id);
      if (!ex || (ar.archivedAt || 0) >= (ex.archivedAt || 0)) {
        map.set(ar.id, ar);
      }
    });
    return [...map.values()].sort((x, y) => (x.archivedAt || 0) - (y.archivedAt || 0));
  }

  function mergeComments(a, b) {
    const map = new Map();
    [...(a || []), ...(b || [])].forEach((c) => {
      if (c?.id) map.set(c.id, c);
    });
    return [...map.values()].sort((x, y) => (x.at || 0) - (y.at || 0));
  }

  function mergeStates(disk, memory) {
    const d = disk || emptyState();
    const m = memory || emptyState();
    const diskRaceNewer = (d.race?.updatedAt || 0) >= (m.race?.updatedAt || 0);
    const merged = {
      race: diskRaceNewer ? { ...m.race, ...d.race } : { ...d.race, ...m.race },
      teams: mergeTeams(d.teams, m.teams),
      tasks: mergeTasks(d.tasks, m.tasks),
      submissions: mergeSubmissions(d.submissions, m.submissions),
      comments: mergeComments(d.comments, m.comments),
      archivedRaces: mergeArchived(d.archivedRaces, m.archivedRaces),
    };
    merged.race.updatedAt = Math.max(d.race?.updatedAt || 0, m.race?.updatedAt || 0);
    recalculateTeamPoints(merged);
    return merged;
  }

  function stateSignature(state) {
    const s = JSON.parse(JSON.stringify(state));
    if (s.race) delete s.race.updatedAt;
    return JSON.stringify(s);
  }

  function getWinners(state) {
    const sorted = [...state.teams].sort((a, b) => (b.points || 0) - (a.points || 0));
    if (!sorted.length) return [];
    const top = sorted[0].points || 0;
    if (top <= 0) return [];
    return sorted.filter((t) => (t.points || 0) === top);
  }

  function rankTeams(state) {
    const sorted = [...state.teams].sort((a, b) => (b.points || 0) - (a.points || 0));
    let lastPts = null;
    let rank = 0;
    return sorted.map((t, i) => {
      if ((t.points || 0) !== lastPts) {
        rank = i + 1;
        lastPts = t.points || 0;
      }
      return { team: t, rank };
    });
  }

  function medalForRank(rank) {
    if (rank === 1) return "🏆";
    if (rank === 2) return "🥈";
    if (rank === 3) return "🥉";
    return "";
  }

  const Store = {
    _state: emptyState(),
    _listeners: [],
    _notifyTimer: null,
    _persisting: false,

    MAX_TEAMS,
    MIN_TEAMS,
    UPLOAD_POINTS,

    async init() {
      if (initFirebase()) {
        this._state = await loadCloud();
        if (this._healRaceState()) await this.persist();
        unsub = db.collection("races").doc("main").onSnapshot((snap) => {
          if (!snap.exists || this._persisting) return;
          this._state = mergeStates(snap.data(), this._state);
          applyPhotoMap(this._state, _photoMap);
          const healed = this._healRaceState();
          if (healed && !this._persisting) this.persist();
          this._notify();
        });
        photoUnsub = photosCollection().onSnapshot(
          (snap) => {
            _photoMap = {};
            snap.forEach((doc) => {
              const data = doc.data();
              if (data?.photoUrl) _photoMap[doc.id] = data.photoUrl;
            });
            if (this._state) {
              applyPhotoMap(this._state, _photoMap);
              this._notify();
            }
          },
          (err) => console.warn("Photos listener error", err)
        );
      } else {
        this._state = loadLocal();
        this._healRaceState();
        window.addEventListener("storage", (e) => {
          if (e.key === STORAGE_KEY) this.syncFromDisk();
        });
      }
      return this._state;
    },

    getState() {
      return this._state;
    },

    async _mergeRemoteState() {
      if (!useFirebase()) return;
      const doc = await db.collection("races").doc("main").get();
      if (doc.exists) {
        this._state = mergeStates(doc.data(), this._state);
        applyPhotoMap(this._state, _photoMap);
        this._healRaceState();
        recalculateTeamPoints(this._state);
      }
    },

    async persist() {
      if (useFirebase()) {
        this._persisting = true;
        try {
          await this._mergeRemoteState();
          await saveCloud(this._state);
        } finally {
          this._persisting = false;
        }
      } else {
        const disk = loadLocal();
        this._state = mergeStates(disk, this._state);
        saveLocal(this._state);
      }
      this._notify();
    },

    syncFromDisk() {
      if (useFirebase()) return false;
      const disk = loadLocal();
      const merged = mergeStates(disk, this._state);
      const changed = stateSignature(merged) !== stateSignature(this._state);
      if (changed) {
        this._state = merged;
        this._healRaceState();
        this._notify();
      }
      return changed;
    },

    async refreshBeforeAction() {
      if (useFirebase()) {
        await this._mergeRemoteState();
        return;
      }
      const disk = loadLocal();
      this._state = mergeStates(disk, this._state);
      recalculateTeamPoints(this._state);
    },

    subscribe(fn) {
      this._listeners.push(fn);
      return () => {
        this._listeners = this._listeners.filter((f) => f !== fn);
      };
    },

    _notify() {
      if (this._notifyTimer) clearTimeout(this._notifyTimer);
      this._notifyTimer = setTimeout(() => {
        this._listeners.forEach((f) => f(this._state));
      }, 120);
    },

    destroy() {
      if (unsub) unsub();
      if (photoUnsub) photoUnsub();
    },

  /* --- Teams --- */
    addTeam(name, members, color) {
      if (this._state.teams.length >= MAX_TEAMS) {
        throw new Error(`Maximum ${MAX_TEAMS} teams`);
      }
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
      return team;
    },

    removeTeam(teamId) {
      if (this._state.race.status !== "setup" && this._state.race.status !== "scheduled") {
        throw new Error("Cannot remove teams after race has started");
      }
      this._state.teams = this._state.teams.filter((t) => t.id !== teamId);
    },

    updateTeam(teamId, { name, members }) {
      if (this.isRaceEnded()) {
        throw new Error("Cannot edit teams after race has ended");
      }
      const team = this.getTeam(teamId);
      if (!team) throw new Error("Team not found");
      if (name != null) team.name = String(name).trim();
      if (members != null) {
        const m = members.filter(Boolean).map((x) => String(x).trim());
        if (m.length < 2 || m.length > 4) {
          throw new Error("Teams need 2–4 members");
        }
        team.members = m;
      }
      return team;
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
      if (r.status === "active" || r.status === "ended") return;
      if (name !== undefined && name !== null) r.name = String(name).trim() || r.name;
      if (startAt !== undefined) {
        r.startAt = startAt === null ? null : roundToHour(typeof startAt === "number" ? startAt : new Date(startAt).getTime());
      }
      if (endAt !== undefined) {
        r.endAt = endAt === null ? null : roundToHour(typeof endAt === "number" ? endAt : new Date(endAt).getTime());
      }
      if (r.startAt && r.endAt && r.endAt <= r.startAt) {
        throw new Error("End must be after start");
      }
      r.updatedAt = Date.now();
      this._recapPendingTasks();
    },

    _validateRaceReady() {
      if (this._state.teams.length < MIN_TEAMS) {
        throw new Error(`Add at least ${MIN_TEAMS} teams`);
      }
      const pending = this.getScheduledTasks().filter((t) => t.status === "pending");
      if (!pending.length) {
        throw new Error("Add at least one challenge before starting");
      }
      const r = this._state.race;
      if (!r.startAt || !r.endAt) {
        throw new Error("Set start and end before starting the race");
      }
      if (r.endAt <= r.startAt) {
        throw new Error("End must be after start");
      }
    },

    scheduleRaceStart() {
      this._validateRaceReady();
      const r = this._state.race;
      if (r.status === "active") throw new Error("Race is already running");
      if (r.status === "scheduled") throw new Error("Race is already scheduled");
      if (r.startAt <= Date.now()) {
        throw new Error("Scheduled start must be in the future — use Start now to begin immediately");
      }
      r.status = "scheduled";
      r.updatedAt = Date.now();
    },

    checkAutoStart() {
      const r = this._state.race;
      if (r.status !== "scheduled" || !r.startAt || Date.now() < r.startAt) return false;
      r.status = "active";
      this._activateNextTask();
      return true;
    },

    _recapPendingTasks() {
      const r = this._state.race;
      if (!r.endAt) return;
      this.getScheduledTasks().forEach((task) => {
        if (task.status !== "pending") return;
        const startsAt = task.startsAt || r.startAt || Date.now();
        const naturalEnd = startsAt + durationToMs(task.duration);
        task.endsAt = Math.min(naturalEnd, r.endAt);
      });
    },

    startRace() {
      return this.startRaceNow();
    },

    startRaceNow() {
      this._validateRaceReady();
      const r = this._state.race;
      if (r.status === "active") throw new Error("Race is already running");
      if (r.status === "ended") throw new Error("Race has ended — use Continue race to resume");
      r.status = "active";
      r.startAt = Date.now();
      r.updatedAt = Date.now();
      this._activateNextTask();
    },

    async endRace() {
      await this.refreshBeforeAction();
      const r = this._state.race;
      r.status = "ended";
      this._state.tasks.forEach((t) => {
        if (t.status === "active") {
          t.status = "closed";
          this._finalizeTaskScores(t.id);
        }
      });
      r.currentTaskId = null;
      recalculateTeamPoints(this._state);
      const winners = getWinners(this._state);
      r.winnerIds = winners.map((w) => w.id);
      r.winnerId = winners[0]?.id || null;
    },

    archiveCurrentRace() {
      if (!this._state.archivedRaces) this._state.archivedRaces = [];
      this._state.archivedRaces.push({
        id: this._state.race.id || uid(),
        archivedAt: Date.now(),
        race: JSON.parse(JSON.stringify(this._state.race)),
        teams: JSON.parse(JSON.stringify(this._state.teams)),
        tasks: JSON.parse(JSON.stringify(this._state.tasks)),
        submissions: JSON.parse(JSON.stringify(this._state.submissions)),
        comments: JSON.parse(JSON.stringify(this._state.comments)),
      });
    },

    async newRace() {
      const hadContent =
        this._state.tasks.length > 0 ||
        this._state.submissions.length > 0 ||
        ["active", "ended", "scheduled"].includes(this._state.race.status);

      if (hadContent) this.archiveCurrentRace();

      const keptTeams = this._state.teams.map((t) => ({ ...t, points: 0 }));
      const prevName = this._state.race.name;

      this._state.race = defaultRace();
      this._state.race.name = prevName;
      this._state.teams = keptTeams;
      this._state.tasks = [];
      this._state.submissions = [];
      this._state.comments = [];

      return this.persist();
    },

    async continueRace() {
      const r = this._state.race;
      if (r.status !== "ended") throw new Error("Race is not ended");

      const pending = this.getScheduledTasks().filter((t) => t.status === "pending");
      if (!pending.length) throw new Error("No remaining challenges to continue");

      r.status = "active";
      r.winnerId = null;
      r.winnerIds = [];
      r.updatedAt = Date.now();

      if (r.endAt && Date.now() >= r.endAt) {
        r.endAt = Date.now() + durationToMs("1d");
      }

      this._activateNextTask();
      return this.persist();
    },

    getPendingTaskCount() {
      return this.getScheduledTasks().filter((t) => t.status === "pending").length;
    },

    getRemainingTaskCount() {
      return this.getScheduledTasks().filter(
        (t) => t.status === "active" || t.status === "pending"
      ).length;
    },

    getArchivedRacesCount() {
      return (this._state.archivedRaces || []).length;
    },

    isRaceEnded() {
      return this._state.race.status === "ended";
    },

    isRaceActive() {
      return this._state.race.status === "active";
    },

    canEditSetup() {
      return this._state.race.status === "setup" || this._state.race.status === "scheduled";
    },

  /* --- Tasks (admin-scheduled) --- */
    getScheduledTasks() {
      return [...this._state.tasks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    },

    addScheduledTask(payload) {
      if (!this.canEditSetup()) {
        throw new Error("Cannot add challenges after race has started");
      }
      const order = this._state.tasks.length;
      const r = this._state.race;
      const startsAt = r.startAt || Date.now();
      const naturalEnd = startsAt + durationToMs(payload.duration || "1d");
      const endsAt = r.endAt ? Math.min(naturalEnd, r.endAt) : naturalEnd;

      const task = {
        id: uid(),
        title: payload.title,
        description: payload.description || "",
        type: payload.type || "photo",
        duration: payload.duration || "1d",
        order,
        startsAt: null,
        endsAt,
        quizOptions: payload.quizOptions || [],
        quizCorrect: payload.quizCorrect ?? null,
        status: "pending",
      };
      this._state.tasks.push(task);
      this._state.race.updatedAt = Date.now();
      return task;
    },

    removeScheduledTask(taskId) {
      if (!this.canEditSetup()) throw new Error("Cannot remove challenges after race started");
      this._state.tasks = this._state.tasks.filter((t) => t.id !== taskId);
      this._state.tasks.forEach((t, i) => {
        t.order = i;
      });
      this._state.race.updatedAt = Date.now();
    },

    reorderScheduledTasks(orderedIds) {
      if (!this.canEditSetup()) {
        throw new Error("Cannot reorder challenges after race has started");
      }
      const tasks = this.getScheduledTasks();
      if (orderedIds.length !== tasks.length) {
        throw new Error("Invalid challenge order");
      }
      const idSet = new Set(tasks.map((t) => t.id));
      orderedIds.forEach((id) => {
        if (!idSet.has(id)) throw new Error("Invalid challenge");
      });
      orderedIds.forEach((id, i) => {
        const task = this.getTask(id);
        if (task) task.order = i;
      });
      this._state.race.updatedAt = Date.now();
    },

    canRequeueTask(task) {
      const r = this._state.race;
      if (task.status === "closed" && !task.startsAt) return true;
      if (task.status === "pending" && r.status === "ended") return true;
      return false;
    },

    requeueTask(taskId) {
      const task = this.getTask(taskId);
      if (!task || !this.canRequeueTask(task)) {
        throw new Error("This challenge cannot be requeued");
      }

      const tasks = this.getScheduledTasks();
      const maxOrder = tasks.reduce((m, t) => Math.max(m, t.order ?? 0), -1);
      task.order = maxOrder + 1;
      task.status = "pending";
      task.startsAt = null;

      const r = this._state.race;
      const base = r.startAt || Date.now();
      const naturalEnd = base + durationToMs(task.duration);
      task.endsAt = r.endAt ? Math.min(naturalEnd, r.endAt) : naturalEnd;

      return task;
    },

    _healRaceState() {
      const r = this._state.race;
      if (!r) return false;
      let changed = false;
      const ordered = this.getScheduledTasks();
      let active = ordered.filter((t) => t.status === "active");

      if (active.length > 1) {
        const keep =
          (r.currentTaskId && active.find((t) => t.id === r.currentTaskId)) || active[0];
        active.forEach((t) => {
          if (t.id !== keep.id) {
            t.status = "closed";
            if (t.startsAt) this._finalizeTaskScores(t.id);
            changed = true;
          }
        });
        if (r.currentTaskId !== keep.id) {
          r.currentTaskId = keep.id;
          changed = true;
        }
        active = [keep];
      } else if (active.length === 1 && r.currentTaskId !== active[0].id) {
        r.currentTaskId = active[0].id;
        changed = true;
      }

      if (active.length > 0 && (r.status === "setup" || r.status === "scheduled")) {
        r.status = "active";
        r.updatedAt = Date.now();
        changed = true;
      }

      if (r.status === "active" && active.length === 0) {
        const pending = ordered.find((t) => t.status === "pending");
        if (pending) {
          this._activateNextTask();
          changed = true;
        }
      }

      if (changed) recalculateTeamPoints(this._state);
      return changed;
    },

    _activateNextTask() {
      this.getScheduledTasks()
        .filter((t) => t.status === "active")
        .forEach((t) => {
          t.status = "closed";
          if (t.startsAt) this._finalizeTaskScores(t.id);
        });

      const task = this.getScheduledTasks().find((t) => t.status === "pending");
      if (!task) {
        this._state.race.currentTaskId = null;
        return null;
      }

      const r = this._state.race;
      const now = Date.now();
      const startsAt = Math.max(now, r.startAt || now);
      const naturalEnd = startsAt + durationToMs(task.duration);
      const endsAt = r.endAt ? Math.min(naturalEnd, r.endAt) : naturalEnd;

      if (r.endAt && startsAt >= r.endAt) {
        task.status = "closed";
        return this._activateNextTask();
      }

      task.status = "active";
      task.startsAt = startsAt;
      task.endsAt = endsAt;
      r.currentTaskId = task.id;
      r.updatedAt = Date.now();
      return task;
    },

    getCurrentTask() {
      const id = this._state.race.currentTaskId;
      let task = this._state.tasks.find((t) => t.id === id && t.status === "active");
      if (task) return task;
      const active = this.getScheduledTasks().filter((t) => t.status === "active");
      if (active.length === 1) {
        this._state.race.currentTaskId = active[0].id;
        return active[0];
      }
      return null;
    },

    getTask(id) {
      return this._state.tasks.find((t) => t.id === id);
    },

    getActiveOrRecentTask() {
      return this.getCurrentTask() || this.getScheduledTasks().filter((t) => t.status === "closed").pop();
    },

    async expireTaskIfNeeded() {
      const task = this.getCurrentTask();
      if (!task || Date.now() < task.endsAt) return null;
      return this.endTaskEarly();
    },

    async endTaskEarly() {
      await this.refreshBeforeAction();
      const task = this.getCurrentTask();
      if (!task) return null;
      task.status = "closed";
      this._finalizeTaskScores(task.id);
      this._state.race.currentTaskId = null;
      recalculateTeamPoints(this._state);

      const r = this._state.race;
      if (r.endAt && Date.now() >= r.endAt) {
        this.endRace();
        return task;
      }

      const next = this._activateNextTask();
      if (!next && r.status === "active") {
        this.endRace();
      }
      return task;
    },

    _getUploadRank(taskId, teamId) {
      const subs = this._state.submissions
        .filter((s) => s.taskId === taskId && s.submittedAt)
        .sort((a, b) => a.submittedAt - b.submittedAt);
      return subs.findIndex((s) => s.teamId === teamId);
    },

    _scoreSubmissionByRank(sub) {
      if (!sub || sub.points != null) return;
      const task = this.getTask(sub.taskId);
      if (!task) return;

      let pts = 0;
      if (task.type === "quiz" && task.quizCorrect != null) {
        pts = sub.quizAnswer === task.quizCorrect ? 100 : 0;
      } else if (sub.photoUrl || sub.textAnswer) {
        const rank = this._getUploadRank(sub.taskId, sub.teamId);
        pts = pointsForUploadRank(rank);
      }
      this._applyPoints(sub, pts);
    },

    _finalizeTaskScores(taskId) {
      this._state.teams.forEach((team) => {
        const sub = this.getSubmission(taskId, team.id);
        if (sub && sub.points == null) {
          this._scoreSubmissionByRank(sub);
        }
      });
    },

    _applyPoints(sub, points) {
      const prev = sub.points || 0;
      sub.points = points;
      sub.scoredAt = Date.now();
      const team = this.getTeam(sub.teamId);
      if (team) team.points = (team.points || 0) - prev + points;
    },

  /* --- Submissions --- */
    getSubmission(taskId, teamId) {
      return this._state.submissions.find(
        (s) => s.taskId === taskId && s.teamId === teamId
      );
    },

    getTaskSubmissions(taskId) {
      return this._state.submissions.filter((s) => s.taskId === taskId);
    },

    getAllPhotoSubmissions() {
      return this._state.submissions.filter((s) => s.photoUrl);
    },

    async submitTask(teamId, taskId, data) {
      if (this.isRaceEnded()) throw new Error("Race has ended");
      const task = this.getTask(taskId);
      if (!task || task.status !== "active") throw new Error("No active challenge");

      if (useFirebase()) await this._mergeRemoteState();

      let photoUrl = null;
      if (data.photoDataUrl) {
        photoUrl = await compressDataUrl(data.photoDataUrl, cfg().maxPhotoBytes || 500000);
      }

      const isNew = !this.getSubmission(taskId, teamId);
      let existing = this.getSubmission(taskId, teamId);
      if (existing) {
        Object.assign(existing, {
          photoUrl: photoUrl || existing.photoUrl,
          quizAnswer: data.quizAnswer ?? existing.quizAnswer,
          textAnswer: data.textAnswer ?? existing.textAnswer,
          comment: data.comment != null ? data.comment : existing.comment,
          submittedAt: existing.submittedAt || Date.now(),
        });
      } else {
        existing = {
          id: uid(),
          taskId,
          teamId,
          photoUrl,
          quizAnswer: data.quizAnswer,
          textAnswer: data.textAnswer,
          comment: data.comment || null,
          points: null,
          scoredAt: null,
          submittedAt: Date.now(),
        };
        this._state.submissions.push(existing);
      }

      if (isNew || existing.points == null) {
        this._scoreSubmissionByRank(existing);
      }

      await this.persist();
      return existing;
    },

  /* --- Comments --- */
    addComment(taskId, teamId, author, text) {
      if (this.isRaceEnded()) return;
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

    getAllComments() {
      return [...this._state.comments].sort((a, b) => a.at - b.at);
    },

    getWinners(state) {
      return getWinners(state);
    },

    rankTeams(state) {
      return rankTeams(state);
    },

    medalForRank(rank) {
      return medalForRank(rank);
    },

    async resetAll() {
      this._state = emptyState();
      if (useFirebase()) {
        await deleteAllPhotos();
        await db.collection("races").doc("main").set(stripPhotos(this._state));
        this._notify();
        return;
      }
      return this.persist();
    },
  };

  Store.getWinners = (s) => getWinners(s);
  Store.rankTeams = (s) => rankTeams(s);
  Store.medalForRank = medalForRank;

  global.RaceStore = Store;
  global.durationLabel = function (d) {
    return {
      "30m": "30 minutes",
      "1h": "1 hour",
      "1d": "24 hours",
      "1w": "7 days",
      "1month": "30 days",
    }[d] || d;
  };
  global.durationToMs = durationToMs;
})(window);
