/**
 * Build slideshow from all race photos.
 */
(function (global) {
  function collectPhotos(state) {
    const teams = Object.fromEntries(state.teams.map((t) => [t.id, t]));
    const tasks = Object.fromEntries(state.tasks.map((t) => [t.id, t]));
    const items = [];

    state.submissions.forEach((sub) => {
      if (!sub.photoUrl) return;
      const team = teams[sub.teamId];
      const task = tasks[sub.taskId];
      items.push({
        id: sub.id,
        url: sub.photoUrl,
        team: team?.name || "Team",
        task: task?.title || "Challenge",
        comment: sub.comment || "",
        at: sub.submittedAt || 0,
        filename: `${(team?.name || "team").replace(/\s+/g, "-")}-${(task?.title || "photo").replace(/\s+/g, "-")}.jpg`,
      });
    });

    return items.sort((a, b) => a.at - b.at);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, "&#39;");
  }

  function shuffleArray(items) {
    const arr = items.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function buildScrapbookHtml(state, raceName, options) {
    const opts = options || {};
    const musicUrl = opts.musicUrl || "";
    const photos = shuffleArray(collectPhotos(state));
    const slides = photos
      .map(
        (p) => `
      <section class="slide">
        <div class="slide-inner">
          <div class="slide-frame">
            <img src="${escapeAttr(p.url)}" alt="${escapeAttr(p.team)}" />
          </div>
          <figcaption><strong>${escapeHtml(p.team)}</strong> — ${escapeHtml(p.task)}${p.comment ? `<br/><em>${escapeHtml(p.comment)}</em>` : ""}</figcaption>
        </div>
      </section>`
      )
      .join("");

    const title = escapeHtml(raceName || state.race?.name || "Amazing Race Scrapbook");

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title}</title>
<style>
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    font-family: Georgia, serif;
    background: #0d3d4d;
    color: #fff;
  }
  .top {
    flex-shrink: 0;
    text-align: center;
    padding: 1rem 1rem 0.5rem;
  }
  .top h1 { margin: 0; font-size: 1.5rem; }
  .top p { margin: 0.35rem 0 0; opacity: 0.85; }
  .stage {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: stretch;
    justify-content: center;
    padding: 0.5rem 1rem 0;
  }
  .slideshow {
    flex: 1;
    width: 100%;
    max-width: 900px;
    min-height: 0;
    position: relative;
  }
  .slideshow-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    opacity: 0.85;
  }
  .slide {
    display: none;
    position: absolute;
    inset: 0;
    padding: 0.25rem 0;
  }
  .slide.active {
    display: flex;
    align-items: center;
    justify-content: center;
    animation: fade 0.5s;
  }
  .slide-inner {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    max-width: 100%;
    max-height: 100%;
  }
  .slide-frame {
    flex: 0 1 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    max-width: 100%;
    max-height: calc(100dvh - 13rem);
  }
  .slide img {
    display: block;
    max-width: min(100%, 900px);
    max-height: calc(100dvh - 13rem);
    width: auto;
    height: auto;
    object-fit: contain;
    border-radius: 12px;
    box-shadow: 0 12px 40px rgba(0,0,0,0.4);
  }
  figcaption {
    flex-shrink: 0;
    margin: 0.65rem 0 0;
    padding: 0 0.5rem;
    font-size: 1.1rem;
    line-height: 1.45;
    max-width: min(100%, 900px);
  }
  figcaption em { opacity: 0.9; font-size: 0.95rem; }
  .slide-inner { text-align: center; }
  .controls {
    flex-shrink: 0;
    display: flex;
    justify-content: center;
    gap: 0.75rem;
    padding: 1rem 1.5rem calc(1rem + env(safe-area-inset-bottom, 0px));
    flex-wrap: wrap;
    background: #0d3d4d;
  }
  button {
    padding: 0.6rem 1.2rem;
    border: none;
    border-radius: 8px;
    font-size: 1rem;
    cursor: pointer;
    background: #e85d04;
    color: #fff;
  }
  button.secondary { background: #1a5f7a; }
  @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
</style>
</head>
<body>
<header class="top">
  <h1>🏁 ${title}</h1>
  <p>${photos.length} memories · ${new Date().toLocaleDateString()}</p>
</header>
<main class="stage">
  <div class="slideshow" id="show">
${slides ? slides : '<p class="slideshow-empty">No photos yet.</p>'}
  </div>
</main>
<footer class="controls">
  <button type="button" class="secondary" id="back">← Back</button>
  <button type="button" id="prev">← Prev</button>
  <button type="button" id="play">⏸ Pause</button>
  <button type="button" id="next">Next →</button>
</footer>
${musicUrl ? `<audio id="bg-music" loop preload="auto" src="${escapeAttr(musicUrl)}"></audio>` : ""}
<script>
(function(){
  var slides = document.querySelectorAll(".slide");
  var i = 0, timer = null, playing = false;
  var playBtn = document.getElementById("play");
  var bgMusic = document.getElementById("bg-music");
  var SLIDE_MS = 3500;

  function show(n) {
    if (!slides.length) return;
    i = (n + slides.length) % slides.length;
    slides.forEach(function(s,j){ s.classList.toggle("active", j===i); });
  }

  function getAudio() {
    try {
      if (window.opener && window.opener._scrapbookAudio) return window.opener._scrapbookAudio;
    } catch (e) {}
    return bgMusic;
  }

  function setMusic(on) {
    var audio = getAudio();
    if (!audio) return;
    if (on) {
      audio.volume = 0.42;
      audio.play().catch(function() {});
    } else {
      audio.pause();
    }
  }

  function setPlaying(on) {
    playing = on;
    if (playBtn) playBtn.textContent = playing ? "⏸ Pause" : "▶ Play";
    if (!playing) {
      clearInterval(timer);
      timer = null;
      setMusic(false);
    } else {
      clearInterval(timer);
      timer = setInterval(function(){ show(i + 1); }, SLIDE_MS);
      setMusic(true);
    }
  }

  document.getElementById("back")?.addEventListener("click", function(){
    setPlaying(false);
    try {
      if (window.opener && window.opener._scrapbookAudio) window.opener._scrapbookAudio.pause();
    } catch (e) {}
    if (window.opener) window.close();
    else window.history.back();
  });
  document.getElementById("prev")?.addEventListener("click", function(){ show(i - 1); });
  document.getElementById("next")?.addEventListener("click", function(){ show(i + 1); });
  playBtn?.addEventListener("click", function(){ setPlaying(!playing); });

  window.startSlideshow = function() {
    show(0);
    if (slides.length) setPlaying(true);
  };
})();
</script>
</body>
</html>`;
  }

  function resolveMusicUrl(path) {
    if (!path) return "";
    if (/^https?:\/\//i.test(path)) return path;
    return new URL(path, window.location.href).href;
  }

  function ensureScrapbookMusic(musicUrl) {
    if (!musicUrl) return null;
    if (!window._scrapbookAudio) {
      window._scrapbookAudio = new Audio();
      window._scrapbookAudio.loop = true;
    }
    if (window._scrapbookAudio.src !== musicUrl) {
      window._scrapbookAudio.src = musicUrl;
    }
    return window._scrapbookAudio;
  }

  function startScrapbookMusic(path) {
    const musicUrl = resolveMusicUrl(path);
    if (!musicUrl) return Promise.resolve();
    const audio = ensureScrapbookMusic(musicUrl);
    audio.volume = 0.42;
    audio.currentTime = 0;
    return audio.play();
  }

  function stopScrapbookMusic() {
    if (window._scrapbookAudio) window._scrapbookAudio.pause();
  }

  function openScrapbook(state, raceName, options) {
    const opts = options || {};
    const musicPath = opts.slideshowMusicUrl || "audio/slideshow-music.mp3";
    startScrapbookMusic(musicPath).catch(() => {});
    const html = buildScrapbookHtml(state, raceName, {
      musicUrl: resolveMusicUrl(musicPath),
    });
    const w = window.open("", "_blank");
    if (w) {
      w.document.write(html);
      w.document.close();
      if (typeof w.startSlideshow === "function") w.startSlideshow();
      const check = setInterval(() => {
        if (w.closed) {
          clearInterval(check);
          stopScrapbookMusic();
        }
      }, 400);
    }
    return w;
  }

  async function downloadPhotosAsZip(photos, zipName) {
    if (!photos.length) return;
    if (photos.length === 1) {
      const res = await fetch(photos[0].url);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = photos[0].filename || "photo.jpg";
      a.click();
      URL.revokeObjectURL(a.href);
      return;
    }
    if (!window.JSZip) return;
    const zip = new JSZip();
    let i = 0;
    for (const p of photos) {
      try {
        const res = await fetch(p.url);
        const blob = await res.blob();
        zip.file(p.filename || `photo-${++i}.jpg`, blob);
      } catch (e) {
        console.warn(e);
      }
    }
    const out = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(out);
    a.download = zipName;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  global.RaceScrapbook = {
    collectPhotos,
    buildScrapbookHtml,
    openScrapbook,
    downloadPhotosAsZip,
    resolveMusicUrl,
    startScrapbookMusic,
    stopScrapbookMusic,
  };
})(window);
