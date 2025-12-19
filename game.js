(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  const ui = {
    collectedCount: document.getElementById("collectedCount"),
    totalCount: document.getElementById("totalCount"),
    correctCount: document.getElementById("correctCount"),
    wrongCount: document.getElementById("wrongCount"),
    btnRestart: document.getElementById("btnRestart"),
    btnResetProgress: document.getElementById("btnResetProgress"),
    modal: document.getElementById("quizModal"),
    quizPrompt: document.getElementById("quizPrompt"),
    choices: document.getElementById("choices"),
    feedback: document.getElementById("feedback"),
    btnContinue: document.getElementById("btnContinue"),
    quizProgress: document.getElementById("quizProgress")
  };

  const STORAGE_KEY = "chem-city-progress-v1";

  const state = {
    map: null,
    player: null,
    items: [],
    questions: [],
    askedQuestionIds: new Set(),
    collectedItemIds: new Set(),
    activeItem: null,
    activeQuestion: null,
    locked: false,
    stats: { correct: 0, wrong: 0 }
  };

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function loadProgress() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data && data.collectedItemIds) state.collectedItemIds = new Set(data.collectedItemIds);
      if (data && data.askedQuestionIds) state.askedQuestionIds = new Set(data.askedQuestionIds);
      if (data && data.stats) state.stats = data.stats;
    } catch {
      // ignore
    }
  }

  function saveProgress() {
    const data = {
      collectedItemIds: Array.from(state.collectedItemIds),
      askedQuestionIds: Array.from(state.askedQuestionIds),
      stats: state.stats
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function resetProgress() {
    localStorage.removeItem(STORAGE_KEY);
    state.collectedItemIds = new Set();
    state.askedQuestionIds = new Set();
    state.stats = { correct: 0, wrong: 0 };
  }

  function randomInt(a, b) {
    return Math.floor(Math.random() * (b - a + 1)) + a;
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function buildCityMap() {
    // Simple top-down map: roads are drivable, buildings are obstacles.
    const W = canvas.width, H = canvas.height;

    const roads = [
      { x: 80, y: 60, w: W - 160, h: 70 },
      { x: 80, y: H - 130, w: W - 160, h: 70 },
      { x: 120, y: 60, w: 70, h: H - 120 },
      { x: W - 190, y: 60, w: 70, h: H - 120 },
      { x: 320, y: 200, w: W - 640, h: 80 }
    ];

    const buildings = [];
    function addBuilding(x, y, w, h) { buildings.push({ x, y, w, h }); }

    addBuilding(220, 150, 160, 110);
    addBuilding(420, 145, 150, 120);
    addBuilding(610, 150, 140, 110);

    addBuilding(260, 320, 150, 120);
    addBuilding(455, 320, 170, 120);
    addBuilding(660, 320, 140, 120);

    const grass = { x: 0, y: 0, w: W, h: H };

    return { W, H, grass, roads, buildings };
  }

  function isPointInRect(px, py, r) {
    return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
  }

  function isRectOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function isDrivableRect(rect) {
    // Drivable if the center point lies on a road and not inside a building.
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;

    for (const b of state.map.buildings) {
      if (isPointInRect(cx, cy, b)) return false;
    }
    for (const r of state.map.roads) {
      if (isPointInRect(cx, cy, r)) return true;
    }
    return false;
  }

  function spawnItems(count) {
    const items = [];
    let tries = 0;

    while (items.length < count && tries < 3000) {
      tries++;

      const size = 16;
      const x = randomInt(60, canvas.width - 60);
      const y = randomInt(60, canvas.height - 60);
      const rect = { x: x - size / 2, y: y - size / 2, w: size, h: size };

      if (!isDrivableRect(rect)) continue;

      let ok = true;
      for (const it of items) {
        const dx = it.x - x;
        const dy = it.y - y;
        if (Math.hypot(dx, dy) < 70) { ok = false; break; }
      }
      if (!ok) continue;

      const id = `item-${items.length + 1}`;
      items.push({ id, x, y, size, collected: state.collectedItemIds.has(id) });
    }

    return items;
  }

  function initPlayer() {
    return {
      x: 140,
      y: 95,
      w: 22,
      h: 12,
      angle: 0,
      speed: 0,
      maxSpeed: 3.2,
      accel: 0.12,
      friction: 0.04,
      turnRate: 0.06
    };
  }

  function setHud() {
    const total = state.items.length;
    const collected = state.items.filter(i => i.collected).length;
    ui.totalCount.textContent = String(total);
    ui.collectedCount.textContent = String(collected);
    ui.correctCount.textContent = String(state.stats.correct);
    ui.wrongCount.textContent = String(state.stats.wrong);
  }

  function chooseQuestion() {
    // Prefer not-yet-asked questions. If all asked, allow repeats.
    const notAsked = state.questions.filter(q => !state.askedQuestionIds.has(q.id));
    const pool = notAsked.length ? notAsked : state.questions.slice();
    if (!pool.length) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function openQuizForItem(item) {
    const q = chooseQuestion();
    if (!q) return;

    state.locked = true;
    state.activeItem = item;
    state.activeQuestion = q;

    ui.feedback.textContent = "";
    ui.feedback.className = "feedback";
    ui.btnContinue.classList.add("hidden");

    ui.quizPrompt.textContent = q.prompt;

    ui.choices.innerHTML = "";
    q.choices.forEach((text, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "choice";
      btn.textContent = `${String.fromCharCode(65 + idx)}. ${text}`;
      btn.addEventListener("click", () => answerQuiz(idx));
      ui.choices.appendChild(btn);
    });

    const askedCount = state.askedQuestionIds.size;
    ui.quizProgress.textContent = `Practice questions seen: ${askedCount} | Item: ${item.id}`;

    ui.modal.classList.remove("hidden");
  }

  function disableChoices() {
    const buttons = ui.choices.querySelectorAll("button");
    buttons.forEach(b => b.disabled = true);
  }

  function answerQuiz(selectedIndex) {
    const q = state.activeQuestion;
    if (!q) return;

    disableChoices();

    state.askedQuestionIds.add(q.id);

    const correct = selectedIndex === q.answerIndex;
    if (correct) {
      ui.feedback.textContent = `Correct. ${q.explain || ""}`.trim();
      ui.feedback.className = "feedback ok";
      collectActiveItem();
      state.stats.correct += 1;
    } else {
      const rightLetter = String.fromCharCode(65 + q.answerIndex);
      ui.feedback.textContent = `Not this one. Correct answer: ${rightLetter}. ${q.explain || ""}`.trim();
      ui.feedback.className = "feedback bad";
      state.stats.wrong += 1;
    }

    ui.btnContinue.classList.remove("hidden");
    saveProgress();
    setHud();
  }

  function collectActiveItem() {
    const item = state.activeItem;
    if (!item) return;
    item.collected = true;
    state.collectedItemIds.add(item.id);
  }

  function closeQuiz() {
    ui.modal.classList.add("hidden");
    state.locked = false;
    state.activeItem = null;
    state.activeQuestion = null;
  }

  function allCollected() {
    return state.items.every(i => i.collected);
  }

  function drawMap() {
    const m = state.map;

    // grass background
    ctx.fillStyle = "#0b0e1a";
    ctx.fillRect(0, 0, m.W, m.H);

    // subtle grid
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = "#ffffff";
    for (let x = 0; x < m.W; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, m.H);
      ctx.stroke();
    }
    for (let y = 0; y < m.H; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(m.W, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // roads
    ctx.fillStyle = "#1a2040";
    for (const r of m.roads) {
      roundRect(r.x, r.y, r.w, r.h, 12);
      ctx.fill();
    }

    // lane markers
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = "#ffffff";
    for (const r of m.roads) {
      const midY = r.y + r.h / 2;
      for (let x = r.x + 14; x < r.x + r.w - 14; x += 28) {
        ctx.fillRect(x, midY - 1, 14, 2);
      }
    }
    ctx.globalAlpha = 1;

    // buildings
    for (const b of m.buildings) {
      ctx.fillStyle = "#0f1430";
      roundRect(b.x, b.y, b.w, b.h, 10);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.stroke();
    }
  }

  function roundRect(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function drawItems(t) {
    for (const it of state.items) {
      if (it.collected) continue;

      const pulse = 0.55 + 0.45 * Math.sin((t / 300) + (it.x + it.y) / 80);
      const glow = 12 + 10 * pulse;

      ctx.save();
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = "#7aa2ff";
      ctx.beginPath();
      ctx.arc(it.x, it.y, glow, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = "#dfe6ff";
      ctx.beginPath();
      ctx.arc(it.x, it.y, it.size / 2, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 0.65;
      ctx.fillStyle = "#0b0e1a";
      ctx.font = "12px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("?", it.x, it.y + 0.5);
      ctx.globalAlpha = 1;
    }
  }

  function drawPlayer() {
    const p = state.player;

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);

    // car body
    ctx.fillStyle = "#e9ecff";
    roundRect(-p.w / 2, -p.h / 2, p.w, p.h, 4);
    ctx.fill();

    // windshield
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#0b0e1a";
    roundRect(-p.w / 8, -p.h / 2 + 1, p.w / 3, p.h - 2, 3);
    ctx.fill();
    ctx.globalAlpha = 1;

    // nose indicator
    ctx.fillStyle = "#7aa2ff";
    ctx.fillRect(p.w / 2 - 3, -2, 3, 4);

    ctx.restore();
  }

  function drawWinBanner() {
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1;

    ctx.fillStyle = "#eef1ff";
    ctx.font = "700 34px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("All items collected", canvas.width / 2, canvas.height / 2 - 12);

    ctx.fillStyle = "rgba(238,241,255,0.8)";
    ctx.font = "16px system-ui";
    ctx.fillText("Restart run to play again, or reset progress to clear saved data.", canvas.width / 2, canvas.height / 2 + 20);
    ctx.restore();
  }

  const keys = new Set();
  window.addEventListener("keydown", (e) => {
    if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","w","a","s","d","W","A","S","D"].includes(e.key)) {
      e.preventDefault();
    }
    keys.add(e.key);
  });
  window.addEventListener("keyup", (e) => keys.delete(e.key));

  function updatePlayer() {
    const p = state.player;

    const up = keys.has("ArrowUp") || keys.has("w") || keys.has("W");
    const down = keys.has("ArrowDown") || keys.has("s") || keys.has("S");
    const left = keys.has("ArrowLeft") || keys.has("a") || keys.has("A");
    const right = keys.has("ArrowRight") || keys.has("d") || keys.has("D");

    if (up) p.speed += p.accel;
    if (down) p.speed -= p.accel;

    p.speed = clamp(p.speed, -p.maxSpeed * 0.7, p.maxSpeed);

    const turning = (left ? -1 : 0) + (right ? 1 : 0);
    if (Math.abs(p.speed) > 0.2) p.angle += turning * p.turnRate * (p.speed >= 0 ? 1 : -1);

    // friction
    if (!up && !down) {
      if (p.speed > 0) p.speed = Math.max(0, p.speed - p.friction);
      if (p.speed < 0) p.speed = Math.min(0, p.speed + p.friction);
    }

    const nx = p.x + Math.cos(p.angle) * p.speed;
    const ny = p.y + Math.sin(p.angle) * p.speed;

    const rect = { x: nx - p.w / 2, y: ny - p.h / 2, w: p.w, h: p.h };

    // keep inside canvas
    rect.x = clamp(rect.x, 0, canvas.width - rect.w);
    rect.y = clamp(rect.y, 0, canvas.height - rect.h);

    // block buildings and off-road
    const tryRect = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
    const center = { x: tryRect.x + tryRect.w / 2, y: tryRect.y + tryRect.h / 2 };

    // building collision
    for (const b of state.map.buildings) {
      if (isRectOverlap(tryRect, b)) {
        p.speed *= 0.4;
        return;
      }
    }

    // stay on roads (simple)
    let onRoad = false;
    for (const r of state.map.roads) {
      if (isPointInRect(center.x, center.y, r)) { onRoad = true; break; }
    }
    if (!onRoad) {
      p.speed *= 0.5;
      return;
    }

    p.x = tryRect.x + p.w / 2;
    p.y = tryRect.y + p.h / 2;
  }

  function checkItemPickup() {
    const p = state.player;
    const pr = { x: p.x - p.w / 2, y: p.y - p.h / 2, w: p.w, h: p.h };

    for (const it of state.items) {
      if (it.collected) continue;
      const ir = { x: it.x - it.size / 2, y: it.y - it.size / 2, w: it.size, h: it.size };
      if (isRectOverlap(pr, ir)) {
        openQuizForItem(it);
        return;
      }
    }
  }

  function restartRun(keepProgress) {
    state.map = buildCityMap();
    state.player = initPlayer();

    // Spawn as many items as questions (capped).
    const count = Math.min(12, Math.max(6, state.questions.length));
    state.items = spawnItems(count);

    if (!keepProgress) {
      state.collectedItemIds = new Set();
      state.askedQuestionIds = new Set();
      state.stats = { correct: 0, wrong: 0 };
      state.items.forEach(i => i.collected = false);
      saveProgress();
    } else {
      // Apply saved collected flags to new spawn ids (only works if ids match).
      state.items.forEach(i => i.collected = state.collectedItemIds.has(i.id));
    }

    setHud();
  }

  async function loadQuestions() {
    const res = await fetch("questions.practice.json", { cache: "no-store" });
    const data = await res.json();

    if (!data || !Array.isArray(data.items)) throw new Error("Question file is missing items[]");

    // Basic validation
    const items = data.items.filter(q =>
      q && typeof q.id === "string" &&
      typeof q.prompt === "string" &&
      Array.isArray(q.choices) && q.choices.length >= 2 &&
      Number.isInteger(q.answerIndex) &&
      q.answerIndex >= 0 && q.answerIndex < q.choices.length
    );

    // Shuffle questions so different students see different order.
    state.questions = shuffle(items);
  }

  function tick(t) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    drawMap();
    drawItems(t);

    if (!state.locked && !allCollected()) {
      updatePlayer();
      checkItemPickup();
    }

    drawPlayer();

    if (allCollected()) drawWinBanner();

    requestAnimationFrame(tick);
  }

  ui.btnContinue.addEventListener("click", () => {
    closeQuiz();
    if (allCollected()) saveProgress();
  });

  ui.btnRestart.addEventListener("click", () => {
    closeQuiz();
    // Keep saved progress when restarting run.
    restartRun(true);
  });

  ui.btnResetProgress.addEventListener("click", () => {
    closeQuiz();
    resetProgress();
    loadProgress();
    restartRun(false);
  });

  // Close modal with Escape after answering
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !ui.modal.classList.contains("hidden")) {
      // Only allow closing if Continue is visible (answered).
      if (!ui.btnContinue.classList.contains("hidden")) closeQuiz();
    }
  });

  (async function main() {
    await loadQuestions();
    loadProgress();
    restartRun(true);
    setHud();
    requestAnimationFrame(tick);
  })().catch(err => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#eef1ff";
    ctx.font = "16px system-ui";
    ctx.fillText("Error loading game files.", 20, 40);
    ctx.fillStyle = "rgba(238,241,255,0.75)";
    ctx.fillText(String(err.message || err), 20, 70);
  });
})();
