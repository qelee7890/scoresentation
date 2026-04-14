(function () {
    const PITCH_LABEL_VERSION = 2;
    const LEGACY_PITCH_SHIFT_DOWN = {
        C4: "B3", D4: "C4", E4: "D4", F4: "E4", G4: "F4", A4: "G4", B4: "A4",
        C5: "B4", D5: "C5", E5: "D5", F5: "E5", G5: "F5", A5: "G5", B5: "A5",
        C6: "B5", D6: "C6", E6: "D6"
    };

    const UNDO_LIMIT = 100;

    function deepClone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function shiftPitchLabelsInNotes(notes) {
        if (Array.isArray(notes)) { notes.forEach((item) => shiftPitchLabelsInNotes(item)); return; }
        if (!notes || typeof notes !== "object") return;
        if (typeof notes.pitch === "string") { notes.pitch = LEGACY_PITCH_SHIFT_DOWN[notes.pitch] || notes.pitch; return; }
        Object.keys(notes).forEach((key) => shiftPitchLabelsInNotes(notes[key]));
    }

    function normalizeHymnPitchLabels(hymn) {
        if (!hymn || typeof hymn !== "object") return hymn;
        hymn.id = getSongId(hymn);
        hymn.category = getSongCategory(hymn);
        if (hymn.pitchLabelVersion === PITCH_LABEL_VERSION) return hymn;
        if (hymn.verses && typeof hymn.verses === "object") {
            Object.values(hymn.verses).forEach((verse) => {
                if (verse && Array.isArray(verse.notes)) shiftPitchLabelsInNotes(verse.notes);
            });
        }
        if (hymn.chorus && Array.isArray(hymn.chorus.notes)) shiftPitchLabelsInNotes(hymn.chorus.notes);
        hymn.pitchLabelVersion = PITCH_LABEL_VERSION;
        return hymn;
    }

    function getSongId(song) { return String((song && (song.id || song.number)) || "").trim(); }
    function getSongCategory(song) {
        if (song && typeof song.category === "string" && song.category.trim()) return song.category.trim();
        return /^\d+$/.test(getSongId(song)) ? "hymn" : "song";
    }
    function isHymnSong(song) { return getSongCategory(song) === "hymn"; }
    function getSongReference(song) {
        if (!song) return "";
        if (isHymnSong(song) && song.number) return `${song.number}장`;
        return getSongId(song);
    }
    function getSongDisplayTitle(song) {
        const reference = getSongReference(song);
        if (!song || !song.title) return reference;
        return reference ? `${reference} ${song.title}` : song.title;
    }
    function hasRenderableNotes(song) {
        if (!song || typeof song !== "object") return false;
        const hasLineNotes = (slides) => Array.isArray(slides) && slides.some((slideNotes) => {
            if (!slideNotes || typeof slideNotes !== "object") return false;
            return Object.values(slideNotes).some((lineNotes) =>
                Array.isArray(lineNotes) && lineNotes.some((note) => note && note.pitch)
            );
        });
        if (song.verses && typeof song.verses === "object") {
            if (Object.values(song.verses).some((verse) => verse && hasLineNotes(verse.notes))) return true;
        }
        return !!(song.chorus && hasLineNotes(song.chorus.notes));
    }
    function normalizeSearchText(value) {
        return String(value || "").normalize("NFC").toLowerCase()
            .replace(/<br\s*\/?>/gi, " ").replace(/\s+/g, " ").trim();
    }
    function compareSongIds(aId, bId) {
        const aNumeric = /^\d+$/.test(aId);
        const bNumeric = /^\d+$/.test(bId);
        if (aNumeric && bNumeric) return parseInt(aId, 10) - parseInt(bId, 10);
        if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
        return aId.localeCompare(bId, "ko");
    }
    function flattenSongLyrics(song) {
        const segments = [];
        if (!song || typeof song !== "object") return segments;
        if (song.verses && typeof song.verses === "object") {
            Object.keys(song.verses).sort((a, b) => parseInt(a, 10) - parseInt(b, 10)).forEach((verseKey) => {
                const verse = song.verses[verseKey];
                if (!verse) return;
                ["korean", "english"].forEach((field) => {
                    if (Array.isArray(verse[field])) {
                        verse[field].forEach((text) => { if (text) segments.push(text.replace(/<br\s*\/?>/gi, " ")); });
                    }
                });
            });
        }
        if (song.chorus) {
            ["korean", "english"].forEach((field) => {
                if (Array.isArray(song.chorus[field])) {
                    song.chorus[field].forEach((text) => { if (text) segments.push(text.replace(/<br\s*\/?>/gi, " ")); });
                }
            });
        }
        return segments;
    }
    function buildSongSearchEntry(song) {
        const songId = getSongId(song);
        const lyricSegments = flattenSongLyrics(song);
        const titleParts = [getSongDisplayTitle(song), song && song.title, song && song.subtitle, song && song.newTitle].filter(Boolean);
        return {
            id: songId, song,
            haystack: normalizeSearchText([...titleParts, ...lyricSegments].join(" ")),
            titleText: normalizeSearchText(titleParts.join(" ")),
            lyricSegments
        };
    }
    function getSongPreviewText(song) {
        const lyrics = flattenSongLyrics(song);
        return lyrics.length > 0 ? lyrics[0] : "";
    }

    function escapeHtml(value) {
        return String(value || "").replace(/[&<>"']/g, (c) => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        }[c]));
    }

    function renderMarkdown(source) {
        if (!source) return "";
        if (typeof window.marked === "undefined" || typeof window.DOMPurify === "undefined") {
            return `<pre>${escapeHtml(source)}</pre>`;
        }
        try {
            const html = window.marked.parse(source, { gfm: true, breaks: true });
            return window.DOMPurify.sanitize(html, {
                ADD_TAGS: ["math", "semantics", "annotation", "mrow", "mi", "mo", "mn", "msup", "msub", "mfrac", "msqrt", "mtext"],
                ADD_ATTR: ["display", "xmlns", "encoding"]
            });
        } catch (_) {
            return `<pre>${escapeHtml(source)}</pre>`;
        }
    }

    const KATEX_DELIMITERS = [
        { left: "$$", right: "$$", display: true },
        { left: "\\[", right: "\\]", display: true },
        { left: "$", right: "$", display: false },
        { left: "\\(", right: "\\)", display: false }
    ];

    function renderKatexIn(element) {
        if (!element || typeof window.renderMathInElement !== "function") return;
        try {
            window.renderMathInElement(element, {
                delimiters: KATEX_DELIMITERS,
                throwOnError: false,
                errorColor: "#b00020"
            });
        } catch (_) { /* ignore */ }
    }

    function formatDate(iso) {
        if (!iso) return "";
        try {
            const d = new Date(iso);
            if (Number.isNaN(d.getTime())) return iso;
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
        } catch (_) { return iso; }
    }

    function nextLocalId() {
        return `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    function getNotesTheme() {
        const isDark = document.body.classList.contains("dark");
        return {
            staffHeight: 40,
            staffColor: isDark ? "#666" : "#bbb",
            noteColor: isDark ? "#fff" : "#000"
        };
    }

    // ──────────────────────────────────────────
    // Presentation Mode Controller
    // ──────────────────────────────────────────

    class PresentMode {
        constructor() {
            this.dom = {
                sidebar: document.getElementById("present-sidebar"),
                toggleSidebar: document.getElementById("present-toggle-sidebar"),
                setlistName: document.getElementById("present-setlist-name"),
                dirtyDot: document.getElementById("present-dirty-dot"),
                saveBtn: document.getElementById("present-save"),
                loadBtn: document.getElementById("present-load"),
                newBtn: document.getElementById("present-new"),
                undoBtn: document.getElementById("present-undo"),
                redoBtn: document.getElementById("present-redo"),
                themeToggle: document.getElementById("present-theme-toggle"),
                bgFile: document.getElementById("present-bg-file"),
                bgClear: document.getElementById("present-bg-clear"),
                bgPreview: document.getElementById("present-bg-preview"),
                addBtn: document.getElementById("present-add-item"),
                addMenu: document.getElementById("present-add-menu"),
                searchForm: document.getElementById("present-search-form"),
                searchInput: document.getElementById("present-search-input"),
                searchResults: document.getElementById("present-search-results"),
                setlist: document.getElementById("present-setlist"),
                status: document.getElementById("present-status"),
                counter: document.getElementById("present-slide-counter"),
                presentationContainer: document.getElementById("presentation"),
                // modals
                textModal: document.getElementById("present-text-modal"),
                textTitle: document.getElementById("present-text-title"),
                textBody: document.getElementById("present-text-body"),
                textPreview: document.getElementById("present-text-preview"),
                textSave: document.getElementById("present-text-save"),
                imageModal: document.getElementById("present-image-modal"),
                imagePreview: document.getElementById("present-image-preview"),
                imageFile: document.getElementById("present-image-file"),
                imageCaption: document.getElementById("present-image-caption"),
                imageSave: document.getElementById("present-image-save"),
                loadModal: document.getElementById("present-load-modal"),
                loadList: document.getElementById("present-load-list"),
                itemMenu: document.getElementById("present-item-menu"),
                moveTarget: document.getElementById("present-move-target")
            };

            this.songMap = {};
            this.searchIndex = [];
            this.searchQuery = "";

            // 셋리스트 상태
            this.setlistId = null;            // DB에 저장된 셋리스트 id (null이면 새 셋리스트)
            this.setlistName = "";
            this.items = [];                   // [{itemId, type, payload}]
            this.settings = {};                // { bgImage: { mediaId, filename, url } }
            this.dirty = false;

            // undo/redo
            this.undoStack = [];
            this.redoStack = [];

            // 슬라이드 렌더 상태
            this.slideData = [];
            this.allSlides = [];
            this.currentGlobalIndex = 0;

            // 편집 중인 아이템 (모달)
            this.editingItemId = null;
            this.editingType = null;
            this.draftImagePayload = null;   // { mediaId, url, filename, fit, caption }

            // 드래그/이동
            this.dragSourceItemId = null;
            this.itemMenuTargetItemId = null;
        }

        async init() {
            this.applyStoredTheme();
            await this.loadSongs();
            this.bindControls();
            this.listenForUpdates();
            this.renderAll();
        }

        applyStoredTheme() {
            let theme = "light";
            try { theme = localStorage.getItem("present-theme") || "light"; } catch (_) {}
            document.body.classList.toggle("dark", theme === "dark");
        }

        toggleTheme() {
            const isDark = document.body.classList.toggle("dark");
            try { localStorage.setItem("present-theme", isDark ? "dark" : "light"); } catch (_) {}
            this.rebuildPresentation();
        }

        // ── 곡 데이터 로드 ──

        async loadSongs() {
            if (!window.HymnStorage) return;
            try { await window.HymnStorage.init(); } catch (_) { /* ignore */ }
            const list = window.HymnStorage.listSavedHymns();
            if (!list || list.length === 0) {
                this.setStatus("곡 데이터를 불러올 수 없습니다. 로컬 서버(server.py)를 실행해 주세요.", "warning");
                return;
            }
            for (const item of list) {
                const hymn = window.HymnStorage.getSavedHymn(item.id);
                if (hymn) this.songMap[item.id] = hymn;
            }
            this.searchIndex = Object.keys(this.songMap)
                .map((songId) => buildSongSearchEntry(this.songMap[songId]))
                .filter((entry) => !!entry.id);
        }

        listenForUpdates() {
            try {
                const channel = new BroadcastChannel("scoresentation");
                channel.addEventListener("message", (event) => {
                    if (event.data && event.data.type === "hymn-saved") {
                        this.handleExternalSave(event.data.id);
                    }
                });
            } catch (_) { /* BroadcastChannel 미지원 환경 무시 */ }
        }

        async handleExternalSave(songId) {
            await window.HymnStorage.init({ forceRefresh: true });
            const hymn = window.HymnStorage.getSavedHymn(songId);
            if (!hymn) return;
            this.songMap[songId] = hymn;
            this.searchIndex = Object.keys(this.songMap)
                .map((id) => buildSongSearchEntry(this.songMap[id]))
                .filter((entry) => !!entry.id);

            if (this.items.some((it) => it.type === "score" && it.payload && it.payload.songId === songId)) {
                const savedIndex = this.currentGlobalIndex;
                this.rebuildPresentation();
                this.showGlobalSlide(Math.min(savedIndex, this.allSlides.length - 1));
            }
        }

        // ── 이벤트 바인딩 ──

        bindControls() {
            // 사이드바 토글
            this.dom.toggleSidebar.addEventListener("click", () => {
                document.querySelector(".present-shell").classList.toggle("sidebar-collapsed");
            });

            // 셋 제목 편집
            this.dom.setlistName.addEventListener("input", () => {
                this.setlistName = this.dom.setlistName.value;
                this.markDirty();
            });
            this.dom.setlistName.addEventListener("blur", () => {
                if (this.setlistName !== this.dom.setlistName.value) {
                    this.pushHistory();
                    this.setlistName = this.dom.setlistName.value;
                }
            });

            // 액션 바
            this.dom.saveBtn.addEventListener("click", () => this.saveSetlist());
            this.dom.loadBtn.addEventListener("click", () => this.openLoadModal());
            this.dom.newBtn.addEventListener("click", () => this.newSetlist());
            this.dom.undoBtn.addEventListener("click", () => this.undo());
            this.dom.redoBtn.addEventListener("click", () => this.redo());
            this.dom.themeToggle.addEventListener("click", () => this.toggleTheme());

            // 배경 이미지 업로드/제거
            this.dom.bgFile.addEventListener("change", (event) => this.handleBgFileChange(event));
            this.dom.bgClear.addEventListener("click", () => this.clearBackgroundImage());

            // 추가 메뉴
            this.dom.addBtn.addEventListener("click", (event) => {
                event.stopPropagation();
                this.dom.addMenu.hidden = !this.dom.addMenu.hidden;
            });
            this.dom.addMenu.addEventListener("click", (event) => {
                const btn = event.target.closest("[data-add-type]");
                if (!btn) return;
                this.dom.addMenu.hidden = true;
                this.addItemOfType(btn.dataset.addType);
            });
            document.addEventListener("click", (event) => {
                if (!this.dom.addMenu.hidden && !this.dom.addMenu.contains(event.target) && event.target !== this.dom.addBtn) {
                    this.dom.addMenu.hidden = true;
                }
                if (!this.dom.itemMenu.hidden && !this.dom.itemMenu.contains(event.target)) {
                    this.closeItemMenu();
                }
            });

            // 검색
            this.dom.searchForm.addEventListener("submit", (event) => {
                event.preventDefault();
                this.searchQuery = this.dom.searchInput.value;
                this.renderSearchResults();
            });
            this.dom.searchResults.addEventListener("click", (event) => {
                const add = event.target.closest("[data-add-song]");
                if (add) this.addScoreItem(add.dataset.addSong);
            });

            // 곡 순서: 좌클릭 = 해당 아이템 첫 슬라이드로 이동, 우클릭 = 인라인 메뉴
            this.dom.setlist.addEventListener("click", (event) => {
                const card = event.target.closest(".present-setlist-card");
                if (!card) return;
                this.gotoItemFirstSlide(card.dataset.itemId);
            });
            this.dom.setlist.addEventListener("contextmenu", (event) => {
                const card = event.target.closest(".present-setlist-card");
                if (!card) return;
                event.preventDefault();
                this.openItemMenuAt(card.dataset.itemId, event.clientX, event.clientY);
            });

            // 아이템 인라인 메뉴
            this.dom.itemMenu.addEventListener("click", (event) => {
                const btn = event.target.closest("[data-item-action]");
                if (!btn) return;
                const action = btn.dataset.itemAction;
                if (action === "edit") this.handleItemMenuEdit();
                else if (action === "delete") this.handleItemMenuDelete();
                else if (action === "move") this.handleItemMenuMove(btn.dataset.move);
            });

            // 텍스트 모달
            this.dom.textBody.addEventListener("input", () => this.updateTextPreview());
            this.dom.textSave.addEventListener("click", () => this.saveTextModal());
            this.bindModalClose(this.dom.textModal);

            // 이미지 모달
            this.dom.imageFile.addEventListener("change", (event) => this.handleImageFileChange(event));
            this.dom.imageModal.querySelectorAll(".present-fit-toggle button").forEach((btn) => {
                btn.addEventListener("click", () => this.setImageFit(btn.dataset.fit));
            });
            this.dom.imageSave.addEventListener("click", () => this.saveImageModal());
            this.bindModalClose(this.dom.imageModal);

            // 불러오기 모달
            this.bindModalClose(this.dom.loadModal);

            // 키보드
            document.addEventListener("keydown", (event) => {
                if (event.target.closest("input, textarea, [contenteditable='true']")) {
                    if (event.key === "Escape") this.closeAllModals();
                    return;
                }
                const ctrl = event.ctrlKey || event.metaKey;
                if (ctrl && event.key.toLowerCase() === "z" && !event.shiftKey) {
                    event.preventDefault(); this.undo(); return;
                }
                if (ctrl && (event.key.toLowerCase() === "y" || (event.shiftKey && event.key.toLowerCase() === "z"))) {
                    event.preventDefault(); this.redo(); return;
                }
                if (ctrl && event.key.toLowerCase() === "s") {
                    event.preventDefault(); this.saveSetlist(); return;
                }
                switch (event.key) {
                    case "ArrowRight":
                    case " ":
                        event.preventDefault(); this.nextSlide(); break;
                    case "ArrowLeft":
                        event.preventDefault(); this.prevSlide(); break;
                    case "f":
                    case "F":
                        this.toggleFullscreen(); break;
                    case "Escape":
                        if (document.fullscreenElement) document.exitFullscreen();
                        this.closeAllModals();
                        break;
                }
            });

            // 메인 영역 클릭으로 다음/이전
            this.dom.presentationContainer.addEventListener("click", (event) => {
                const x = event.clientX;
                const rect = this.dom.presentationContainer.getBoundingClientRect();
                if (x < rect.left + rect.width / 2) this.prevSlide();
                else this.nextSlide();
            });

            // dirty 경고
            window.addEventListener("beforeunload", (event) => {
                if (this.dirty) {
                    event.preventDefault();
                    event.returnValue = "";
                }
            });
        }

        bindModalClose(modal) {
            modal.addEventListener("click", (event) => {
                const closer = event.target.closest("[data-close]");
                if (closer && modal.contains(closer)) {
                    event.stopPropagation();
                    this.closeModal(modal);
                }
            });
        }

        closeModal(modal) { if (modal) modal.hidden = true; }
        closeAllModals() {
            this.closeModal(this.dom.textModal);
            this.closeModal(this.dom.imageModal);
            this.closeModal(this.dom.loadModal);
            this.closeItemMenu();
            if (this.dom.addMenu) this.dom.addMenu.hidden = true;
        }

        // ── Dirty / Undo-Redo ──

        snapshot() {
            return {
                setlistName: this.setlistName,
                items: deepClone(this.items),
                settings: deepClone(this.settings)
            };
        }

        restore(state) {
            this.setlistName = state.setlistName || "";
            this.items = deepClone(state.items || []);
            this.settings = deepClone(state.settings || {});
            this.dom.setlistName.value = this.setlistName;
            this.applyBackgroundImage();
            this.renderAll();
        }

        pushHistory() {
            this.undoStack.push(this.snapshot());
            if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
            this.redoStack = [];
            this.updateUndoRedoButtons();
        }

        undo() {
            if (this.undoStack.length === 0) return;
            this.redoStack.push(this.snapshot());
            const prev = this.undoStack.pop();
            this.restore(prev);
            this.markDirty();
            this.updateUndoRedoButtons();
        }

        redo() {
            if (this.redoStack.length === 0) return;
            this.undoStack.push(this.snapshot());
            const next = this.redoStack.pop();
            this.restore(next);
            this.markDirty();
            this.updateUndoRedoButtons();
        }

        updateUndoRedoButtons() {
            this.dom.undoBtn.disabled = this.undoStack.length === 0;
            this.dom.redoBtn.disabled = this.redoStack.length === 0;
        }

        markDirty() {
            this.dirty = true;
            this.dom.dirtyDot.hidden = false;
        }

        clearDirty() {
            this.dirty = false;
            this.dom.dirtyDot.hidden = true;
        }

        // ── 셋리스트 파일 관리 ──

        newSetlist() {
            if (this.dirty && !confirm("저장하지 않은 변경 사항이 있습니다. 버릴까요?")) return;
            this.setlistId = null;
            this.setlistName = "";
            this.items = [];
            this.settings = {};
            this.undoStack = [];
            this.redoStack = [];
            this.dom.setlistName.value = "";
            this.applyBackgroundImage();
            this.clearDirty();
            this.renderAll();
            this.updateUndoRedoButtons();
        }

        async saveSetlist() {
            if (!window.SetlistStorage) { this.setStatus("저장 API를 사용할 수 없습니다. 서버를 실행해 주세요.", "warning"); return; }
            const name = (this.setlistName || "").trim() || "새 셋리스트";
            // payload에서 resolved 필드 제거, 필요한 것만 남김
            const items = this.items.map((it) => ({ type: it.type, payload: deepClone(it.payload || {}) }));
            const settings = deepClone(this.settings || {});
            try {
                let saved;
                if (this.setlistId) {
                    saved = await window.SetlistStorage.update(this.setlistId, { name, items, settings });
                } else {
                    saved = await window.SetlistStorage.create({ name, items, settings });
                    this.setlistId = saved.id;
                }
                this.setlistName = saved.name || name;
                this.dom.setlistName.value = this.setlistName;
                // 서버에서 내려온 itemId를 다시 반영
                this.items = (saved.items || []).map((it) => ({
                    itemId: `srv-${it.itemId}`,
                    type: it.type,
                    payload: it.payload || {}
                }));
                if (saved.settings !== undefined) {
                    this.settings = saved.settings || {};
                }
                this.applyBackgroundImage();
                this.clearDirty();
                this.renderAll();
                this.setStatus("저장되었습니다.", "info");
                setTimeout(() => this.setStatus("", null), 1500);
            } catch (error) {
                this.setStatus(`저장 실패: ${error.message}`, "warning");
            }
        }

        async openLoadModal() {
            if (!window.SetlistStorage) { this.setStatus("저장 API를 사용할 수 없습니다.", "warning"); return; }
            this.closeAllModals();
            try {
                const list = await window.SetlistStorage.list();
                this.renderLoadList(list);
                this.dom.loadModal.hidden = false;
            } catch (error) {
                this.setStatus(`목록 조회 실패: ${error.message}`, "warning");
            }
        }

        renderLoadList(list) {
            if (!list.length) {
                this.dom.loadList.innerHTML = '<div class="present-load-empty">저장된 셋리스트가 없습니다.</div>';
                return;
            }
            this.dom.loadList.innerHTML = list.map((s) => `
                <div class="present-load-row">
                    <div class="present-load-row-main" data-load-id="${s.id}">
                        <span class="present-load-row-name">${escapeHtml(s.name || "(이름 없음)")}</span>
                        <span class="present-load-row-meta">${s.itemCount || 0}개 · ${formatDate(s.updatedAt)}</span>
                    </div>
                    <button type="button" data-delete-id="${s.id}" title="삭제">삭제</button>
                </div>
            `).join("");
            this.dom.loadList.querySelectorAll("[data-load-id]").forEach((el) => {
                el.addEventListener("click", () => this.loadSetlist(parseInt(el.dataset.loadId, 10)));
            });
            this.dom.loadList.querySelectorAll("[data-delete-id]").forEach((el) => {
                el.addEventListener("click", (event) => {
                    event.stopPropagation();
                    this.deleteSetlist(parseInt(el.dataset.deleteId, 10));
                });
            });
        }

        async loadSetlist(id) {
            if (this.dirty && !confirm("저장하지 않은 변경 사항이 있습니다. 버릴까요?")) return;
            try {
                const setlist = await window.SetlistStorage.get(id);
                if (!setlist) { this.setStatus("셋리스트를 찾을 수 없습니다.", "warning"); return; }
                this.setlistId = setlist.id;
                this.setlistName = setlist.name || "";
                this.items = (setlist.items || []).map((it) => ({
                    itemId: `srv-${it.itemId}`,
                    type: it.type,
                    payload: it.payload || {}
                }));
                this.settings = setlist.settings || {};
                this.dom.setlistName.value = this.setlistName;
                this.undoStack = [];
                this.redoStack = [];
                this.applyBackgroundImage();
                this.clearDirty();
                this.closeModal(this.dom.loadModal);
                this.renderAll();
                this.updateUndoRedoButtons();
            } catch (error) {
                this.setStatus(`불러오기 실패: ${error.message}`, "warning");
            }
        }

        async deleteSetlist(id) {
            if (!confirm("이 셋리스트를 삭제할까요?")) return;
            try {
                await window.SetlistStorage.remove(id);
                if (this.setlistId === id) {
                    this.setlistId = null;
                    this.setlistName = "";
                    this.items = [];
                    this.settings = {};
                    this.dom.setlistName.value = "";
                    this.applyBackgroundImage();
                    this.clearDirty();
                    this.renderAll();
                }
                const list = await window.SetlistStorage.list();
                this.renderLoadList(list);
            } catch (error) {
                this.setStatus(`삭제 실패: ${error.message}`, "warning");
            }
        }

        // ── 검색 ──

        searchSongs(query) {
            const normalizedQuery = normalizeSearchText(query);
            if (!normalizedQuery) return [];
            const tokens = normalizedQuery.split(" ").filter(Boolean);
            return this.searchIndex
                .filter((entry) => tokens.every((token) => entry.haystack.includes(token)))
                .sort((a, b) => {
                    const aTitleMatch = tokens.every((token) => a.titleText.includes(token));
                    const bTitleMatch = tokens.every((token) => b.titleText.includes(token));
                    if (aTitleMatch !== bTitleMatch) return aTitleMatch ? -1 : 1;
                    return compareSongIds(a.id, b.id);
                })
                .slice(0, 10);
        }

        renderSearchResults() {
            const normalizedQuery = normalizeSearchText(this.searchQuery);
            if (!normalizedQuery) {
                this.dom.searchResults.innerHTML = '<div class="present-search-meta">제목이나 가사를 입력하면 곡을 찾을 수 있습니다.</div>';
                return;
            }
            const tokens = normalizedQuery.split(" ").filter(Boolean);
            const results = this.searchSongs(this.searchQuery);
            if (results.length === 0) {
                this.dom.searchResults.innerHTML = '<div class="present-search-meta">검색 결과가 없습니다.</div>';
                return;
            }
            this.dom.searchResults.innerHTML = results.map((entry) => {
                const previewSource = entry.lyricSegments.find((segment) =>
                    tokens.some((token) => normalizeSearchText(segment).includes(token))
                ) || getSongPreviewText(entry.song);
                const preview = previewSource.length > 70 ? `${previewSource.slice(0, 70)}...` : previewSource;
                return `
                    <div class="present-search-card">
                        <span class="present-search-title">${escapeHtml(getSongDisplayTitle(entry.song))}</span>
                        <span class="present-search-meta">${escapeHtml(entry.id)}</span>
                        <span class="present-search-snippet">${escapeHtml(preview) || "가사 미리보기가 없습니다."}</span>
                        <button type="button" class="present-search-add" data-add-song="${escapeHtml(entry.id)}">곡 순서에 추가</button>
                    </div>
                `;
            }).join("");
        }

        // ── 아이템 추가/삭제/편집 ──

        addScoreItem(songId) {
            if (!this.songMap[songId]) return;
            this.pushHistory();
            this.items.push({
                itemId: nextLocalId(),
                type: "score",
                payload: { songId }
            });
            this.markDirty();
            this.renderAll();
        }

        addItemOfType(type) {
            if (type === "blank") {
                this.pushHistory();
                this.items.push({
                    itemId: nextLocalId(),
                    type: "blank",
                    payload: { background: "" }
                });
                this.markDirty();
                this.renderAll();
            } else if (type === "text") {
                this.openTextModal(null);
            } else if (type === "media") {
                this.openImageModal(null);
            }
        }

        handleItemEdit(itemId) {
            const item = this.findItem(itemId);
            if (!item) return;
            if (item.type === "score") {
                const songId = item.payload && item.payload.songId;
                if (songId) window.open(`editor.html?song=${encodeURIComponent(songId)}`, "_blank");
            } else if (item.type === "text") {
                this.openTextModal(itemId);
            } else if (item.type === "media") {
                this.openImageModal(itemId);
            } else if (item.type === "blank") {
                // 빈 페이지는 현재 편집할 게 없음 (추후 배경색 토글 자리)
            }
        }

        removeItem(itemId) {
            const idx = this.items.findIndex((it) => it.itemId === itemId);
            if (idx < 0) return;
            this.pushHistory();
            this.items.splice(idx, 1);
            this.markDirty();
            this.renderAll();
        }

        findItem(itemId) {
            return this.items.find((it) => it.itemId === itemId);
        }

        moveItem(fromIndex, toIndex) {
            if (fromIndex === toIndex) return;
            if (fromIndex < 0 || fromIndex >= this.items.length) return;
            toIndex = Math.max(0, Math.min(this.items.length - 1, toIndex));
            this.pushHistory();
            const [it] = this.items.splice(fromIndex, 1);
            this.items.splice(toIndex, 0, it);
            this.markDirty();
            this.renderAll();
        }

        // ── 아이템 인라인 메뉴 ──

        openItemMenuAt(itemId, clientX, clientY) {
            this.itemMenuTargetItemId = itemId;
            const menu = this.dom.itemMenu;
            const idx = this.items.findIndex((it) => it.itemId === itemId);
            if (idx < 0) return;
            this.dom.moveTarget.value = idx + 1;
            this.dom.moveTarget.max = this.items.length;

            const item = this.findItem(itemId);
            const editBtn = menu.querySelector("[data-item-action='edit']");
            if (editBtn) editBtn.hidden = !item || item.type === "blank";

            menu.hidden = false;
            menu.style.visibility = "hidden";
            menu.style.top = "0px";
            menu.style.left = "0px";
            const pRect = menu.getBoundingClientRect();
            let top = clientY;
            let left = clientX;
            if (top + pRect.height > window.innerHeight - 10) top = window.innerHeight - pRect.height - 10;
            if (left + pRect.width > window.innerWidth - 10) left = window.innerWidth - pRect.width - 10;
            menu.style.top = `${Math.max(10, top)}px`;
            menu.style.left = `${Math.max(10, left)}px`;
            menu.style.visibility = "";
        }

        gotoItemFirstSlide(itemId) {
            if (!this.itemStartIndex) return;
            const start = this.itemStartIndex[itemId];
            if (typeof start === "number") this.showGlobalSlide(start);
        }

        closeItemMenu() {
            this.dom.itemMenu.hidden = true;
            this.itemMenuTargetItemId = null;
        }

        handleItemMenuEdit() {
            const itemId = this.itemMenuTargetItemId;
            this.closeItemMenu();
            if (itemId) this.handleItemEdit(itemId);
        }

        handleItemMenuDelete() {
            const itemId = this.itemMenuTargetItemId;
            this.closeItemMenu();
            if (itemId) this.removeItem(itemId);
        }

        handleItemMenuMove(mode) {
            const itemId = this.itemMenuTargetItemId;
            if (!itemId) return;
            const idx = this.items.findIndex((it) => it.itemId === itemId);
            if (idx < 0) return;
            let target = idx;
            if (mode === "top") target = 0;
            else if (mode === "bottom") target = this.items.length - 1;
            else if (mode === "up") target = Math.max(0, idx - 1);
            else if (mode === "down") target = Math.min(this.items.length - 1, idx + 1);
            else if (mode === "absolute") {
                const v = parseInt(this.dom.moveTarget.value, 10);
                if (!Number.isFinite(v)) return;
                target = Math.max(0, Math.min(this.items.length - 1, v - 1));
            }
            this.closeItemMenu();
            this.moveItem(idx, target);
        }

        // ── 텍스트 모달 ──

        openTextModal(itemId) {
            this.closeAllModals();
            this.editingItemId = itemId;
            this.editingType = "text";
            const item = itemId ? this.findItem(itemId) : null;
            this.dom.textTitle.value = (item && item.payload && item.payload.title) || "";
            this.dom.textBody.value = (item && item.payload && item.payload.body) || "";
            this.updateTextPreview();
            this.dom.textModal.hidden = false;
            setTimeout(() => this.dom.textBody.focus(), 40);
        }

        updateTextPreview() {
            this.dom.textPreview.innerHTML = renderMarkdown(this.dom.textBody.value);
            renderKatexIn(this.dom.textPreview);
        }

        saveTextModal() {
            const title = this.dom.textTitle.value.trim();
            const body = this.dom.textBody.value;
            if (!title && !body.trim()) {
                this.setStatus("내용을 입력하세요.", "warning");
                return;
            }
            this.pushHistory();
            if (this.editingItemId) {
                const item = this.findItem(this.editingItemId);
                if (item) item.payload = { title, body };
            } else {
                this.items.push({
                    itemId: nextLocalId(),
                    type: "text",
                    payload: { title, body }
                });
            }
            this.editingItemId = null;
            this.markDirty();
            this.closeModal(this.dom.textModal);
            this.renderAll();
        }

        // ── 이미지 모달 ──

        openImageModal(itemId) {
            this.closeAllModals();
            this.editingItemId = itemId;
            this.editingType = "media";
            const item = itemId ? this.findItem(itemId) : null;
            if (item && item.payload) {
                this.draftImagePayload = deepClone(item.payload);
            } else {
                this.draftImagePayload = { mediaId: null, filename: "", url: "", fit: "contain", caption: "" };
            }
            this.dom.imageCaption.value = this.draftImagePayload.caption || "";
            this.setImageFit(this.draftImagePayload.fit || "contain");
            this.refreshImagePreview();
            this.dom.imageFile.value = "";
            this.dom.imageModal.hidden = false;
        }

        refreshImagePreview() {
            const url = this.draftImagePayload && this.draftImagePayload.url;
            if (url) {
                this.dom.imagePreview.innerHTML = `<img src="${escapeHtml(url)}" alt="preview">`;
                this.dom.imagePreview.style.background = this.draftImagePayload.fit === "cover" ? "#000" : "#fafafa";
            } else {
                this.dom.imagePreview.innerHTML = '<span class="present-image-placeholder">이미지를 업로드하세요 (최대 50MB)</span>';
            }
        }

        setImageFit(fit) {
            if (!this.draftImagePayload) return;
            this.draftImagePayload.fit = fit;
            this.dom.imageModal.querySelectorAll(".present-fit-toggle button").forEach((btn) => {
                btn.classList.toggle("is-active", btn.dataset.fit === fit);
            });
        }

        async handleImageFileChange(event) {
            const file = event.target.files && event.target.files[0];
            if (!file) return;
            if (file.size > 50 * 1024 * 1024) {
                this.setStatus("파일 크기는 50MB까지 지원합니다.", "warning");
                return;
            }
            try {
                const uploaded = await window.SetlistStorage.uploadImage(file);
                this.draftImagePayload.mediaId = uploaded.id;
                this.draftImagePayload.filename = uploaded.filename;
                this.draftImagePayload.url = uploaded.url;
                this.refreshImagePreview();
            } catch (error) {
                this.setStatus(`업로드 실패: ${error.message}`, "warning");
            }
        }

        saveImageModal() {
            if (!this.draftImagePayload || !this.draftImagePayload.url) {
                this.setStatus("이미지를 업로드하세요.", "warning");
                return;
            }
            this.draftImagePayload.caption = this.dom.imageCaption.value;
            this.pushHistory();
            if (this.editingItemId) {
                const item = this.findItem(this.editingItemId);
                if (item) item.payload = deepClone(this.draftImagePayload);
            } else {
                this.items.push({
                    itemId: nextLocalId(),
                    type: "media",
                    payload: deepClone(this.draftImagePayload)
                });
            }
            this.editingItemId = null;
            this.draftImagePayload = null;
            this.markDirty();
            this.closeModal(this.dom.imageModal);
            this.renderAll();
        }

        // ── 렌더링 ──

        renderAll() {
            this.renderSearchResults();
            this.renderSetlist();
            this.rebuildPresentation();
        }

        renderSetlist() {
            if (this.items.length === 0) {
                this.dom.setlist.innerHTML = '<div class="present-setlist-empty">곡 검색 또는 ＋ 추가에서 아이템을 넣으세요.</div>';
                return;
            }
            this.dom.setlist.innerHTML = this.items.map((item, index) => this.renderItemCard(item, index)).join("");
            this.bindDragEvents();
        }

        renderItemCard(item, index) {
            const typeIcon = { score: "♪", blank: "◻", text: "T", media: "🖼" }[item.type] || "?";
            let title = "", meta = "";
            if (item.type === "score") {
                const songId = item.payload && item.payload.songId;
                const hymn = songId ? this.songMap[songId] : null;
                title = hymn ? getSongDisplayTitle(hymn) : (songId ? `(누락) ${songId}` : "(없음)");
                meta = songId || "";
            } else if (item.type === "blank") {
                title = "빈 페이지";
                meta = "테마 배경";
            } else if (item.type === "text") {
                const t = (item.payload && item.payload.title) || "";
                const b = (item.payload && item.payload.body) || "";
                title = t || (b.split("\n").find(Boolean) || "(빈 텍스트)").replace(/^#+\s*/, "").slice(0, 40);
                meta = "텍스트";
            } else if (item.type === "media") {
                title = (item.payload && item.payload.caption) || "이미지";
                meta = (item.payload && item.payload.fit) || "contain";
            }
            return `
                <div class="present-setlist-card" draggable="true" data-item-id="${item.itemId}" data-item-type="${item.type}" data-index="${index}">
                    <span class="present-setlist-order">${index + 1}</span>
                    <span class="present-setlist-type-icon">${typeIcon}</span>
                    <div class="present-setlist-info">
                        <span class="present-setlist-title">${escapeHtml(title)}</span>
                        <span class="present-setlist-meta">${escapeHtml(meta)}</span>
                    </div>
                </div>
            `;
        }

        bindDragEvents() {
            const cards = this.dom.setlist.querySelectorAll(".present-setlist-card");
            cards.forEach((card) => {
                card.addEventListener("dragstart", (event) => {
                    this.dragSourceItemId = card.dataset.itemId;
                    card.classList.add("is-dragging");
                    event.dataTransfer.effectAllowed = "move";
                });
                card.addEventListener("dragend", () => {
                    card.classList.remove("is-dragging");
                    this.dragSourceItemId = null;
                    cards.forEach((c) => c.classList.remove("drag-over"));
                });
                card.addEventListener("dragover", (event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    card.classList.add("drag-over");
                });
                card.addEventListener("dragleave", () => { card.classList.remove("drag-over"); });
                card.addEventListener("drop", (event) => {
                    event.preventDefault();
                    card.classList.remove("drag-over");
                    const targetId = card.dataset.itemId;
                    if (this.dragSourceItemId && this.dragSourceItemId !== targetId) {
                        const from = this.items.findIndex((it) => it.itemId === this.dragSourceItemId);
                        const to = this.items.findIndex((it) => it.itemId === targetId);
                        if (from >= 0 && to >= 0) this.moveItem(from, to);
                    }
                    this.dragSourceItemId = null;
                });
            });
        }

        // ── 프레젠테이션 빌드 ──

        buildSlidesForItem(item) {
            if (item.type === "score") {
                const songId = item.payload && item.payload.songId;
                const hymn = songId ? this.songMap[songId] : null;
                if (!hymn) return [];
                return this.buildSlidesForHymn(normalizeHymnPitchLabels(deepClone(hymn)));
            }
            if (item.type === "blank") {
                return [{
                    type: "blank",
                    html: `<div class="slide slide-blank"><div class="slide-content"></div></div>`,
                    notes: null
                }];
            }
            if (item.type === "text") {
                const title = (item.payload && item.payload.title) || "";
                const body = (item.payload && item.payload.body) || "";
                return [{
                    type: "text",
                    html: `
                        <div class="slide slide-text">
                            <div class="slide-content">
                                ${title ? `<div class="slide-text-title">${escapeHtml(title)}</div>` : ""}
                                <div class="slide-text-body">${renderMarkdown(body)}</div>
                            </div>
                        </div>
                    `,
                    notes: null
                }];
            }
            if (item.type === "media") {
                const url = (item.payload && item.payload.url) || "";
                const fit = (item.payload && item.payload.fit) || "contain";
                const caption = (item.payload && item.payload.caption) || "";
                return [{
                    type: "media",
                    html: `
                        <div class="slide slide-media" data-fit="${escapeHtml(fit)}">
                            <div class="slide-content">
                                ${url ? `<img src="${escapeHtml(url)}" alt="slide image">` : ""}
                                ${caption ? `<div class="slide-media-caption">${escapeHtml(caption)}</div>` : ""}
                            </div>
                        </div>
                    `,
                    notes: null
                }];
            }
            return [];
        }

        buildSlidesForHymn(hymn) {
            const slides = [];
            const showNotes = hasRenderableNotes(hymn);
            const songRef = getSongReference(hymn);
            const songTitle = getSongDisplayTitle(hymn);

            const subtitle = getSongCategory(hymn) === "hymn" && hymn.newNumber
                ? `새찬송가 ${hymn.newNumber}장`
                : (hymn.subtitle || "");

            slides.push({
                type: "title",
                html: `
                    <div class="slide title-slide">
                        <div class="slide-content">
                            <div class="hymn-number">${escapeHtml(songRef || getSongId(hymn))}</div>
                            <div class="hymn-title">${escapeHtml(hymn.title || "")}</div>
                            ${subtitle ? `<div class="hymn-subtitle">${escapeHtml(subtitle)}</div>` : ""}
                            <div class="hymn-meta">${escapeHtml(hymn.key || "")} | ${escapeHtml(hymn.timeSignature || "")} | ${escapeHtml(hymn.composer || "")}</div>
                        </div>
                    </div>
                `,
                notes: null
            });

            if (hymn.verses) {
                const verseNumbers = Object.keys(hymn.verses).sort((a, b) => parseInt(a) - parseInt(b));
                const totalVerses = verseNumbers.length;

                for (const verseNum of verseNumbers) {
                    const verse = hymn.verses[verseNum];
                    const slideCount = Math.max((verse.korean || []).length, (verse.english || []).length);

                    for (let i = 0; i < slideCount; i++) {
                        const korean = (verse.korean || [])[i] || "";
                        const english = (verse.english || [])[i] || "";
                        const notesData = showNotes && verse.notes && verse.notes[i] ? verse.notes[i] : null;
                        const notesClass = notesData ? "with-notes" : "";

                        slides.push({
                            type: "verse",
                            html: `
                                <div class="slide">
                                    <div class="slide-content">
                                        <div class="slide-title">${escapeHtml(songTitle)}</div>
                                        <div class="lyrics-content ${notesClass}">
                                            <div class="verse-badge"><span class="current">${verseNum}절</span>/<span class="total">${totalVerses}절</span></div>
                                            <div class="lyrics-korean" data-has-notes="${!!notesData}">${korean.replace(/<br\/>/g, "<br>")}</div>
                                            ${english ? `<div class="lyrics-english">${english.replace(/<br\/>/g, "<br>")}</div>` : ""}
                                        </div>
                                    </div>
                                </div>
                            `,
                            notes: notesData,
                            timeSignature: hymn.timeSignature,
                            key: hymn.key
                        });
                    }

                    if (hymn.chorus && hymn.chorus.korean && hymn.chorus.korean.length > 0) {
                        const chorus = hymn.chorus;
                        for (let i = 0; i < chorus.korean.length; i++) {
                            const korean = chorus.korean[i] || "";
                            const english = (chorus.english || [])[i] || "";
                            const notesData = showNotes && chorus.notes && chorus.notes[i] ? chorus.notes[i] : null;
                            const notesClass = notesData ? "with-notes" : "";

                            slides.push({
                                type: "chorus",
                                html: `
                                    <div class="slide">
                                        <div class="slide-content">
                                            <div class="slide-title">${escapeHtml(songTitle)}</div>
                                            <div class="lyrics-content ${notesClass}">
                                                <div class="chorus-badge"><span class="current">후렴</span>/<span class="total">${totalVerses}절</span></div>
                                                <div class="lyrics-korean" data-has-notes="${!!notesData}">${korean.replace(/<br\/>/g, "<br>")}</div>
                                                ${english ? `<div class="lyrics-english">${english.replace(/<br\/>/g, "<br>")}</div>` : ""}
                                            </div>
                                        </div>
                                    </div>
                                `,
                                notes: notesData,
                                timeSignature: hymn.timeSignature,
                                key: hymn.key
                            });
                        }
                    }
                }
            }

            return slides;
        }

        rebuildPresentation() {
            this.slideData = [];
            const container = this.dom.presentationContainer;

            if (this.items.length === 0) {
                container.innerHTML = "";
                this.allSlides = [];
                this.updateCounter();
                return;
            }

            this.itemStartIndex = {};
            for (const item of this.items) {
                this.itemStartIndex[item.itemId] = this.slideData.length;
                const slides = this.buildSlidesForItem(item);
                slides.forEach((s) => {
                    s.itemId = item.itemId;
                    this.slideData.push(s);
                });
            }

            container.innerHTML = this.slideData.map((s) => s.html).join("");
            this.allSlides = Array.from(container.querySelectorAll(".slide"));
            this.renderAllNotes();
            container.querySelectorAll(".slide-text-body").forEach((el) => renderKatexIn(el));

            const idx = Math.min(this.currentGlobalIndex, this.allSlides.length - 1);
            this.currentGlobalIndex = idx < 0 ? 0 : idx;
            this.showGlobalSlide(this.currentGlobalIndex);
        }

        renderAllNotes() {
            if (!window.NotesEngine) return;
            const notesEngine = new NotesEngine(getNotesTheme());
            this.allSlides.forEach((slideEl, index) => {
                const data = this.slideData[index];
                if (!data || !data.notes) return;
                const koreanEl = slideEl.querySelector(".lyrics-korean");
                if (koreanEl) notesEngine.addNotationToLyrics(koreanEl, data.notes, data.timeSignature, data.key);
            });
        }

        showGlobalSlide(index) {
            if (this.allSlides.length === 0) { this.updateCounter(); return; }
            if (index < 0) index = 0;
            if (index >= this.allSlides.length) index = this.allSlides.length - 1;
            this.allSlides.forEach((el, i) => { el.classList.toggle("active", i === index); });
            this.currentGlobalIndex = index;
            this.updateCounter();
            this.updateActiveCard();

            const data = this.slideData && this.slideData[index];
            if (data && data.notes && window.NotesEngine) {
                const slideEl = this.allSlides[index];
                const koreanEl = slideEl.querySelector(".lyrics-korean");
                if (koreanEl) {
                    requestAnimationFrame(() => {
                        const notesEngine = new NotesEngine(getNotesTheme());
                        notesEngine.renderNotations(koreanEl, data.notes, data.key);
                    });
                }
            }
        }

        nextSlide() {
            if (this.currentGlobalIndex < this.allSlides.length - 1) this.showGlobalSlide(this.currentGlobalIndex + 1);
        }
        prevSlide() {
            if (this.currentGlobalIndex > 0) this.showGlobalSlide(this.currentGlobalIndex - 1);
        }

        updateActiveCard() {
            const data = this.slideData && this.slideData[this.currentGlobalIndex];
            const activeItemId = data && data.itemId;
            this.dom.setlist.querySelectorAll(".present-setlist-card").forEach((card) => {
                card.classList.toggle("is-active", card.dataset.itemId === activeItemId);
            });
        }

        updateCounter() {
            if (this.allSlides.length === 0) { this.dom.counter.textContent = ""; return; }
            this.dom.counter.textContent = `${this.currentGlobalIndex + 1} / ${this.allSlides.length}`;
        }

        toggleFullscreen() {
            if (!document.fullscreenElement) document.documentElement.requestFullscreen();
            else document.exitFullscreen();
        }

        applyBackgroundImage() {
            const bg = this.settings && this.settings.bgImage;
            const url = bg && bg.url;
            if (url) {
                document.body.style.setProperty("--present-bg-image", `url("${url}")`);
                document.body.classList.add("has-bg-image");
                this.dom.bgPreview.style.backgroundImage = `url("${url}")`;
                this.dom.bgPreview.classList.add("has-image");
                this.dom.bgPreview.innerHTML = "";
                this.dom.bgClear.hidden = false;
            } else {
                document.body.style.removeProperty("--present-bg-image");
                document.body.classList.remove("has-bg-image");
                this.dom.bgPreview.style.backgroundImage = "";
                this.dom.bgPreview.classList.remove("has-image");
                this.dom.bgPreview.innerHTML = '<span class="present-bg-placeholder">설정된 배경 없음 (최대 50MB)</span>';
                this.dom.bgClear.hidden = true;
            }
        }

        async handleBgFileChange(event) {
            const file = event.target.files && event.target.files[0];
            event.target.value = "";
            if (!file) return;
            if (file.size > 50 * 1024 * 1024) {
                this.setStatus("파일 크기는 50MB까지 지원합니다.", "warning");
                return;
            }
            try {
                const uploaded = await window.SetlistStorage.uploadImage(file);
                this.pushHistory();
                this.settings = this.settings || {};
                this.settings.bgImage = {
                    mediaId: uploaded.id,
                    filename: uploaded.filename,
                    url: uploaded.url
                };
                this.markDirty();
                this.applyBackgroundImage();
            } catch (error) {
                this.setStatus(`업로드 실패: ${error.message}`, "warning");
            }
        }

        clearBackgroundImage() {
            if (!this.settings || !this.settings.bgImage) return;
            this.pushHistory();
            delete this.settings.bgImage;
            this.markDirty();
            this.applyBackgroundImage();
        }

        setStatus(message, tone) {
            if (!message) {
                this.dom.status.hidden = true;
                this.dom.status.textContent = "";
                this.dom.status.className = "present-status";
                return;
            }
            this.dom.status.hidden = false;
            this.dom.status.textContent = message;
            this.dom.status.className = `present-status ${tone || "info"}`;
        }
    }

    document.addEventListener("DOMContentLoaded", () => {
        const app = new PresentMode();
        app.init();
    });
})();
