(() => {
  "use strict";

  /* ============================== storage ============================== */
  const STORE_KEY = "recall.decks.v1";

  function loadDecks() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }
  function saveDecks(decks) {
    localStorage.setItem(STORE_KEY, JSON.stringify(decks));
  }
  let decks = loadDecks();

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* ============================== chunking =============================== */
  // Splits raw pasted text into short recitable pieces. Prefers real sentence
  // punctuation; falls back to commas, then fixed word groups, so unpunctuated
  // ritual language still breaks into something holdable.
  const MAX_WORDS = 14;
  const FALLBACK_GROUP = 8;

  function splitIntoChunks(raw) {
    const text = (raw || "").replace(/\s+/g, " ").trim();
    if (!text) return [];

    let pieces = text.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) || [text];
    pieces = pieces.map((s) => s.trim()).filter(Boolean);

    const result = [];
    for (const piece of pieces) {
      const words = piece.split(" ");
      if (words.length <= MAX_WORDS) {
        result.push(piece);
        continue;
      }
      let subs = piece.split(/(?<=[,;:])\s+/).filter(Boolean);
      if (subs.length === 1) {
        subs = [];
        for (let i = 0; i < words.length; i += FALLBACK_GROUP) {
          subs.push(words.slice(i, i + FALLBACK_GROUP).join(" "));
        }
      } else {
        const expanded = [];
        for (const s of subs) {
          const w = s.split(" ");
          if (w.length <= MAX_WORDS) {
            expanded.push(s);
          } else {
            for (let i = 0; i < w.length; i += FALLBACK_GROUP) {
              expanded.push(w.slice(i, i + FALLBACK_GROUP).join(" "));
            }
          }
        }
        subs = expanded;
      }
      result.push(...subs);
    }
    return result;
  }

  /* ============================== view routing ============================== */
  const views = {
    library: document.getElementById("view-library"),
    editor: document.getElementById("view-editor"),
    practice: document.getElementById("view-practice"),
  };
  function showView(name) {
    Object.entries(views).forEach(([k, el]) => (el.hidden = k !== name));
  }

  /* ============================== library ============================== */
  const deckListEl = document.getElementById("deck-list");
  const emptyStateEl = document.getElementById("empty-state");

  function renderLibrary() {
    deckListEl.innerHTML = "";
    if (decks.length === 0) {
      emptyStateEl.hidden = false;
      deckListEl.hidden = true;
      return;
    }
    emptyStateEl.hidden = true;
    deckListEl.hidden = false;

    decks
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .forEach((deck) => {
        const total = deck.chunks.length;
        const mastered = Math.min(deck.progress.masteredIndex, total);
        const pct = total ? Math.round((mastered / total) * 100) : 0;

        const card = document.createElement("button");
        card.className = "deck-card";
        card.innerHTML = `
          <div class="deck-card-top">
            <span class="deck-card-name"></span>
            <span class="deck-card-count">${mastered} / ${total} pieces</span>
          </div>
          <div class="deck-card-bar"><div class="deck-card-bar-fill" style="width:${pct}%"></div></div>
          <div class="deck-card-snippet"></div>
        `;
        card.querySelector(".deck-card-name").textContent = deck.name;
        card.querySelector(".deck-card-snippet").textContent = deck.text.slice(0, 120);
        card.addEventListener("click", () => openPractice(deck.id));
        deckListEl.appendChild(card);
      });
  }

  /* ============================== editor ============================== */
  const editorHeading = document.getElementById("editor-heading");
  const inputName = document.getElementById("input-deck-name");
  const inputText = document.getElementById("input-deck-text");
  const chunkHint = document.getElementById("chunk-preview-hint");
  let editingDeckId = null;

  function openEditor(deckId) {
    editingDeckId = deckId || null;
    if (editingDeckId) {
      const deck = decks.find((d) => d.id === editingDeckId);
      editorHeading.textContent = "Edit text";
      inputName.value = deck.name;
      inputText.value = deck.text;
      chunkHint.textContent = "Saving will reset your progress and any recordings on this piece.";
    } else {
      editorHeading.textContent = "New deck";
      inputName.value = "";
      inputText.value = "";
      chunkHint.textContent = "";
    }
    showView("editor");
    updateChunkHint();
    setTimeout(() => inputName.focus(), 50);
  }

  function updateChunkHint() {
    if (editingDeckId) return; // fixed warning message while editing
    const n = splitIntoChunks(inputText.value).length;
    chunkHint.textContent = n ? `This will split into ${n} piece${n === 1 ? "" : "s"}.` : "";
  }
  inputText.addEventListener("input", updateChunkHint);

  document.getElementById("btn-editor-cancel").addEventListener("click", () => {
    showView("library");
  });

  document.getElementById("btn-editor-save").addEventListener("click", () => {
    const name = inputName.value.trim();
    const text = inputText.value.trim();
    if (!name || !text) {
      inputName.focus();
      return;
    }
    const chunks = splitIntoChunks(text);
    const now = Date.now();

    if (editingDeckId) {
      const deck = decks.find((d) => d.id === editingDeckId);
      deck.name = name;
      deck.text = text;
      deck.chunks = chunks;
      deck.progress = { masteredIndex: 0 };
      deck.recordings = {};
      deck.updatedAt = now;
    } else {
      decks.push({
        id: uid(),
        name,
        text,
        chunks,
        progress: { masteredIndex: 0 },
        recordings: {},
        createdAt: now,
        updatedAt: now,
      });
    }
    saveDecks(decks);
    renderLibrary();
    showView("library");
  });

  document.getElementById("btn-new-deck").addEventListener("click", () => openEditor(null));
  document.querySelectorAll("[data-open-new-deck]").forEach((b) =>
    b.addEventListener("click", () => openEditor(null))
  );

  /* ============================== practice ============================== */
  const practiceDeckName = document.getElementById("practice-deck-name");
  const practiceProgress = document.getElementById("practice-progress");
  const progressFill = document.getElementById("progress-fill");
  const biteCard = document.getElementById("bite-card");
  const biteText = document.getElementById("bite-text");
  const biteCaption = document.getElementById("bite-caption");
  const doneBanner = document.getElementById("done-banner");
  const sizeLabel = document.getElementById("size-label");
  const btnSizeMinus = document.getElementById("btn-size-minus");
  const btnSizePlus = document.getElementById("btn-size-plus");
  const holdBtn = document.getElementById("btn-hold");
  const holdLabel = document.getElementById("hold-label");
  const btnMastered = document.getElementById("btn-mastered");
  const srcTtsBtn = document.getElementById("src-tts");
  const srcMineBtn = document.getElementById("src-mine");
  const recordRow = document.getElementById("record-row");
  const recordBtn = document.getElementById("btn-record");
  const recordLabel = document.getElementById("record-label");

  let activeDeckId = null;
  let windowSize = 1;
  let source = "tts"; // 'tts' | 'mine'
  let mediaRecorder = null;
  let recordedChunksBuf = [];
  let isRecording = false;
  let currentAudio = null;
  let longPressTimer = null;
  let expandTimer = null;

  function activeDeck() {
    return decks.find((d) => d.id === activeDeckId);
  }
  function windowRange() {
    const deck = activeDeck();
    const start = deck.progress.masteredIndex;
    const end = Math.min(start + windowSize, deck.chunks.length);
    return { start, end };
  }
  function windowKey() {
    const { start, end } = windowRange();
    return `${start}:${end}`;
  }
  function windowText() {
    const deck = activeDeck();
    const { start, end } = windowRange();
    return deck.chunks.slice(start, end).join(" ");
  }

  function openPractice(deckId) {
    activeDeckId = deckId;
    windowSize = 1;
    source = "tts";
    updateSourceButtons();
    showView("practice");
    renderPracticeState();
  }

  function renderPracticeState() {
    const deck = activeDeck();
    const total = deck.chunks.length;
    const mastered = Math.min(deck.progress.masteredIndex, total);

    practiceDeckName.textContent = deck.name;
    practiceProgress.textContent = `${mastered} / ${total}`;
    progressFill.style.width = total ? `${(mastered / total) * 100}%` : "0%";

    const finished = mastered >= total;
    doneBanner.hidden = !finished;
    biteCard.hidden = finished;
    document.querySelector(".size-row").hidden = finished;
    document.querySelector(".controls").hidden = finished;

    if (finished) return;

    windowSize = Math.max(1, Math.min(windowSize, total - mastered));
    const { start, end } = windowRange();
    biteText.textContent = deck.chunks.slice(start, end).join(" ");
    biteCaption.textContent = "";
    sizeLabel.textContent = `${windowSize} piece${windowSize === 1 ? "" : "s"}`;
    btnSizeMinus.disabled = windowSize <= 1;
    btnSizePlus.disabled = end >= total;

    updateRecordUI();
  }

  btnSizeMinus.addEventListener("click", () => {
    windowSize = Math.max(1, windowSize - 1);
    renderPracticeState();
  });
  btnSizePlus.addEventListener("click", () => {
    const deck = activeDeck();
    const total = deck.chunks.length;
    const mastered = deck.progress.masteredIndex;
    windowSize = Math.min(windowSize + 1, total - mastered);
    renderPracticeState();
  });

  btnMastered.addEventListener("click", () => {
    stopPlayback();
    const deck = activeDeck();
    const { end } = windowRange();
    deck.progress.masteredIndex = end;
    deck.updatedAt = Date.now();
    windowSize = 1;
    saveDecks(decks);
    renderPracticeState();
  });

  document.getElementById("btn-restart-deck").addEventListener("click", () => {
    const deck = activeDeck();
    deck.progress.masteredIndex = 0;
    saveDecks(decks);
    windowSize = 1;
    renderPracticeState();
  });

  document.getElementById("btn-practice-back").addEventListener("click", () => {
    stopPlayback();
    renderLibrary();
    showView("library");
  });

  /* ---- source toggle ---- */
  function updateSourceButtons() {
    srcTtsBtn.classList.toggle("is-active", source === "tts");
    srcMineBtn.classList.toggle("is-active", source === "mine");
    recordRow.hidden = source !== "mine";
  }
  srcTtsBtn.addEventListener("click", () => {
    source = "tts";
    updateSourceButtons();
    updateRecordUI();
  });
  srcMineBtn.addEventListener("click", () => {
    source = "mine";
    updateSourceButtons();
    updateRecordUI();
  });

  function updateRecordUI() {
    if (source !== "mine") return;
    const deck = activeDeck();
    const has = !!deck.recordings[windowKey()];
    recordBtn.classList.toggle("has-clip", has);
    recordLabel.textContent = has ? "Re-record this piece" : "Record this piece";
  }

  /* ---- recording (own voice) ---- */
  recordBtn.addEventListener("click", async () => {
    if (isRecording) {
      mediaRecorder && mediaRecorder.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordedChunksBuf = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = (e) => e.data.size && recordedChunksBuf.push(e.data);
      mediaRecorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        isRecording = false;
        recordBtn.classList.remove("is-recording");
        const blob = new Blob(recordedChunksBuf, { type: "audio/webm" });
        const reader = new FileReader();
        reader.onload = () => {
          const deck = activeDeck();
          deck.recordings[windowKey()] = reader.result;
          deck.updatedAt = Date.now();
          saveDecks(decks);
          updateRecordUI();
        };
        reader.readAsDataURL(blob);
      };
      mediaRecorder.start();
      isRecording = true;
      recordBtn.classList.add("is-recording");
      recordLabel.textContent = "Recording… tap to stop";
    } catch (err) {
      biteCaption.textContent = "Couldn't reach the microphone — check permissions.";
    }
  });

  /* ---- hold-to-play ---- */
  function stopPlayback() {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio = null;
    }
    clearTimeout(longPressTimer);
    clearInterval(expandTimer);
    holdBtn.classList.remove("is-active", "is-expanding");
    biteText.classList.remove("is-speaking");
  }

  function playCurrentWindow() {
    const text = windowText();
    holdBtn.classList.add("is-active");
    biteText.classList.add("is-speaking");

    if (source === "mine") {
      const deck = activeDeck();
      const clip = deck.recordings[windowKey()];
      if (!clip) {
        biteCaption.textContent = "No recording yet — tap Record below first.";
        stopPlayback();
        return;
      }
      currentAudio = new Audio(clip);
      currentAudio.play();
      return;
    }

    if (!window.speechSynthesis) {
      biteCaption.textContent = "Speech isn't supported in this browser.";
      return;
    }
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 0.94;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
  }

  function tryExpand() {
    const deck = activeDeck();
    const total = deck.chunks.length;
    const mastered = deck.progress.masteredIndex;
    if (mastered + windowSize >= total) return;
    windowSize += 1;
    holdBtn.classList.add("is-expanding");
    setTimeout(() => holdBtn.classList.remove("is-expanding"), 250);
    const { start, end } = windowRange();
    biteText.textContent = deck.chunks.slice(start, end).join(" ");
    sizeLabel.textContent = `${windowSize} piece${windowSize === 1 ? "" : "s"}`;
    btnSizePlus.disabled = end >= total;
    btnSizeMinus.disabled = windowSize <= 1;
    playCurrentWindow();
  }

  function startHold(e) {
    e.preventDefault();
    const deck = activeDeck();
    if (deck.progress.masteredIndex >= deck.chunks.length) return;
    playCurrentWindow();
    longPressTimer = setTimeout(() => {
      tryExpand();
      expandTimer = setInterval(tryExpand, 900);
    }, 1100);
  }
  function endHold() {
    stopPlayback();
  }
  holdBtn.addEventListener("pointerdown", startHold);
  holdBtn.addEventListener("pointerup", endHold);
  holdBtn.addEventListener("pointerleave", endHold);
  holdBtn.addEventListener("pointercancel", endHold);

  /* ============================== deck menu sheet ============================== */
  const sheetBackdrop = document.getElementById("sheet-backdrop");
  document.getElementById("btn-practice-menu").addEventListener("click", () => {
    sheetBackdrop.hidden = false;
  });
  document.getElementById("sheet-cancel").addEventListener("click", () => {
    sheetBackdrop.hidden = true;
  });
  sheetBackdrop.addEventListener("click", (e) => {
    if (e.target === sheetBackdrop) sheetBackdrop.hidden = true;
  });
  document.getElementById("sheet-edit-text").addEventListener("click", () => {
    sheetBackdrop.hidden = true;
    openEditor(activeDeckId);
  });
  document.getElementById("sheet-reset-progress").addEventListener("click", () => {
    sheetBackdrop.hidden = true;
    const deck = activeDeck();
    deck.progress.masteredIndex = 0;
    saveDecks(decks);
    windowSize = 1;
    renderPracticeState();
  });
  document.getElementById("sheet-delete-deck").addEventListener("click", () => {
    sheetBackdrop.hidden = true;
    decks = decks.filter((d) => d.id !== activeDeckId);
    saveDecks(decks);
    renderLibrary();
    showView("library");
  });

  /* ============================== boot ============================== */
  renderLibrary();
  showView("library");

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
})();
