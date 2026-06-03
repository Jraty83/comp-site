/**
 * Build downloadable HTML scrapbook from all race photos.
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
        url: sub.photoUrl,
        team: team?.name || "Team",
        task: task?.title || "Challenge",
        at: sub.submittedAt || 0,
      });
    });

    return items.sort((a, b) => a.at - b.at);
  }

  function buildScrapbookHtml(state, raceName) {
    const photos = collectPhotos(state);
    const slides = photos
      .map(
        (p, i) => `
      <section class="slide" data-i="${i}">
        <img src="${escapeAttr(p.url)}" alt="${escapeAttr(p.team)}" />
        <figcaption><strong>${escapeHtml(p.team)}</strong> — ${escapeHtml(p.task)}</figcaption>
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
  body { margin: 0; font-family: Georgia, serif; background: #0d3d4d; color: #fff; }
  h1 { text-align: center; padding: 1.5rem; font-size: 1.5rem; }
  .slideshow { max-width: 900px; margin: 0 auto; padding: 1rem; }
  .slide { display: none; text-align: center; }
  .slide.active { display: block; animation: fade 0.5s; }
  .slide img { max-width: 100%; max-height: 70vh; border-radius: 12px; box-shadow: 0 12px 40px rgba(0,0,0,0.4); }
  figcaption { margin-top: 1rem; font-size: 1.1rem; }
  .controls { display: flex; justify-content: center; gap: 1rem; padding: 1.5rem; flex-wrap: wrap; }
  button { padding: 0.6rem 1.2rem; border: none; border-radius: 8px; font-size: 1rem; cursor: pointer; background: #e85d04; color: #fff; }
  button.secondary { background: #1a5f7a; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 6px; padding: 1rem; max-width: 900px; margin: 0 auto; }
  .grid img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 6px; }
  @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
  @media print { .controls { display: none; } .slide { display: block !important; page-break-after: always; } }
</style>
</head>
<body>
<h1>🏁 ${title}</h1>
<p style="text-align:center;opacity:0.85">${photos.length} memories · ${new Date().toLocaleDateString()}</p>
<div class="slideshow" id="show">
${slides || "<p style='text-align:center'>No photos yet.</p>"}
</div>
<div class="controls" id="ctrl">
  <button type="button" id="prev">← Prev</button>
  <button type="button" id="play">▶ Play</button>
  <button type="button" id="next">Next →</button>
  <button type="button" class="secondary" id="gridBtn">Grid view</button>
</div>
<div class="grid hidden" id="grid">
${photos.map((p) => `<img src="${escapeAttr(p.url)}" alt="${escapeAttr(p.team)}"/>`).join("")}
</div>
<script>
(function(){
  var slides = document.querySelectorAll(".slide");
  var i = 0, timer;
  function show(n) {
    if (!slides.length) return;
    i = (n + slides.length) % slides.length;
    slides.forEach(function(s,j){ s.classList.toggle("active", j===i); });
  }
  document.getElementById("prev")?.addEventListener("click", function(){ show(i-1); });
  document.getElementById("next")?.addEventListener("click", function(){ show(i+1); });
  document.getElementById("play")?.addEventListener("click", function(){
    clearInterval(timer);
    timer = setInterval(function(){ show(i+1); }, 3500);
  });
  document.getElementById("gridBtn")?.addEventListener("click", function(){
    var g = document.getElementById("grid");
    var sh = document.getElementById("show");
    g.classList.toggle("hidden");
    sh.style.display = g.classList.contains("hidden") ? "" : "none";
  });
  show(0);
})();
</script>
</body>
</html>`;
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

  function downloadScrapbook(state, raceName) {
    const html = buildScrapbookHtml(state, raceName);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (raceName || "race-scrapbook").replace(/\s+/g, "-").toLowerCase() + ".html";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  global.RaceScrapbook = {
    collectPhotos,
    buildScrapbookHtml,
    downloadScrapbook,
  };
})(window);
