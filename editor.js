(function () {
    const DEFAULT_HYMN_ID = "46";
    const DURATION_ORDER = ["16", "8", "q", "h", "w"];
    const CLICK_DELAY_MS = 220;
    const CHORUS_MARKER_PATTERN = /<\s*후렴\s*>/gi;
    const PITCH_LABEL_VERSION = 2;
    const LEGACY_PITCH_SHIFT_DOWN = {
        C4: "B3",
        D4: "C4",
        E4: "D4",
        F4: "E4",
        G4: "F4",
        A4: "G4",
        B4: "A4",
        C5: "B4",
        D5: "C5",
        E5: "D5",
        F5: "E5",
        G5: "F5",
        A5: "G5",
        B5: "A5",
        C6: "B5",
        D6: "C6",
        E6: "D6"
    };
    const NOTE_LENGTH_OPTIONS = [
        { label: "8분", value: "8" },
        { label: "4분", value: "q" },
        { label: "2분", value: "h" },
        { label: "1분", value: "w" }
    ];

    function isPlainObject(value) {
        return Object.prototype.toString.call(value) === "[object Object]";
    }

    function deepClone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function deepMerge(base, override) {
        if (override === undefined) {
            return deepClone(base);
        }

        if (Array.isArray(base) || Array.isArray(override)) {
            return deepClone(override);
        }

        if (isPlainObject(base) && isPlainObject(override)) {
            const merged = {};
            const keys = new Set([...Object.keys(base), ...Object.keys(override)]);

            for (const key of keys) {
                if (override[key] === undefined) {
                    merged[key] = deepClone(base[key]);
                } else if (base[key] === undefined) {
                    merged[key] = deepClone(override[key]);
                } else {
                    merged[key] = deepMerge(base[key], override[key]);
                }
            }

            return merged;
        }

        return deepClone(override);
    }

    function shiftPitchLabelsInNotes(notes) {
        if (Array.isArray(notes)) {
            notes.forEach((item) => shiftPitchLabelsInNotes(item));
            return;
        }

        if (!notes || typeof notes !== "object") {
            return;
        }

        if (typeof notes.pitch === "string") {
            notes.pitch = LEGACY_PITCH_SHIFT_DOWN[notes.pitch] || notes.pitch;
            return;
        }

        Object.keys(notes).forEach((key) => shiftPitchLabelsInNotes(notes[key]));
    }

    function normalizeHymnPitchLabels(hymn) {
        if (!hymn || typeof hymn !== "object") {
            return hymn;
        }

        if (hymn.pitchLabelVersion === PITCH_LABEL_VERSION) {
            return hymn;
        }

        if (hymn.verses && typeof hymn.verses === "object") {
            Object.values(hymn.verses).forEach((verse) => {
                if (verse && Array.isArray(verse.notes)) {
                    shiftPitchLabelsInNotes(verse.notes);
                }
            });
        }

        if (hymn.chorus && Array.isArray(hymn.chorus.notes)) {
            shiftPitchLabelsInNotes(hymn.chorus.notes);
        }

        hymn.pitchLabelVersion = PITCH_LABEL_VERSION;
        return hymn;
    }

    function getRequestedHymnId() {
        const params = new URLSearchParams(window.location.search);
        const queryValue = params.get("hymn");
        const hashValue = window.location.hash.replace(/^#/, "");
        const candidate = queryValue || hashValue || DEFAULT_HYMN_ID;
        return /^\d+$/.test(candidate) ? candidate : DEFAULT_HYMN_ID;
    }

    function setRequestedHymnId(hymnId) {
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set("hymn", hymnId);
        nextUrl.hash = hymnId;
        window.history.replaceState({}, "", nextUrl.toString());
    }

    function splitLines(text) {
        if (!text) {
            return [];
        }
        return text.split(/<br\s*\/?>/gi);
    }

    function joinLines(lines) {
        return lines.join("<br/>");
    }

    function getEditableLines(text) {
        const lines = splitLines(text);
        return lines.length > 0 ? lines : [""];
    }

    function getStoredLines(text) {
        return text ? splitLines(text) : [];
    }

    function hasChorusMarker(text) {
        return /<\s*후렴\s*>/i.test(String(text || ""));
    }

    function stripChorusMarker(text) {
        return String(text || "")
            .replace(CHORUS_MARKER_PATTERN, "")
            .replace(/[ \t]{2,}/g, " ")
            .replace(/(?:<br\s*\/?>\s*){2,}/gi, "<br/>")
            .trim();
    }

    function countNotationChars(text, endOffset = text.length) {
        let count = 0;

        for (let i = 0; i < Math.min(endOffset, text.length); i++) {
            const char = text[i];
            if (char !== " " && char !== "\n") {
                count += 1;
            }
        }

        return count;
    }

    function cloneLineNotes(lineNotes) {
        if (!Array.isArray(lineNotes)) {
            return [];
        }

        return lineNotes.map((note) => (note ? { ...note } : null));
    }

    function joinStoredLines(lines) {
        return lines.length > 0 ? joinLines(lines) : "";
    }

    function hasNoteData(note) {
        return !!(note && note.pitch);
    }

    function trimTrailingNulls(lineNotes) {
        const next = lineNotes.slice();
        while (next.length > 0 && !hasNoteData(next[next.length - 1])) {
            next.pop();
        }
        return next;
    }

    function buildOptions(hymnNumber) {
        const demoNumber = window.DEMO_HYMN_DATA && window.DEMO_HYMN_DATA.hymn
            ? window.DEMO_HYMN_DATA.hymn.number
            : DEFAULT_HYMN_ID;

        return {
            useBackground: false,
            backgroundImage: null,
            backgroundOpacity: 0.7,
            showNotes: hymnNumber === demoNumber
        };
    }

    function buildKeyString(type, count) {
        if (!type || !count || count <= 0) {
            return "";
        }

        return `${count}${type === "flat" ? "b" : "#"}`;
    }

    function getBaseDuration(duration) {
        if (!duration) {
            return "q";
        }

        return duration.endsWith(".") ? duration.slice(0, -1) : duration;
    }

    function isBeamableDuration(duration) {
        const base = getBaseDuration(duration);
        return base === "8" || base === "16";
    }

    class HymnEditor {
        constructor() {
            this.notesEngine = new NotesEngine({
                staffHeight: 46,
                staffColor: "#8d887d",
                noteColor: "#111",
                previewColor: "#b8b0a3"
            });

            this.dom = {
                hymnForm: document.getElementById("editor-hymn-form"),
                hymnNumber: document.getElementById("editor-hymn-number"),
                hymnTitle: document.getElementById("editor-hymn-title"),
                hymnMeta: document.getElementById("editor-hymn-meta"),
                savedList: document.getElementById("editor-saved-list"),
                slideList: document.getElementById("editor-slide-list"),
                canvas: document.getElementById("editor-canvas"),
                status: document.getElementById("editor-status"),
                toggleMode: document.getElementById("editor-toggle-mode"),
                toggleDot: document.getElementById("editor-toggle-dot"),
                toggleBeam: document.getElementById("editor-toggle-beam"),
                applyBeam: document.getElementById("editor-apply-beam"),
                clearBeam: document.getElementById("editor-clear-beam"),
                addSlide: document.getElementById("editor-add-slide"),
                removeSlide: document.getElementById("editor-remove-slide"),
                prevSlide: document.getElementById("editor-prev-slide"),
                nextSlide: document.getElementById("editor-next-slide"),
                saveHymn: document.getElementById("editor-save-hymn"),
                deleteSaved: document.getElementById("editor-delete-saved"),
                importJson: document.getElementById("editor-import-json"),
                importFile: document.getElementById("editor-import-file"),
                undo: document.getElementById("editor-undo"),
                redo: document.getElementById("editor-redo"),
                exportJson: document.getElementById("editor-export-json"),
                downloadJson: document.getElementById("editor-download-json"),
                exportOutput: document.getElementById("editor-export-output")
            };

            this.hymnMap = null;
            this.data = null;
            this.slides = [];
            this.currentSlideIndex = 0;
            this.hoveredTarget = null;
            this.pendingClickTimer = null;
            this.datasetReady = false;
            this.isEditMode = true;
            this.isDotMode = false;
            this.isBeamMode = false;
            this.dragState = null;
            this.beamDragState = null;
            this.suppressClickUntil = 0;
            this.layoutRefreshFrame = null;
            this.selectedBeamNotes = [];
            this.selectedNoteTarget = null;
            this.noteMenuMode = "main";
            this.undoStack = [];
            this.redoStack = [];
            this.pendingTextHistory = null;
            this.isRestoringHistory = false;
            this.savedHymnList = [];
            this.skipNextEditableBlur = false;
        }

        async init() {
            this.bindControls();
            if (this.dom.toggleDot) {
                this.dom.toggleDot.hidden = true;
            }
            if (this.dom.toggleBeam) {
                this.dom.toggleBeam.hidden = true;
            }
            if (this.dom.applyBeam) {
                this.dom.applyBeam.hidden = true;
            }
            if (this.dom.clearBeam) {
                this.dom.clearBeam.hidden = true;
            }
            await this.loadInitialHymn();
        }

        bindControls() {
            this.dom.hymnForm.addEventListener("submit", (event) => {
                event.preventDefault();
                const hymnId = this.dom.hymnNumber.value.trim();

                if (!/^\d+$/.test(hymnId)) {
                    this.setStatus("곡 번호는 숫자로 입력해 주세요.", "warning");
                    this.dom.hymnNumber.focus();
                    return;
                }

                if (!this.datasetReady && hymnId !== DEFAULT_HYMN_ID) {
                    this.setStatus("지금은 `hymns.json`을 읽을 수 없어 46장 데모만 편집할 수 있습니다.", "warning");
                    return;
                }

                this.loadHymn(hymnId);
            });

            this.dom.slideList.addEventListener("click", (event) => {
                const button = event.target.closest("[data-slide-index]");
                if (!button) {
                    return;
                }

                this.showSlide(parseInt(button.dataset.slideIndex, 10));
            });

            this.dom.savedList.addEventListener("click", async (event) => {
                const loadButton = event.target.closest("[data-load-saved-hymn]");
                if (loadButton) {
                    this.loadHymn(loadButton.dataset.loadSavedHymn);
                    return;
                }

                const deleteButton = event.target.closest("[data-delete-saved-hymn]");
                if (deleteButton) {
                    await this.deleteSavedHymn(deleteButton.dataset.deleteSavedHymn);
                }
            });

            this.dom.prevSlide.addEventListener("click", () => this.showSlide(this.currentSlideIndex - 1));
            this.dom.nextSlide.addEventListener("click", () => this.showSlide(this.currentSlideIndex + 1));
            this.dom.toggleMode.addEventListener("click", () => this.toggleEditMode());
            this.dom.toggleDot.addEventListener("click", () => this.toggleDotMode());
            this.dom.toggleBeam.addEventListener("click", () => this.toggleBeamMode());
            this.dom.applyBeam.addEventListener("click", () => this.applySelectedBeamGroup());
            this.dom.clearBeam.addEventListener("click", () => this.clearSelectedBeamGroup());
            this.dom.addSlide.addEventListener("click", () => this.insertSlideAfterCurrent());
            this.dom.removeSlide.addEventListener("click", () => this.removeCurrentSlide());
            this.dom.saveHymn.addEventListener("click", () => this.saveCurrentHymn());
            this.dom.deleteSaved.addEventListener("click", () => this.deleteCurrentSavedHymn());
            this.dom.importJson.addEventListener("click", () => this.dom.importFile.click());
            this.dom.importFile.addEventListener("change", (event) => this.handleImportFile(event));
            this.dom.undo.addEventListener("click", () => this.undo());
            this.dom.redo.addEventListener("click", () => this.redo());
            this.dom.exportJson.addEventListener("click", () => this.copyExportJson());
            this.dom.downloadJson.addEventListener("click", () => this.downloadExportJson());

            this.dom.canvas.addEventListener("mousemove", (event) => this.handleCanvasMouseMove(event));
            this.dom.canvas.addEventListener("mouseleave", () => this.clearHover());
            this.dom.canvas.addEventListener("mousedown", (event) => this.handleCanvasMouseDown(event));
            this.dom.canvas.addEventListener("click", (event) => this.handleCanvasClick(event));
            this.dom.canvas.addEventListener("dblclick", (event) => this.handleCanvasDoubleClick(event));
            this.dom.canvas.addEventListener("input", (event) => this.handleEditableInput(event));
            this.dom.canvas.addEventListener("focusin", (event) => this.handleEditableFocus(event));
            this.dom.canvas.addEventListener("focusout", (event) => this.handleEditableBlur(event));
            this.dom.canvas.addEventListener("keydown", (event) => this.handleEditableKeydown(event));

            document.addEventListener("mousemove", (event) => this.handleDocumentMouseMove(event));
            document.addEventListener("mouseup", (event) => this.handleDocumentMouseUp(event));
            window.addEventListener("resize", () => this.scheduleLayoutRefresh());

            if (document.fonts && document.fonts.ready) {
                document.fonts.ready.then(() => this.scheduleLayoutRefresh());
            }

            document.addEventListener("keydown", (event) => {
                if (this.isTextInput(event.target)) {
                    return;
                }

                if (event.key === "e" || event.key === "E") {
                    event.preventDefault();
                    this.toggleEditMode();
                    return;
                }

                if ((event.ctrlKey || event.metaKey) && !event.shiftKey && (event.key === "z" || event.key === "Z")) {
                    event.preventDefault();
                    this.undo();
                    return;
                }

                if (
                    (event.ctrlKey || event.metaKey)
                    && (
                        event.key === "y"
                        || event.key === "Y"
                        || (event.shiftKey && (event.key === "z" || event.key === "Z"))
                    )
                ) {
                    event.preventDefault();
                    this.redo();
                    return;
                }

                if (event.key === "Escape") {
                    event.preventDefault();
                    if (this.noteMenuMode === "duration") {
                        this.noteMenuMode = "main";
                        this.updateToolbarState();
                        return;
                    }

                    if (this.selectedNoteTarget) {
                        this.clearSelectedNoteTarget();
                        return;
                    }

                    this.clearBeamSelection({ statusMessage: "연결선 선택을 해제했습니다." });
                    return;
                }

                if (this.selectedBeamNotes.length > 0 && (event.key === "Delete" || event.key === "Backspace")) {
                    event.preventDefault();
                    this.clearSelectedBeamGroup();
                }
            });
        }

        isTextInput(target) {
            if (!target) {
                return false;
            }

            const tagName = target.tagName;
            return tagName === "INPUT" || tagName === "TEXTAREA" || target.isContentEditable;
        }

        isEditingLyric() {
            const active = document.activeElement;
            return !!(active && active.isContentEditable && this.dom.canvas.contains(active));
        }

        async loadInitialHymn() {
            if (window.HymnStorage && typeof window.HymnStorage.init === "function") {
                await window.HymnStorage.init();
            }

            this.refreshSavedHymnList();

            try {
                this.hymnMap = await this.loadHymnMap();
                this.datasetReady = true;
            } catch (error) {
                this.datasetReady = false;
                this.setStatus("`hymns.json`을 읽을 수 없어 46장 데모 편집기로 실행했습니다. 로컬 서버에서 열면 전체 곡을 편집할 수 있습니다.", "warning");
            }

            this.loadHymn(getRequestedHymnId());
        }

        async loadHymnMap() {
            const response = await fetch("hymns.json", { cache: "no-store" });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            return response.json();
        }

        getSavedHymn(number) {
            return window.HymnStorage ? window.HymnStorage.getSavedHymn(number) : null;
        }

        hasSavedHymn(number) {
            return window.HymnStorage ? window.HymnStorage.hasSavedHymn(number) : false;
        }

        refreshSavedHymnList() {
            this.savedHymnList = window.HymnStorage ? window.HymnStorage.listSavedHymns() : [];
            this.renderSavedHymnList();
            this.updateToolbarState();
        }

        renderSavedHymnList() {
            if (!this.dom.savedList) {
                return;
            }

            if (this.savedHymnList.length === 0) {
                this.dom.savedList.innerHTML = '<div class="editor-slide-meta">저장된 곡이 없습니다.</div>';
                return;
            }

            const currentNumber = this.data && this.data.hymn ? this.data.hymn.number : "";
            this.dom.savedList.innerHTML = this.savedHymnList.map((item) => `
                <div class="editor-saved-card ${item.number === currentNumber ? "is-active" : ""}">
                    <span class="editor-saved-title">${item.number}장 ${item.title || ""}</span>
                    <span class="editor-saved-meta">${item.updatedAt ? item.updatedAt.replace("T", " ").slice(0, 16) : ""}</span>
                    <div class="editor-saved-actions">
                        <button type="button" data-load-saved-hymn="${item.number}">불러오기</button>
                        <button type="button" data-delete-saved-hymn="${item.number}">삭제</button>
                    </div>
                </div>
            `).join("");
        }

        buildPresentationData(hymnId) {
            const demoData = deepClone(window.DEMO_HYMN_DATA);
            const savedHymn = this.getSavedHymn(hymnId);

            if (savedHymn) {
                const mergedSavedHymn = savedHymn.number === demoData.hymn.number
                    ? deepMerge(savedHymn, demoData.hymn)
                    : deepClone(savedHymn);

                return {
                    options: buildOptions(mergedSavedHymn.number),
                    hymn: normalizeHymnPitchLabels(mergedSavedHymn)
                };
            }

            if (!this.hymnMap) {
                demoData.hymn = normalizeHymnPitchLabels(demoData.hymn);
                return demoData;
            }

            const selectedHymn = this.hymnMap[hymnId] || this.hymnMap[DEFAULT_HYMN_ID];
            const mergedHymn = selectedHymn.number === demoData.hymn.number
                ? deepMerge(selectedHymn, demoData.hymn)
                : deepClone(selectedHymn);

            return {
                options: buildOptions(mergedHymn.number),
                hymn: normalizeHymnPitchLabels(mergedHymn)
            };
        }

        loadHymn(hymnId) {
            const hasSavedVersion = this.hasSavedHymn(hymnId);
            const resolvedId = hasSavedVersion || (this.datasetReady && this.hymnMap && this.hymnMap[hymnId])
                ? hymnId
                : DEFAULT_HYMN_ID;

            this.data = this.buildPresentationData(resolvedId);
            this.buildSlides();
            this.currentSlideIndex = 0;
            this.hoveredTarget = null;
            this.isDotMode = false;
            this.isBeamMode = false;
            this.selectedBeamNotes = [];
            this.selectedNoteTarget = null;
            this.noteMenuMode = "main";
            this.beamDragState = null;
            this.undoStack = [];
            this.redoStack = [];
            this.pendingTextHistory = null;
            this.updateHeader();
            this.renderSlideList();
            if (this.slides.length > 0) {
                this.showSlide(0);
            } else {
                this.dom.canvas.innerHTML = `
                    <section class="editor-slide-card">
                        <header class="editor-slide-header">
                            <div class="editor-slide-title">${this.data.hymn.title}</div>
                            <div class="editor-slide-heading">편집 가능한 가사 슬라이드가 없습니다.</div>
                        </header>
                    </section>
                `;
                this.updateToolbarState();
            }
            this.renderExportJson();
            this.refreshSavedHymnList();
            setRequestedHymnId(resolvedId);

            if (resolvedId !== hymnId && !hasSavedVersion) {
                this.setStatus(`${hymnId}장은 사용할 수 없어 ${resolvedId}장으로 열었습니다.`, "warning");
            } else if (hasSavedVersion) {
                this.setStatus(`${resolvedId}장의 저장본을 불러왔습니다.`);
            } else if (resolvedId === DEFAULT_HYMN_ID) {
                this.setStatus("46장은 데모 악보 데이터가 포함되어 있습니다. 편집 후 JSON으로 내보낼 수 있습니다.");
            } else {
                this.setStatus(`${resolvedId}장을 불러왔습니다. 없는 음표는 직접 입력해 채워 넣을 수 있습니다.`);
            }
        }

        buildSlides() {
            const hymn = this.data.hymn;
            this.normalizeChorusSlides();
            const slides = [];
            const verseNumbers = Object.keys(hymn.verses).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

            for (const verseNum of verseNumbers) {
                const verse = hymn.verses[verseNum];
                if (!Array.isArray(verse.notes)) {
                    verse.notes = [];
                }

                const slideCount = Math.max(verse.korean.length, verse.english.length, verse.notes.length);
                for (let i = 0; i < slideCount; i++) {
                    slides.push({
                        id: `verse-${verseNum}-${i}`,
                        type: "verse",
                        sectionType: "verse",
                        sectionKey: verseNum,
                        slideIndex: i,
                        badge: `${verseNum}절`,
                        label: `${verseNum}절 ${i + 1}번 슬라이드`,
                        korean: verse.korean[i] || "",
                        english: verse.english[i] || "",
                        notes: verse.notes[i] || null,
                        notesOwner: verse.notes,
                        notesIndex: i,
                        koreanOwner: verse.korean,
                        koreanIndex: i,
                        englishOwner: verse.english,
                        englishIndex: i,
                        key: hymn.key,
                        timeSignature: hymn.timeSignature,
                        title: hymn.title
                    });
                }
            }

            if (hymn.chorus && hymn.chorus.korean && hymn.chorus.korean.length > 0) {
                if (!Array.isArray(hymn.chorus.notes)) {
                    hymn.chorus.notes = [];
                }

                for (let i = 0; i < hymn.chorus.korean.length; i++) {
                    slides.push({
                        id: `chorus-${i}`,
                        type: "chorus",
                        sectionType: "chorus",
                        sectionKey: "chorus",
                        slideIndex: i,
                        badge: "후렴",
                        label: `후렴 ${i + 1}번 슬라이드`,
                        korean: hymn.chorus.korean[i] || "",
                        english: hymn.chorus.english[i] || "",
                        notes: hymn.chorus.notes[i] || null,
                        notesOwner: hymn.chorus.notes,
                        notesIndex: i,
                        koreanOwner: hymn.chorus.korean,
                        koreanIndex: i,
                        englishOwner: hymn.chorus.english,
                        englishIndex: i,
                        key: hymn.key,
                        timeSignature: hymn.timeSignature,
                        title: hymn.title
                    });
                }
            }

            this.slides = slides;
        }

        updateHeader() {
            const hymn = this.data.hymn;
            this.dom.hymnNumber.value = hymn.number;
            this.dom.hymnTitle.textContent = `${hymn.number}장 ${hymn.title}`;
            this.dom.hymnMeta.textContent = `${hymn.newNumber ? `새찬송가 ${hymn.newNumber}장 · ` : ""}${hymn.key || "-"} · ${hymn.timeSignature || "-"} · ${hymn.composer || "-"}`;
            document.title = `${hymn.number}장 편집기 - ${hymn.title}`;
            this.updateCurrentSlideMeta();
        }

        updateCurrentSlideMeta() {
            const slide = this.getCurrentSlide();
            if (!slide || !this.dom.canvas) {
                return;
            }

            const submetaValueEl = this.dom.canvas.querySelector(".editor-slide-submeta [data-slide-meta-value]");
            if (submetaValueEl) {
                submetaValueEl.textContent = `${slide.key || "-"} · ${slide.timeSignature || "-"}`;
            }
        }

        renderSlideList() {
            this.dom.slideList.innerHTML = this.slides.map((slide, index) => `
                <button type="button" class="editor-slide-button ${index === this.currentSlideIndex ? "active" : ""}" data-slide-index="${index}">
                    <span class="editor-slide-label">${slide.label}</span>
                    <span class="editor-slide-meta">${splitLines(slide.korean).join(" / ")}</span>
                </button>
            `).join("");
        }

        showSlide(index) {
            if (index < 0 || index >= this.slides.length) {
                return;
            }

            this.currentSlideIndex = index;
            this.hoveredTarget = null;
            this.selectedBeamNotes = [];
            this.selectedNoteTarget = null;
            this.noteMenuMode = "main";
            this.beamDragState = null;
            this.renderSlideList();
            this.renderCurrentSlide();
            this.scheduleLayoutRefresh();
        }

        getCurrentSlide() {
            return this.slides[this.currentSlideIndex] || null;
        }

        renderCurrentSlide() {
            const slide = this.getCurrentSlide();
            if (!slide) {
                return;
            }
            const koreanLines = getEditableLines(slide.korean);
            const englishLines = splitLines(slide.english);

            this.dom.canvas.innerHTML = `
                <section class="editor-slide-card">
                    <header class="editor-slide-header">
                        <div class="editor-slide-title">${slide.title}</div>
                        <div class="editor-slide-heading">${slide.label}</div>
                        <div class="editor-slide-submeta">
                            <span class="editor-slide-badge">${slide.badge}</span>
                            <span data-slide-meta-value>${slide.key || "-"} · ${slide.timeSignature || "-"}</span>
                        </div>
                    </header>

                    <div class="editor-lyrics">
                        ${koreanLines.map((line, lineIndex) => `
                            <div class="editor-line" data-line-index="${lineIndex}">
                                <div class="editor-line-track">
                                    <div class="editor-line-header">${lineIndex + 1}번째 줄</div>
                                    <div class="notation-container edit-mode"></div>
                                    <div
                                        class="editor-line-text"
                                        contenteditable="true"
                                        spellcheck="false"
                                        data-role="korean-line"
                                        data-line-index="${lineIndex}"
                                    >${line}</div>
                                </div>
                            </div>
                        `).join("")}
                    </div>

                    ${englishLines.length > 0 && englishLines.some(Boolean) ? `
                        <div class="editor-english">
                            ${englishLines.map((line, lineIndex) => `
                                <div
                                    class="editor-english-line"
                                    contenteditable="true"
                                    spellcheck="false"
                                    data-role="english-line"
                                    data-line-index="${lineIndex}"
                                >${line}</div>
                            `).join("")}
                        </div>
                    ` : ""}
                </section>
            `;

            this.renderAllLines();
            this.updateToolbarState();
        }

        ensureSectionArrays(section) {
            if (!section || typeof section !== "object") {
                return;
            }

            if (!Array.isArray(section.korean)) {
                section.korean = [];
            }
            if (!Array.isArray(section.english)) {
                section.english = [];
            }
            if (!Array.isArray(section.notes)) {
                section.notes = [];
            }
        }

        normalizeChorusSlides() {
            const hymn = this.data && this.data.hymn;
            if (!hymn) {
                return;
            }

            if (!hymn.verses || typeof hymn.verses !== "object") {
                hymn.verses = {};
            }

            if (!hymn.chorus || typeof hymn.chorus !== "object") {
                hymn.chorus = { korean: [], english: [], notes: [] };
            }

            this.ensureSectionArrays(hymn.chorus);

            const normalizedChorus = {
                korean: [],
                english: [],
                notes: []
            };
            const chorusSlideCount = Math.max(hymn.chorus.korean.length, hymn.chorus.english.length, hymn.chorus.notes.length);
            for (let i = 0; i < chorusSlideCount; i++) {
                normalizedChorus.korean.push(stripChorusMarker(hymn.chorus.korean[i] || ""));
                normalizedChorus.english.push(stripChorusMarker(hymn.chorus.english[i] || ""));
                normalizedChorus.notes.push(hymn.chorus.notes[i] || null);
            }
            hymn.chorus = normalizedChorus;

            const movedSlides = [];
            const verseNumbers = Object.keys(hymn.verses).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

            verseNumbers.forEach((verseNum) => {
                const verse = hymn.verses[verseNum];
                if (!verse || typeof verse !== "object") {
                    hymn.verses[verseNum] = { korean: [], english: [], notes: [] };
                    return;
                }

                this.ensureSectionArrays(verse);
                const slideCount = Math.max(verse.korean.length, verse.english.length, verse.notes.length);
                const nextVerse = {
                    korean: [],
                    english: [],
                    notes: []
                };

                for (let i = 0; i < slideCount; i++) {
                    const rawKorean = verse.korean[i] || "";
                    const rawEnglish = verse.english[i] || "";
                    const cleanedKorean = stripChorusMarker(rawKorean);
                    const cleanedEnglish = stripChorusMarker(rawEnglish);
                    const notes = verse.notes[i] || null;

                    if (hasChorusMarker(rawKorean) || hasChorusMarker(rawEnglish)) {
                        movedSlides.push({
                            korean: cleanedKorean,
                            english: cleanedEnglish,
                            notes
                        });
                        continue;
                    }

                    nextVerse.korean.push(cleanedKorean);
                    nextVerse.english.push(cleanedEnglish);
                    nextVerse.notes.push(notes);
                }

                hymn.verses[verseNum] = nextVerse;
            });

            movedSlides.forEach((slide) => {
                hymn.chorus.korean.push(slide.korean);
                hymn.chorus.english.push(slide.english);
                hymn.chorus.notes.push(slide.notes);
            });
        }

        getSelectionOffsetInEditable(editable) {
            const selection = window.getSelection();
            if (!selection || selection.rangeCount === 0 || !editable.contains(selection.anchorNode)) {
                return (editable.textContent || "").length;
            }

            const range = selection.getRangeAt(0).cloneRange();
            range.selectNodeContents(editable);
            range.setEnd(selection.anchorNode, selection.anchorOffset);
            return range.toString().length;
        }

        placeCaretAtOffset(editable, offset) {
            const safeOffset = Math.max(0, Math.min(offset, (editable.textContent || "").length));
            const selection = window.getSelection();
            const range = document.createRange();
            let remaining = safeOffset;
            let placed = false;
            const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT);

            while (walker.nextNode()) {
                const node = walker.currentNode;
                const textLength = node.textContent.length;
                if (remaining <= textLength) {
                    range.setStart(node, remaining);
                    placed = true;
                    break;
                }
                remaining -= textLength;
            }

            if (!placed) {
                range.selectNodeContents(editable);
                range.collapse(false);
            } else {
                range.collapse(true);
            }

            selection.removeAllRanges();
            selection.addRange(range);
        }

        focusEditableLine(role, lineIndex, offset = 0) {
            window.requestAnimationFrame(() => {
                const selector = role === "korean-line"
                    ? `.editor-line-text[data-role="korean-line"][data-line-index="${lineIndex}"]`
                    : `.editor-english-line[data-role="english-line"][data-line-index="${lineIndex}"]`;
                const editable = this.dom.canvas.querySelector(selector);
                if (!editable) {
                    return;
                }

                editable.focus();
                this.placeCaretAtOffset(editable, offset);
            });
        }

        updateSlideTextLines(slide, role, nextLines) {
            const safeLines = nextLines.length > 0 ? nextLines : [""];
            const joined = joinLines(safeLines);

            if (role === "korean-line") {
                slide.korean = joined;
                slide.koreanOwner[slide.koreanIndex] = joined;
                return;
            }

            slide.english = joined;
            slide.englishOwner[slide.englishIndex] = joined;
        }

        splitStoredText(text, lineIndex, offset, splitWithinLine) {
            const lines = getEditableLines(text);
            const safeIndex = Math.max(0, Math.min(lineIndex, Math.max(lines.length - 1, 0)));

            if (splitWithinLine) {
                const currentLine = lines[safeIndex] || "";
                const beforeText = currentLine.slice(0, offset);
                const afterText = currentLine.slice(offset);
                const currentLines = [...lines.slice(0, safeIndex), beforeText];
                const nextLines = [afterText, ...lines.slice(safeIndex + 1)];
                return {
                    currentText: joinLines(currentLines.length > 0 ? currentLines : [""]),
                    nextText: joinLines(nextLines.length > 0 ? nextLines : [""])
                };
            }

            const currentLines = lines.slice(0, safeIndex);
            const nextLines = lines.slice(safeIndex);
            return {
                currentText: joinLines(currentLines.length > 0 ? currentLines : [""]),
                nextText: joinLines(nextLines.length > 0 ? nextLines : [""])
            };
        }

        normalizeNotesMapValue(notesMap) {
            if (!notesMap || !isPlainObject(notesMap)) {
                return null;
            }

            const normalized = {};
            const lineKeys = Object.keys(notesMap).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

            lineKeys.forEach((lineKey) => {
                const rawLine = Array.isArray(notesMap[lineKey]) ? notesMap[lineKey] : [];
                const trimmedLine = trimTrailingNulls(rawLine).map((note) => note ? { ...note } : null);

                if (trimmedLine.some(hasNoteData)) {
                    normalized[lineKey] = trimmedLine;
                }
            });

            return Object.keys(normalized).length > 0 ? normalized : null;
        }

        cleanupOrphanBeamGroupsInNotesMap(notesMap) {
            if (!notesMap || !isPlainObject(notesMap)) {
                return;
            }

            Object.keys(notesMap).forEach((lineKey) => {
                const lineNotes = notesMap[lineKey];
                if (!Array.isArray(lineNotes)) {
                    return;
                }

                const groups = new Map();
                lineNotes.forEach((note, index) => {
                    if (!hasNoteData(note)) {
                        return;
                    }

                    this.normalizeNoteBeamState(note);
                    if (note.beamGroup === undefined) {
                        return;
                    }

                    if (!groups.has(note.beamGroup)) {
                        groups.set(note.beamGroup, []);
                    }
                    groups.get(note.beamGroup).push(index);
                });

                groups.forEach((indices) => {
                    if (indices.length < 2) {
                        indices.forEach((index) => {
                            if (lineNotes[index]) {
                                delete lineNotes[index].beamGroup;
                            }
                        });
                    }
                });
            });
        }

        splitNotesForNewSlide(slide, lineIndex, charOffset, splitWithinLine) {
            const currentNotesMap = slide.notes && isPlainObject(slide.notes) ? slide.notes : {};
            const current = {};
            const next = {};
            const lineKeys = Object.keys(currentNotesMap)
                .map((key) => parseInt(key, 10))
                .filter((value) => Number.isFinite(value))
                .sort((a, b) => a - b);

            lineKeys.forEach((key) => {
                const lineNotes = cloneLineNotes(currentNotesMap[key]);

                if (splitWithinLine) {
                    if (key < lineIndex) {
                        if (lineNotes.length > 0) {
                            current[key] = lineNotes;
                        }
                        return;
                    }

                    if (key === lineIndex) {
                        const beforeNotes = lineNotes.slice(0, charOffset);
                        const afterNotes = lineNotes.slice(charOffset);
                        if (beforeNotes.length > 0) {
                            current[lineIndex] = beforeNotes;
                        }
                        if (afterNotes.length > 0) {
                            next[0] = afterNotes;
                        }
                        return;
                    }

                    if (lineNotes.length > 0) {
                        next[key - lineIndex] = lineNotes;
                    }
                    return;
                }

                if (key < lineIndex) {
                    if (lineNotes.length > 0) {
                        current[key] = lineNotes;
                    }
                    return;
                }

                if (lineNotes.length > 0) {
                    next[key - lineIndex] = lineNotes;
                }
            });

            this.cleanupOrphanBeamGroupsInNotesMap(current);
            this.cleanupOrphanBeamGroupsInNotesMap(next);

            slide.notes = this.normalizeNotesMapValue(current);
            slide.notesOwner[slide.notesIndex] = slide.notes;

            return this.normalizeNotesMapValue(next);
        }

        mergeNotesMaps(baseNotes, appendedNotes, lineOffset) {
            const merged = {};

            if (baseNotes && isPlainObject(baseNotes)) {
                Object.keys(baseNotes).forEach((lineKey) => {
                    merged[lineKey] = cloneLineNotes(baseNotes[lineKey]);
                });
            }

            if (appendedNotes && isPlainObject(appendedNotes)) {
                Object.keys(appendedNotes).forEach((lineKey) => {
                    const shiftedKey = String(parseInt(lineKey, 10) + lineOffset);
                    merged[shiftedKey] = cloneLineNotes(appendedNotes[lineKey]);
                });
            }

            this.cleanupOrphanBeamGroupsInNotesMap(merged);
            return this.normalizeNotesMapValue(merged);
        }

        slideHasContent(slide) {
            if (!slide) {
                return false;
            }

            const koreanText = stripChorusMarker(slide.korean).replace(/<br\s*\/?>/gi, "").trim();
            const englishText = stripChorusMarker(slide.english).replace(/<br\s*\/?>/gi, "").trim();
            const normalizedNotes = this.normalizeNotesMapValue(slide.notes);
            return !!(koreanText || englishText || normalizedNotes);
        }

        replaceKoreanNoteLinesAfterSplit(slide, lineIndex, splitOffset) {
            const currentNotesMap = slide.notes && isPlainObject(slide.notes) ? slide.notes : {};
            const nextNotes = {};
            const lineKeys = Object.keys(currentNotesMap)
                .map((key) => parseInt(key, 10))
                .filter((value) => Number.isFinite(value))
                .sort((a, b) => a - b);

            lineKeys.forEach((key) => {
                const lineNotes = cloneLineNotes(currentNotesMap[key]);

                if (key < lineIndex) {
                    if (lineNotes.length > 0) {
                        nextNotes[key] = lineNotes;
                    }
                    return;
                }

                if (key === lineIndex) {
                    const beforeNotes = lineNotes.slice(0, splitOffset);
                    const afterNotes = lineNotes.slice(splitOffset);
                    if (beforeNotes.length > 0) {
                        nextNotes[key] = beforeNotes;
                    }
                    if (afterNotes.length > 0) {
                        nextNotes[key + 1] = afterNotes;
                    }
                    return;
                }

                if (lineNotes.length > 0) {
                    nextNotes[key + 1] = lineNotes;
                }
            });

            slide.notes = Object.keys(nextNotes).length > 0 ? nextNotes : null;
            slide.notesOwner[slide.notesIndex] = slide.notes;
            this.cleanupOrphanBeamGroups(slide);
            this.commitSlideNotes(slide);
        }

        replaceKoreanNoteLinesAfterMerge(slide, primaryLineIndex, secondaryLineIndex) {
            const currentNotesMap = slide.notes && isPlainObject(slide.notes) ? slide.notes : {};
            const nextNotes = {};
            const lineKeys = Object.keys(currentNotesMap)
                .map((key) => parseInt(key, 10))
                .filter((value) => Number.isFinite(value))
                .sort((a, b) => a - b);
            const primaryNotes = cloneLineNotes(currentNotesMap[primaryLineIndex]);
            const secondaryNotes = cloneLineNotes(currentNotesMap[secondaryLineIndex]);
            const mergedNotes = [...primaryNotes, ...secondaryNotes];

            lineKeys.forEach((key) => {
                if (key < primaryLineIndex) {
                    const lineNotes = cloneLineNotes(currentNotesMap[key]);
                    if (lineNotes.length > 0) {
                        nextNotes[key] = lineNotes;
                    }
                    return;
                }

                if (key === primaryLineIndex) {
                    if (mergedNotes.length > 0) {
                        nextNotes[key] = mergedNotes;
                    }
                    return;
                }

                if (key === secondaryLineIndex) {
                    return;
                }

                const lineNotes = cloneLineNotes(currentNotesMap[key]);
                if (lineNotes.length > 0) {
                    nextNotes[key - 1] = lineNotes;
                }
            });

            slide.notes = Object.keys(nextNotes).length > 0 ? nextNotes : null;
            slide.notesOwner[slide.notesIndex] = slide.notes;
            this.cleanupOrphanBeamGroups(slide);
            this.commitSlideNotes(slide);
        }

        rerenderCurrentSlideWithFocus(focusTarget) {
            this.skipNextEditableBlur = true;
            this.renderSlideList();
            this.renderCurrentSlide();
            this.renderExportJson();

            if (focusTarget) {
                this.focusEditableLine(focusTarget.role, focusTarget.lineIndex, focusTarget.offset);
            }
        }

        splitEditableLine(editable) {
            const slide = this.getCurrentSlide();
            if (!slide) {
                return;
            }

            const role = editable.dataset.role;
            const lineIndex = parseInt(editable.dataset.lineIndex, 10);
            const offset = this.getSelectionOffsetInEditable(editable);
            const lines = role === "korean-line" ? getEditableLines(slide.korean) : getEditableLines(slide.english);
            const currentLine = lines[lineIndex] || "";
            const beforeText = currentLine.slice(0, offset);
            const afterText = currentLine.slice(offset);
            const nextLines = lines.slice();

            nextLines.splice(lineIndex, 1, beforeText, afterText);
            this.updateSlideTextLines(slide, role, nextLines);

            if (role === "korean-line") {
                this.replaceKoreanNoteLinesAfterSplit(slide, lineIndex, countNotationChars(beforeText));
            }

            this.rerenderCurrentSlideWithFocus({
                role,
                lineIndex: lineIndex + 1,
                offset: 0
            });
            this.setStatus("가사 줄을 나눴습니다.");
        }

        mergeEditableLineWithPrevious(editable) {
            const slide = this.getCurrentSlide();
            if (!slide) {
                return;
            }

            const role = editable.dataset.role;
            const lineIndex = parseInt(editable.dataset.lineIndex, 10);
            if (lineIndex <= 0) {
                return;
            }

            const lines = role === "korean-line" ? getEditableLines(slide.korean) : getEditableLines(slide.english);
            const previousLine = lines[lineIndex - 1] || "";
            const currentLine = lines[lineIndex] || "";
            const nextLines = lines.slice();
            nextLines.splice(lineIndex - 1, 2, `${previousLine}${currentLine}`);
            this.updateSlideTextLines(slide, role, nextLines);

            if (role === "korean-line") {
                this.replaceKoreanNoteLinesAfterMerge(slide, lineIndex - 1, lineIndex);
            }

            this.rerenderCurrentSlideWithFocus({
                role,
                lineIndex: lineIndex - 1,
                offset: previousLine.length
            });
            this.setStatus("가사 줄을 합쳤습니다.");
        }

        mergeEditableLineWithNext(editable) {
            const slide = this.getCurrentSlide();
            if (!slide) {
                return;
            }

            const role = editable.dataset.role;
            const lineIndex = parseInt(editable.dataset.lineIndex, 10);
            const lines = role === "korean-line" ? getEditableLines(slide.korean) : getEditableLines(slide.english);
            if (lineIndex >= lines.length - 1) {
                return;
            }

            const currentLine = lines[lineIndex] || "";
            const nextLine = lines[lineIndex + 1] || "";
            const nextLines = lines.slice();
            nextLines.splice(lineIndex, 2, `${currentLine}${nextLine}`);
            this.updateSlideTextLines(slide, role, nextLines);

            if (role === "korean-line") {
                this.replaceKoreanNoteLinesAfterMerge(slide, lineIndex, lineIndex + 1);
            }

            this.rerenderCurrentSlideWithFocus({
                role,
                lineIndex,
                offset: currentLine.length
            });
            this.setStatus("가사 줄을 합쳤습니다.");
        }

        createSlideSignature(slideLike) {
            return JSON.stringify({
                type: slideLike.type || "",
                korean: slideLike.korean || "",
                english: slideLike.english || "",
                notes: slideLike.notes || null
            });
        }

        findSlideIndexBySignature(signature, preferredType) {
            let index = this.slides.findIndex((slide) => slide.type === preferredType && this.createSlideSignature(slide) === signature);
            if (index >= 0) {
                return index;
            }

            index = this.slides.findIndex((slide) => this.createSlideSignature(slide) === signature);
            return index;
        }

        rebuildSlidesAndRestoreSelection(options = {}) {
            const {
                targetSlideId = null,
                targetSignature = null,
                preferredType = null,
                fallbackIndex = this.currentSlideIndex,
                focusTarget = null
            } = options;

            if (focusTarget) {
                this.skipNextEditableBlur = true;
            }

            this.buildSlides();
            this.updateHeader();

            if (this.slides.length === 0) {
                this.currentSlideIndex = 0;
                this.renderSlideList();
                this.dom.canvas.innerHTML = "";
                this.renderExportJson();
                this.updateToolbarState();
                return;
            }

            let nextIndex = -1;
            if (targetSlideId) {
                nextIndex = this.slides.findIndex((slide) => slide.id === targetSlideId);
            }
            if (nextIndex < 0 && targetSignature) {
                nextIndex = this.findSlideIndexBySignature(targetSignature, preferredType);
            }
            if (nextIndex < 0) {
                nextIndex = Math.max(0, Math.min(fallbackIndex, this.slides.length - 1));
            }

            this.currentSlideIndex = nextIndex;
            this.renderSlideList();
            this.renderCurrentSlide();
            this.scheduleLayoutRefresh();
            this.renderExportJson();

            if (focusTarget) {
                this.focusEditableLine(focusTarget.role, focusTarget.lineIndex, focusTarget.offset);
            }
        }

        insertSlideAfterCurrent(newSlideData = null) {
            const slide = this.getCurrentSlide();
            if (!slide) {
                this.setStatus("추가할 기준 슬라이드가 없습니다.", "warning");
                return;
            }

            if (!newSlideData) {
                this.recordHistory();
            }
            const insertIndex = slide.slideIndex + 1;
            slide.koreanOwner.splice(insertIndex, 0, newSlideData ? (newSlideData.korean || "") : "");
            slide.englishOwner.splice(insertIndex, 0, newSlideData ? (newSlideData.english || "") : "");
            slide.notesOwner.splice(insertIndex, 0, newSlideData ? (newSlideData.notes || null) : null);

            const targetSlideId = slide.type === "chorus"
                ? `chorus-${insertIndex}`
                : `verse-${slide.sectionKey}-${insertIndex}`;

            this.rebuildSlidesAndRestoreSelection({
                targetSlideId,
                fallbackIndex: this.currentSlideIndex + 1,
                focusTarget: newSlideData && newSlideData.focusTarget
                    ? newSlideData.focusTarget
                    : {
                        role: "korean-line",
                        lineIndex: 0,
                        offset: 0
                    }
            });

            this.setStatus(slide.type === "chorus" ? "새 후렴 슬라이드를 추가했습니다." : "새 절 슬라이드를 추가했습니다.");
        }

        splitCurrentSlideToNextSlide(editable) {
            const slide = this.getCurrentSlide();
            if (!slide) {
                return;
            }

            const role = editable.dataset.role;
            const lineIndex = parseInt(editable.dataset.lineIndex, 10);
            const offset = this.getSelectionOffsetInEditable(editable);

            let currentKorean = slide.korean;
            let nextKorean = "";
            let currentEnglish = slide.english;
            let nextEnglish = "";
            let nextNotes = null;

            if (role === "korean-line") {
                const koreanSplit = this.splitStoredText(slide.korean, lineIndex, offset, true);
                const englishSplit = this.splitStoredText(slide.english, lineIndex, 0, false);
                currentKorean = koreanSplit.currentText;
                nextKorean = koreanSplit.nextText;
                currentEnglish = englishSplit.currentText;
                nextEnglish = englishSplit.nextText;
                nextNotes = this.splitNotesForNewSlide(slide, lineIndex, countNotationChars((getEditableLines(slide.korean)[lineIndex] || "").slice(0, offset)), true);
            } else {
                const koreanSplit = this.splitStoredText(slide.korean, lineIndex, 0, false);
                const englishSplit = this.splitStoredText(slide.english, lineIndex, offset, true);
                currentKorean = koreanSplit.currentText;
                nextKorean = koreanSplit.nextText;
                currentEnglish = englishSplit.currentText;
                nextEnglish = englishSplit.nextText;
                nextNotes = this.splitNotesForNewSlide(slide, lineIndex, 0, false);
            }

            slide.korean = currentKorean;
            slide.koreanOwner[slide.koreanIndex] = currentKorean;
            slide.english = currentEnglish;
            slide.englishOwner[slide.englishIndex] = currentEnglish;
            this.cleanupOrphanBeamGroups(slide);
            this.commitSlideNotes(slide);

            this.insertSlideAfterCurrent({
                korean: nextKorean,
                english: nextEnglish,
                notes: nextNotes,
                focusTarget: {
                    role,
                    lineIndex: 0,
                    offset: 0
                }
            });
            this.setStatus("현재 위치부터 다음 슬라이드로 나눴습니다.");
        }

        removeCurrentSlide() {
            const slide = this.getCurrentSlide();
            if (!slide) {
                this.setStatus("삭제할 슬라이드가 없습니다.", "warning");
                return;
            }

            if (this.slides.length <= 1) {
                this.setStatus("마지막 남은 슬라이드는 삭제할 수 없습니다.", "warning");
                return;
            }

            const hasContent = this.slideHasContent(slide);

            if (hasContent && slide.slideIndex > 0) {
                this.recordHistory();
                const previousIndex = slide.slideIndex - 1;
                const previousKoreanLines = getStoredLines(slide.koreanOwner[previousIndex] || "");
                const currentKoreanLines = getStoredLines(slide.korean || "");
                const previousEnglishLines = getStoredLines(slide.englishOwner[previousIndex] || "");
                const currentEnglishLines = getStoredLines(slide.english || "");

                slide.koreanOwner[previousIndex] = joinStoredLines([...previousKoreanLines, ...currentKoreanLines]);
                slide.englishOwner[previousIndex] = joinStoredLines([...previousEnglishLines, ...currentEnglishLines]);
                slide.notesOwner[previousIndex] = this.mergeNotesMaps(
                    slide.notesOwner[previousIndex],
                    slide.notes,
                    previousKoreanLines.length
                );
            } else if (hasContent && slide.slideIndex === 0) {
                this.setStatus("내용이 있는 첫 슬라이드는 앞 슬라이드가 없어 바로 삭제할 수 없습니다.", "warning");
                return;
            } else {
                this.recordHistory();
            }

            slide.koreanOwner.splice(slide.slideIndex, 1);
            slide.englishOwner.splice(slide.slideIndex, 1);
            slide.notesOwner.splice(slide.slideIndex, 1);

            const fallbackIndex = Math.max(0, this.currentSlideIndex - 1);
            this.rebuildSlidesAndRestoreSelection({ fallbackIndex });
            this.setStatus(
                hasContent
                    ? (slide.type === "chorus" ? "후렴 슬라이드를 삭제하고 내용을 이전 슬라이드에 이어 붙였습니다." : "절 슬라이드를 삭제하고 내용을 이전 슬라이드에 이어 붙였습니다.")
                    : (slide.type === "chorus" ? "후렴 슬라이드를 삭제했습니다." : "절 슬라이드를 삭제했습니다.")
            );
        }

        renderAllLines() {
            const lineElements = this.dom.canvas.querySelectorAll(".editor-line");
            lineElements.forEach((lineEl) => {
                this.renderLine(parseInt(lineEl.dataset.lineIndex, 10));
            });
        }

        scheduleLayoutRefresh() {
            if (!this.dom.canvas || this.slides.length === 0) {
                return;
            }

            if (this.layoutRefreshFrame) {
                cancelAnimationFrame(this.layoutRefreshFrame);
            }

            this.layoutRefreshFrame = requestAnimationFrame(() => {
                this.layoutRefreshFrame = null;
                this.refreshCurrentSlideLayout();
            });
        }

        refreshCurrentSlideLayout() {
            if (!this.getCurrentSlide()) {
                return;
            }

            this.renderAllLines();
        }

        renderLine(lineIndex) {
            const slide = this.getCurrentSlide();
            const lineEl = this.dom.canvas.querySelector(`.editor-line[data-line-index="${lineIndex}"]`);
            if (!lineEl) {
                return;
            }

            const textEl = lineEl.querySelector(".editor-line-text");
            const notationEl = lineEl.querySelector(".notation-container");
            const metrics = this.measureEditorCharPositions(textEl);
            lineEl._layout = metrics;
            notationEl.style.width = `${metrics.totalWidth}px`;
            textEl.style.width = `${metrics.totalWidth}px`;

            if (metrics.chars.length === 0) {
                notationEl.innerHTML = "";
                this.renderBeamContextMenu();
                return;
            }

            const renderNotes = this.createRenderableNotes(slide, lineIndex, metrics.chars.length);
            notationEl.innerHTML = this.notesEngine.createLineNotation(
                metrics.chars,
                renderNotes,
                metrics.positions,
                metrics.totalWidth,
                slide.key
            );

            const isHovered = this.hoveredTarget && this.hoveredTarget.lineIndex === lineIndex;
            lineEl.classList.toggle("is-hovered", !!isHovered);

            if (isHovered) {
                this.renderHoverPreview(notationEl, slide, metrics, renderNotes, this.hoveredTarget);
            }

            this.renderBeamSelectionOverlay(notationEl, slide, metrics, lineIndex);
            this.renderSelectedNoteOverlay(notationEl, slide, metrics, lineIndex);
            this.renderBeamContextMenu();
            this.renderNoteContextMenu();
        }

        measureEditorCharPositions(textElement) {
            const text = textElement.textContent || "";
            const chars = [];
            const positions = [];
            const computed = window.getComputedStyle(textElement);
            const measureRoot = document.createElement("div");

            measureRoot.style.position = "absolute";
            measureRoot.style.visibility = "hidden";
            measureRoot.style.pointerEvents = "none";
            measureRoot.style.whiteSpace = "pre";
            measureRoot.style.left = "-99999px";
            measureRoot.style.top = "0";
            measureRoot.style.fontFamily = computed.fontFamily;
            measureRoot.style.fontSize = computed.fontSize;
            measureRoot.style.fontWeight = computed.fontWeight;
            measureRoot.style.fontStyle = computed.fontStyle;
            measureRoot.style.letterSpacing = computed.letterSpacing;
            measureRoot.style.lineHeight = computed.lineHeight;
            measureRoot.style.textTransform = computed.textTransform;
            measureRoot.style.padding = computed.padding;
            measureRoot.style.border = computed.border;
            measureRoot.style.boxSizing = computed.boxSizing;

            for (let i = 0; i < text.length; i++) {
                const char = text[i];
                if (char !== " " && char !== "\n") {
                    const span = document.createElement("span");
                    span.dataset.index = String(chars.length);
                    span.textContent = char;
                    measureRoot.appendChild(span);
                    chars.push(char);
                } else {
                    measureRoot.appendChild(document.createTextNode(char));
                }
            }

            document.body.appendChild(measureRoot);
            const containerRect = measureRoot.getBoundingClientRect();
            const charSpans = measureRoot.querySelectorAll("span[data-index]");

            charSpans.forEach((span) => {
                const rect = span.getBoundingClientRect();
                positions.push(rect.left - containerRect.left + rect.width / 2);
            });

            document.body.removeChild(measureRoot);

            return {
                chars,
                positions,
                totalWidth: containerRect.width
            };
        }

        createRenderableNotes(slide, lineIndex, charCount) {
            const existingLine = slide.notes && slide.notes[lineIndex] ? slide.notes[lineIndex] : [];
            const renderNotes = new Array(charCount).fill(null);

            for (let i = 0; i < Math.min(existingLine.length, charCount); i++) {
                renderNotes[i] = existingLine[i] ? { ...existingLine[i] } : null;
            }

            return renderNotes;
        }

        renderHoverPreview(notationEl, slide, metrics, renderNotes, target) {
            if (!this.isEditMode || !target) {
                return;
            }

            if (this.isDotMode) {
                this.renderDotPreview(notationEl, slide, metrics, target);
                return;
            }

            if (target.kind === "key") {
                this.renderKeyPreview(notationEl, slide, target);
                return;
            }

            this.renderPreviewNote(notationEl, slide, metrics, renderNotes, target);
        }

        renderKeyPreview(notationEl, slide, target) {
            const svgEl = notationEl.querySelector("svg");
            if (!svgEl) {
                return;
            }

            const currentKey = this.notesEngine.parseKeySignature(slide.key);
            const previewType = target.accidentalType;
            const nextCount = currentKey.type === previewType ? currentKey.count + 1 : 1;
            const glyph = previewType === "flat" ? this.notesEngine.smufl.flat : this.notesEngine.smufl.sharp;
            const positions = previewType === "flat" ? this.notesEngine.flatPositions : this.notesEngine.sharpPositions;

            if (nextCount < 1 || nextCount > positions.length) {
                return;
            }

            const accidentalIndex = nextCount - 1;
            const x = this.notesEngine.clefMargin + 5 + (accidentalIndex * this.notesEngine.keySignatureSpacing);
            const y = this.notesEngine.staffTopMargin + (positions[accidentalIndex] * this.notesEngine.lineSpacing);

            svgEl.innerHTML += `
                <text x="${x}" y="${y}"
                      font-family="Bravura, 'Bravura Text'"
                      font-size="${this.notesEngine.fontSize}"
                      fill="${this.notesEngine.previewColor}"
                      text-anchor="middle"
                      dominant-baseline="middle">${glyph}</text>
            `;
        }

        getNoteRenderPosition(metrics, slide, charIndex, pitch) {
            const keyInfo = this.notesEngine.parseKeySignature(slide.key);
            const totalMargin = this.notesEngine.clefMargin + this.notesEngine.getKeySignatureWidth(keyInfo);
            const x = metrics.positions[charIndex] + totalMargin;
            const pitchPos = this.notesEngine.pitchMap[pitch] ?? 3;
            const y = this.notesEngine.staffTopMargin + (pitchPos * this.notesEngine.lineSpacing);

            return { x, y };
        }

        getNoteVisualPosition(metrics, slide, charIndex, pitch) {
            const position = this.getNoteRenderPosition(metrics, slide, charIndex, pitch);
            return {
                x: position.x,
                y: position.y + (this.notesEngine.lineSpacing * 0.5)
            };
        }

        renderDotPreview(notationEl, slide, metrics, target) {
            if (target.kind !== "note" || !target.existingNote) {
                return;
            }

            const svgEl = notationEl.querySelector("svg");
            if (!svgEl) {
                return;
            }

            const position = this.getNoteVisualPosition(metrics, slide, target.charIndex, target.existingNote.pitch);
            const previewColor = this.notesEngine.previewColor;
            const dotX = position.x + (this.notesEngine.lineSpacing * 0.9);
            const dotY = position.y;
            const isDotted = (target.existingNote.duration || "").endsWith(".");

            svgEl.innerHTML += `
                ${isDotted ? `
                    <line x1="${dotX - 5}" y1="${dotY - 5}" x2="${dotX + 5}" y2="${dotY + 5}"
                          stroke="${previewColor}" stroke-width="1.6" stroke-linecap="round"/>
                    <line x1="${dotX + 5}" y1="${dotY - 5}" x2="${dotX - 5}" y2="${dotY + 5}"
                          stroke="${previewColor}" stroke-width="1.6" stroke-linecap="round"/>
                ` : `
                    <text x="${dotX}" y="${dotY}"
                          font-family="Bravura, 'Bravura Text'"
                          font-size="${this.notesEngine.fontSize * 0.8}"
                          fill="${previewColor}"
                          text-anchor="middle"
                          dominant-baseline="middle">${this.notesEngine.smufl.augmentationDot}</text>
                `}
            `;
        }

        renderBeamSelectionOverlay(notationEl, slide, metrics, lineIndex) {
            const selectedNotes = this.getSelectedBeamNotesForLine(lineIndex);
            if (selectedNotes.length === 0) {
                return;
            }

            const svgEl = notationEl.querySelector("svg");
            if (!svgEl) {
                return;
            }

            const selectedMarkup = selectedNotes.map((item) => {
                const position = this.getNoteVisualPosition(metrics, slide, item.charIndex, item.note.pitch);
                return `
                    <circle cx="${position.x}" cy="${position.y}"
                            r="${this.notesEngine.lineSpacing * 0.78}"
                            fill="none"
                            stroke="#8c4b2f"
                            stroke-width="2"/>
                `;
            }).join("");

            svgEl.innerHTML += selectedMarkup;
        }

        renderPreviewNote(notationEl, slide, metrics, renderNotes, target) {
            if (target.kind === "key") {
                return;
            }

            if (!this.isEditMode || !target) {
                return;
            }

            const existingNote = renderNotes[target.charIndex];
            if (existingNote) {
                return;
            }

            const previewDuration = target.duration;

            const svgEl = notationEl.querySelector("svg");
            if (!svgEl) {
                return;
            }

            const position = this.getNoteRenderPosition(metrics, slide, target.charIndex, target.pitch);
            svgEl.innerHTML += this.notesEngine.createNote(
                position.x,
                target.pitch,
                previewDuration,
                this.notesEngine.staffTopMargin,
                this.notesEngine.previewColor
            );
        }

        updateToolbarState() {
            this.normalizeBeamSelection();
            this.dom.toggleMode.textContent = this.isEditMode ? "편집 모드 켜짐" : "편집 모드 꺼짐";
            this.dom.toggleMode.classList.toggle("is-muted", !this.isEditMode);
            this.dom.toggleDot.textContent = this.isDotMode ? "점음표 모드 켜짐" : "점음표 모드 꺼짐";
            this.dom.toggleDot.classList.toggle("is-active", this.isEditMode && this.isDotMode);
            this.dom.toggleDot.classList.toggle("is-muted", !this.isEditMode);
            this.dom.toggleDot.disabled = !this.isEditMode;
            this.dom.toggleBeam.textContent = this.isBeamMode ? "연결선 모드 켜짐" : "연결선 모드 꺼짐";
            this.dom.toggleBeam.classList.toggle("is-active", this.isEditMode && this.isBeamMode);
            this.dom.toggleBeam.classList.toggle("is-muted", !this.isEditMode);
            this.dom.toggleBeam.disabled = !this.isEditMode;
            this.dom.applyBeam.disabled = !this.isEditMode || !this.canApplyBeamSelection();
            this.dom.clearBeam.disabled = !this.isEditMode || !this.canClearBeamSelection();
            this.dom.addSlide.disabled = !this.data || !this.data.hymn;
            this.dom.removeSlide.disabled = this.slides.length <= 1;
            this.dom.saveHymn.disabled = !this.data || !this.data.hymn;
            this.dom.deleteSaved.disabled = !this.data || !this.data.hymn || !this.hasSavedHymn(this.data.hymn.number);
            this.dom.undo.disabled = this.undoStack.length === 0;
            this.dom.redo.disabled = this.redoStack.length === 0;
            this.dom.prevSlide.disabled = this.slides.length === 0 || this.currentSlideIndex === 0;
            this.dom.nextSlide.disabled = this.slides.length === 0 || this.currentSlideIndex === this.slides.length - 1;
            this.renderBeamContextMenu();
            this.renderNoteContextMenu();
        }

        createHistorySnapshot() {
            if (!this.data || !this.data.hymn) {
                return null;
            }

            return {
                hymn: deepClone(this.data.hymn),
                currentSlideIndex: this.currentSlideIndex
            };
        }

        recordHistory(snapshot = this.createHistorySnapshot()) {
            if (!snapshot || this.isRestoringHistory) {
                return;
            }

            this.undoStack.push(snapshot);
            if (this.undoStack.length > 120) {
                this.undoStack.shift();
            }
            this.redoStack = [];
            this.updateToolbarState();
        }

        restoreHistorySnapshot(snapshot) {
            if (!snapshot || !this.data) {
                return;
            }

            this.isRestoringHistory = true;
            this.data.hymn = deepClone(snapshot.hymn);
            this.buildSlides();
            this.hoveredTarget = null;
            this.selectedBeamNotes = [];
            this.selectedNoteTarget = null;
            this.noteMenuMode = "main";
            this.pendingTextHistory = null;
            this.updateHeader();

            const nextSlideIndex = Math.max(0, Math.min(snapshot.currentSlideIndex, this.slides.length - 1));
            if (this.slides.length > 0) {
                this.currentSlideIndex = nextSlideIndex;
                this.renderSlideList();
                this.renderCurrentSlide();
                this.scheduleLayoutRefresh();
            } else {
                this.currentSlideIndex = 0;
                this.renderSlideList();
                this.dom.canvas.innerHTML = "";
            }

            this.renderExportJson();
            this.isRestoringHistory = false;
            this.updateToolbarState();
        }

        undo() {
            if (this.undoStack.length === 0) {
                return;
            }

            const currentSnapshot = this.createHistorySnapshot();
            const previousSnapshot = this.undoStack.pop();
            if (currentSnapshot) {
                this.redoStack.push(currentSnapshot);
            }
            this.restoreHistorySnapshot(previousSnapshot);
            this.setStatus("이전 편집 상태로 되돌렸습니다.");
        }

        redo() {
            if (this.redoStack.length === 0) {
                return;
            }

            const currentSnapshot = this.createHistorySnapshot();
            const nextSnapshot = this.redoStack.pop();
            if (currentSnapshot) {
                this.undoStack.push(currentSnapshot);
            }
            this.restoreHistorySnapshot(nextSnapshot);
            this.setStatus("다시 실행했습니다.");
        }

        toggleEditMode() {
            this.isEditMode = !this.isEditMode;
            if (!this.isEditMode) {
                this.isDotMode = false;
                this.isBeamMode = false;
                this.selectedBeamNotes = [];
                this.selectedNoteTarget = null;
                this.noteMenuMode = "main";
            }
            this.clearHover();
            this.updateToolbarState();
            this.renderAllLines();
            this.setStatus(this.isEditMode ? "편집 모드를 켰습니다." : "편집 모드를 껐습니다.");
        }

        toggleDotMode() {
            if (!this.isEditMode) {
                this.setStatus("점음표 모드는 편집 모드에서만 사용할 수 있습니다.", "warning");
                return;
            }

            this.isDotMode = !this.isDotMode;
            if (this.isDotMode) {
                this.isBeamMode = false;
                this.clearBeamSelection();
            }
            this.clearHover();
            this.updateToolbarState();
            this.renderAllLines();
            this.setStatus(this.isDotMode ? "점음표 모드를 켰습니다. 기존 음표를 클릭해 점을 추가하거나 제거하세요." : "점음표 모드를 껐습니다.");
        }

        toggleBeamMode() {
            if (!this.isEditMode) {
                this.setStatus("연결선 모드는 편집 모드에서만 사용할 수 있습니다.", "warning");
                return;
            }

            this.isBeamMode = !this.isBeamMode;
            if (this.isBeamMode) {
                this.isDotMode = false;
            } else {
                this.clearBeamSelection();
            }

            this.clearHover();
            this.updateToolbarState();
            this.renderAllLines();
            this.setStatus(this.isBeamMode
                ? "연결선 모드를 켰습니다. 기존 8분음표 또는 16분음표를 선택한 뒤 적용 버튼을 누르세요."
                : "연결선 모드를 껐습니다.");
        }

        handleEditableKeydown(event) {
            const editable = event.target.closest("[contenteditable='true']");
            if (!editable) {
                return;
            }

            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                event.preventDefault();
                this.recordHistory(this.pendingTextHistory || this.createHistorySnapshot());
                this.pendingTextHistory = null;
                this.splitCurrentSlideToNextSlide(editable);
                return;
            }

            if (event.key === "Enter") {
                event.preventDefault();
                this.recordHistory(this.pendingTextHistory || this.createHistorySnapshot());
                this.pendingTextHistory = null;
                this.splitEditableLine(editable);
                return;
            }

            if (event.key === "Backspace" && this.getSelectionOffsetInEditable(editable) === 0) {
                const lineIndex = parseInt(editable.dataset.lineIndex, 10);
                if (lineIndex > 0) {
                    event.preventDefault();
                    this.recordHistory(this.pendingTextHistory || this.createHistorySnapshot());
                    this.pendingTextHistory = null;
                    this.mergeEditableLineWithPrevious(editable);
                }
                return;
            }

            if (event.key === "Delete") {
                const offset = this.getSelectionOffsetInEditable(editable);
                const textLength = (editable.textContent || "").length;
                const lineIndex = parseInt(editable.dataset.lineIndex, 10);
                const role = editable.dataset.role;
                const slide = this.getCurrentSlide();
                const lines = slide
                    ? (role === "korean-line" ? getEditableLines(slide.korean) : getEditableLines(slide.english))
                    : [];
                if (offset === textLength && lineIndex < lines.length - 1) {
                    event.preventDefault();
                    this.recordHistory(this.pendingTextHistory || this.createHistorySnapshot());
                    this.pendingTextHistory = null;
                    this.mergeEditableLineWithNext(editable);
                }
            }
        }

        handleEditableFocus(event) {
            const editable = event.target.closest("[contenteditable='true']");
            if (!editable) {
                return;
            }

            this.pendingTextHistory = this.createHistorySnapshot();
        }

        handleEditableInput(event) {
            const editable = event.target.closest("[contenteditable='true']");
            if (!editable) {
                return;
            }

            const slide = this.getCurrentSlide();
            if (!slide) {
                return;
            }

            const role = editable.dataset.role;
            const lineIndex = parseInt(editable.dataset.lineIndex, 10);
            const value = editable.textContent.replace(/\u00A0/g, " ");

            if (role === "korean-line") {
                const lines = splitLines(slide.korean);
                lines[lineIndex] = value;
                slide.korean = joinLines(lines);
                slide.koreanOwner[slide.koreanIndex] = slide.korean;
                this.syncNotesToCurrentText(slide, lineIndex, editable);
                this.renderSlideList();
                this.renderLine(lineIndex);
                this.updateToolbarState();
                this.renderExportJson();
                return;
            }

            if (role === "english-line") {
                const lines = splitLines(slide.english);
                lines[lineIndex] = value;
                slide.english = joinLines(lines);
                slide.englishOwner[slide.englishIndex] = slide.english;
                this.renderExportJson();
            }
        }

        handleEditableBlur(event) {
            const editable = event.target.closest("[contenteditable='true']");
            if (!editable) {
                return;
            }

            if (this.skipNextEditableBlur) {
                this.skipNextEditableBlur = false;
                return;
            }

            const slide = this.getCurrentSlide();
            if (!slide) {
                return;
            }

            const role = editable.dataset.role;
            const lineIndex = parseInt(editable.dataset.lineIndex, 10);
            const value = editable.textContent.replace(/\u00A0/g, " ").trim();
            editable.textContent = value;

            const textHistorySnapshot = this.pendingTextHistory;
            this.pendingTextHistory = null;
            const shouldRecordTextHistory = !!(
                textHistorySnapshot
                && JSON.stringify(textHistorySnapshot.hymn) !== JSON.stringify(this.data.hymn)
            );

            if (role === "korean-line") {
                if (shouldRecordTextHistory) {
                    this.recordHistory(textHistorySnapshot);
                }
                const lines = splitLines(slide.korean);
                lines[lineIndex] = value;
                slide.korean = joinLines(lines);
                slide.koreanOwner[slide.koreanIndex] = slide.korean;
                this.syncNotesToCurrentText(slide, lineIndex, editable);
                const hadMarker = slide.type === "verse" && (hasChorusMarker(slide.korean) || hasChorusMarker(slide.english));
                const targetSignature = this.createSlideSignature({
                    type: hadMarker ? "chorus" : slide.type,
                    korean: stripChorusMarker(slide.korean),
                    english: stripChorusMarker(slide.english),
                    notes: slide.notes || null
                });

                if (hadMarker) {
                    this.rebuildSlidesAndRestoreSelection({
                        targetSignature,
                        preferredType: "chorus",
                        fallbackIndex: this.currentSlideIndex
                    });
                    this.setStatus("`<후렴>` 마커를 감지해 현재 슬라이드를 후렴으로 옮겼습니다.");
                    return;
                }

                slide.korean = stripChorusMarker(slide.korean);
                slide.koreanOwner[slide.koreanIndex] = slide.korean;
                this.renderSlideList();
                this.renderCurrentSlide();
                this.renderExportJson();
                this.setStatus("가사 줄을 수정했습니다.");
                return;
            }

            if (role === "english-line") {
                if (shouldRecordTextHistory) {
                    this.recordHistory(textHistorySnapshot);
                }
                const lines = splitLines(slide.english);
                lines[lineIndex] = value;
                slide.english = joinLines(lines);
                slide.englishOwner[slide.englishIndex] = slide.english;
                const hadMarker = slide.type === "verse" && (hasChorusMarker(slide.korean) || hasChorusMarker(slide.english));
                const targetSignature = this.createSlideSignature({
                    type: hadMarker ? "chorus" : slide.type,
                    korean: stripChorusMarker(slide.korean),
                    english: stripChorusMarker(slide.english),
                    notes: slide.notes || null
                });

                if (hadMarker) {
                    this.rebuildSlidesAndRestoreSelection({
                        targetSignature,
                        preferredType: "chorus",
                        fallbackIndex: this.currentSlideIndex
                    });
                    this.setStatus("`<후렴>` 마커를 감지해 현재 슬라이드를 후렴으로 옮겼습니다.");
                    return;
                }

                slide.english = stripChorusMarker(slide.english);
                slide.englishOwner[slide.englishIndex] = slide.english;
                this.renderSlideList();
                this.renderCurrentSlide();
                this.renderExportJson();
                this.setStatus("영문 가사 줄을 수정했습니다.");
            }
        }

        syncNotesToCurrentText(slide, lineIndex, textElement) {
            const metrics = this.measureEditorCharPositions(textElement);
            const nextLength = metrics.chars.length;

            if (!slide.notes || !isPlainObject(slide.notes)) {
                if (nextLength === 0) {
                    return;
                }
                slide.notes = {};
                slide.notesOwner[slide.notesIndex] = slide.notes;
            }

            const currentLine = Array.isArray(slide.notes[lineIndex]) ? slide.notes[lineIndex] : [];
            const resized = new Array(nextLength).fill(null);

            for (let i = 0; i < Math.min(currentLine.length, nextLength); i++) {
                resized[i] = currentLine[i] ? { ...currentLine[i] } : null;
            }

            slide.notes[lineIndex] = resized;
            this.cleanupOrphanBeamGroups(slide);
            this.commitSlideNotes(slide);
        }

        handleCanvasMouseMove(event) {
            if (this.isEditingLyric()) {
                this.clearHover();
                return;
            }

            if (this.dragState) {
                return;
            }

            const target = this.getTargetFromEvent(event);

            if (!this.isEditMode || !target) {
                this.clearHover();
                return;
            }

            if (this.isDotMode && (target.kind !== "note" || !target.existingNote)) {
                this.clearHover();
                return;
            }

            if (this.isSameTarget(this.hoveredTarget, target)) {
                return;
            }

            const previousLine = this.hoveredTarget ? this.hoveredTarget.lineIndex : null;
            this.hoveredTarget = target;

            if (previousLine !== null && previousLine !== target.lineIndex) {
                this.renderLine(previousLine);
            }

            this.renderLine(target.lineIndex);
        }

        handleCanvasMouseDown(event) {
            if (!this.isEditMode || event.button !== 0) {
                return;
            }

            if (this.isDotMode) {
                return;
            }

            const target = this.getTargetFromEvent(event);
            if (!target || target.kind === "key") {
                return;
            }

            if (target.existingNote) {
                if (event.ctrlKey || event.metaKey || event.shiftKey) {
                    return;
                }

                this.dragState = {
                    lineIndex: target.lineIndex,
                    charIndex: target.charIndex,
                    originalPitch: target.existingNote.pitch,
                    lastPitch: target.existingNote.pitch,
                    moved: false
                };
                event.preventDefault();
                return;
            }

            this.beginBeamDragSelection(event);
        }

        handleCanvasClick(event) {
            if (!this.isEditMode) {
                return;
            }

            const beamMenuButton = event.target.closest("[data-beam-menu-action]");
            if (beamMenuButton) {
                event.preventDefault();
                this.handleBeamMenuAction(beamMenuButton.dataset.beamMenuAction);
                return;
            }

            const noteMenuButton = event.target.closest("[data-note-menu-action]");
            if (noteMenuButton) {
                event.preventDefault();
                this.handleNoteMenuAction(noteMenuButton.dataset.noteMenuAction);
                return;
            }

            const noteDurationButton = event.target.closest("[data-note-duration]");
            if (noteDurationButton) {
                event.preventDefault();
                this.applySelectedNoteDuration(noteDurationButton.dataset.noteDuration);
                return;
            }

            if (Date.now() < this.suppressClickUntil) {
                return;
            }

            const target = this.getTargetFromEvent(event);
            if (!target) {
                this.clearSelectedNoteTarget(false);
                this.clearBeamSelection({ statusMessage: "연결선 선택을 해제했습니다." });
                return;
            }

            window.clearTimeout(this.pendingClickTimer);
            this.pendingClickTimer = window.setTimeout(() => {
                if (this.isDotMode) {
                    this.clearSelectedNoteTarget(false);
                    this.clearBeamSelection();
                    this.applyDotClickAction(target);
                    this.pendingClickTimer = null;
                    return;
                }

                if (target.kind === "key") {
                    this.clearSelectedNoteTarget(false);
                    this.clearBeamSelection();
                    this.applyKeyClickAction(target);
                    this.pendingClickTimer = null;
                    return;
                }

                if (target.existingNote && (event.ctrlKey || event.metaKey || event.shiftKey)) {
                    this.clearSelectedNoteTarget(false);
                    this.toggleBeamSelection(target, event.ctrlKey || event.metaKey || event.shiftKey);
                    this.pendingClickTimer = null;
                    return;
                }

                if (target.existingNote) {
                    this.setSelectedNoteTarget(target);
                    this.pendingClickTimer = null;
                    return;
                }

                this.clearSelectedNoteTarget(false);
                this.clearBeamSelection();
                this.applyClickAction(target, 1);
                this.pendingClickTimer = null;
            }, CLICK_DELAY_MS);
        }

        handleCanvasDoubleClick(event) {
            if (!this.isEditMode) {
                return;
            }

            const target = this.getTargetFromEvent(event);
            if (!target) {
                return;
            }

            window.clearTimeout(this.pendingClickTimer);
            this.pendingClickTimer = null;

            if (this.isDotMode) {
                return;
            }

            if (target.kind === "key") {
                this.removeLastKeyAccidental();
                return;
            }

            this.deleteNote(target);
        }

        handleDocumentMouseMove(event) {
            if (this.beamDragState) {
                this.updateBeamDragSelection(event);
                return;
            }

            if (!this.dragState) {
                return;
            }

            const slide = this.getCurrentSlide();
            const lineEl = this.dom.canvas.querySelector(`.editor-line[data-line-index="${this.dragState.lineIndex}"]`);
            if (!slide || !lineEl) {
                return;
            }

            const notationEl = lineEl.querySelector(".notation-container");
            const svgEl = notationEl.querySelector("svg");
            const rect = svgEl ? svgEl.getBoundingClientRect() : notationEl.getBoundingClientRect();
            const localY = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
            const nextPitch = this.calculatePitch(localY);

            if (nextPitch === this.dragState.lastPitch) {
                return;
            }

            const lineNotes = this.ensureLineNotes(slide, this.dragState.lineIndex, lineEl._layout ? lineEl._layout.chars.length : 0);
            if (!lineNotes[this.dragState.charIndex]) {
                return;
            }

            lineNotes[this.dragState.charIndex].pitch = nextPitch;
            this.dragState.lastPitch = nextPitch;
            this.dragState.moved = true;
            this.renderLine(this.dragState.lineIndex);
        }

        handleDocumentMouseUp() {
            if (this.beamDragState) {
                this.finishBeamDragSelection();
                return;
            }

            if (!this.dragState) {
                return;
            }

            const slide = this.getCurrentSlide();
            if (slide && this.dragState.moved) {
                this.recordHistory();
                this.commitSlideNotes(slide);
                this.renderExportJson();
                this.setStatus(`음높이를 ${this.dragState.originalPitch}에서 ${this.dragState.lastPitch}(으)로 변경했습니다.`);
                this.suppressClickUntil = Date.now() + 250;
            }

            this.dragState = null;
        }

        getTargetFromEvent(event) {
            if (this.slides.length === 0) {
                return null;
            }

            const notationEl = event.target.closest(".notation-container");
            if (!notationEl) {
                return null;
            }

            const lineEl = notationEl.closest(".editor-line");
            if (!lineEl) {
                return null;
            }

            const textEl = lineEl.querySelector(".editor-line-text");
            const metrics = lineEl._layout || this.measureEditorCharPositions(textEl);
            const svgEl = notationEl.querySelector("svg");

            if (!metrics || metrics.chars.length === 0) {
                return null;
            }

            const lineIndex = parseInt(lineEl.dataset.lineIndex, 10);
            const textRect = textEl.getBoundingClientRect();
            const svgRect = svgEl ? svgEl.getBoundingClientRect() : notationEl.getBoundingClientRect();
            const localX = event.clientX - textRect.left;
            const localSvgX = event.clientX - svgRect.left;
            const localY = Math.max(0, Math.min(svgRect.height, event.clientY - svgRect.top));

            if (!this.isDotMode && this.isKeyArea(localSvgX)) {
                return {
                    kind: "key",
                    lineIndex,
                    accidentalType: event.ctrlKey ? "sharp" : "flat"
                };
            }

            const charIndex = this.findNearestCharIndex(metrics.positions, localX);
            const pitch = this.calculatePitch(localY);
            const slide = this.getCurrentSlide();
            const existingCandidate = slide && slide.notes && slide.notes[lineIndex]
                ? slide.notes[lineIndex][charIndex]
                : null;
            const existingNote = hasNoteData(existingCandidate) && this.isPointerOnNoteHead(
                metrics,
                slide,
                lineIndex,
                charIndex,
                existingCandidate,
                localSvgX,
                localY
            )
                ? existingCandidate
                : null;

            return {
                kind: "note",
                lineIndex,
                charIndex,
                pitch,
                duration: this.notesEngine.getDefaultDuration(this.getCurrentSlide().timeSignature),
                existingNote
            };
        }

        isPointerOnNoteHead(metrics, slide, lineIndex, charIndex, note, localSvgX, localY) {
            if (!metrics || !slide || !note || !hasNoteData(note)) {
                return false;
            }

            const position = this.getNoteVisualPosition(metrics, slide, charIndex, note.pitch);
            const headHalfWidth = this.notesEngine.lineSpacing * 0.95;
            const headHalfHeight = this.notesEngine.lineSpacing * 0.7;

            return Math.abs(localSvgX - position.x) <= headHalfWidth
                && Math.abs(localY - position.y) <= headHalfHeight;
        }

        isKeyArea(localSvgX) {
            const slide = this.getCurrentSlide();
            const keyInfo = this.notesEngine.parseKeySignature(slide ? slide.key : null);
            const start = this.notesEngine.clefMargin - 6;
            const width = Math.max(24, this.notesEngine.getKeySignatureWidth(keyInfo) + 10);
            return localSvgX >= start && localSvgX <= start + width;
        }

        getNoteAt(lineIndex, charIndex) {
            const slide = this.getCurrentSlide();
            if (!slide || !slide.notes || !slide.notes[lineIndex]) {
                return null;
            }

            return slide.notes[lineIndex][charIndex] || null;
        }

        getSelectedNote() {
            if (!this.selectedNoteTarget) {
                return null;
            }

            const note = this.getNoteAt(this.selectedNoteTarget.lineIndex, this.selectedNoteTarget.charIndex);
            if (!hasNoteData(note)) {
                this.selectedNoteTarget = null;
                this.noteMenuMode = "main";
                return null;
            }

            return {
                ...this.selectedNoteTarget,
                note
            };
        }

        setSelectedNoteTarget(target) {
            if (!target || !target.existingNote) {
                return;
            }

            const previousLine = this.selectedNoteTarget ? this.selectedNoteTarget.lineIndex : null;
            this.selectedNoteTarget = {
                lineIndex: target.lineIndex,
                charIndex: target.charIndex
            };
            this.noteMenuMode = "main";
            this.clearBeamSelection();
            if (previousLine !== null && previousLine !== target.lineIndex) {
                this.renderLine(previousLine);
            }
            this.renderLine(target.lineIndex);
            this.updateToolbarState();
        }

        clearSelectedNoteTarget(renderLine = true) {
            if (!this.selectedNoteTarget) {
                this.noteMenuMode = "main";
                this.renderNoteContextMenu();
                return false;
            }

            const previousLine = this.selectedNoteTarget.lineIndex;
            this.selectedNoteTarget = null;
            this.noteMenuMode = "main";
            if (renderLine) {
                this.renderLine(previousLine);
            } else {
                this.renderNoteContextMenu();
            }
            this.updateToolbarState();
            return true;
        }

        hasSelectedBeamNote(lineIndex, charIndex) {
            return this.selectedBeamNotes.some((item) => item.lineIndex === lineIndex && item.charIndex === charIndex);
        }

        getSelectedBeamLineIndex() {
            this.normalizeBeamSelection();
            if (this.selectedBeamNotes.length === 0) {
                return null;
            }

            const lineIndex = this.selectedBeamNotes[0].lineIndex;
            return this.selectedBeamNotes.every((item) => item.lineIndex === lineIndex) ? lineIndex : null;
        }

        isBeamTargetEligible(target) {
            return !!(target
                && target.kind === "note"
                && target.existingNote
                && isBeamableDuration(target.existingNote.duration));
        }

        normalizeBeamSelection() {
            this.selectedBeamNotes = this.selectedBeamNotes.filter((item) => {
                const note = this.getNoteAt(item.lineIndex, item.charIndex);
                return hasNoteData(note) && isBeamableDuration(note.duration);
            });
        }

        getSelectedBeamNotesForLine(lineIndex) {
            this.normalizeBeamSelection();
            return this.selectedBeamNotes
                .filter((item) => item.lineIndex === lineIndex)
                .map((item) => ({
                    ...item,
                    note: this.getNoteAt(item.lineIndex, item.charIndex)
                }))
                .filter((item) => hasNoteData(item.note));
        }

        validateBeamSelectionItems(selectionItems) {
            if (!Array.isArray(selectionItems) || selectionItems.length === 0) {
                return {
                    ok: true,
                    lineIndex: null
                };
            }

            const lineIndex = selectionItems[0].lineIndex;
            if (!selectionItems.every((item) => item.lineIndex === lineIndex)) {
                return {
                    ok: false,
                    reason: "연결선은 같은 줄의 음표만 함께 적용할 수 있습니다."
                };
            }

            if (selectionItems.length >= 2) {
                const baseDurations = new Set(selectionItems.map((item) => {
                    const note = this.getNoteAt(item.lineIndex, item.charIndex);
                    return getBaseDuration(note ? note.duration : "");
                }));

                if (baseDurations.size > 1) {
                    return {
                        ok: false,
                        reason: "8분음표와 16분음표는 함께 연결선으로 선택할 수 없습니다."
                    };
                }
            }

            const slide = this.getCurrentSlide();
            const lineNotes = slide && slide.notes && Array.isArray(slide.notes[lineIndex])
                ? slide.notes[lineIndex]
                : [];
            const selectedIndices = selectionItems
                .map((item) => item.charIndex)
                .sort((a, b) => a - b);
            const selectedSet = new Set(selectedIndices);
            const firstIndex = selectedIndices[0];
            const lastIndex = selectedIndices[selectedIndices.length - 1];

            for (let index = firstIndex; index <= lastIndex; index++) {
                if (selectedSet.has(index)) {
                    continue;
                }

                if (hasNoteData(lineNotes[index])) {
                    return {
                        ok: false,
                        reason: "인접하지 않은 음표들이 선택되었습니다."
                    };
                }
            }

            return {
                ok: true,
                lineIndex
            };
        }

        getBeamSelectionValidation() {
            this.normalizeBeamSelection();
            if (this.selectedBeamNotes.length < 2) {
                return {
                    ok: false,
                    reason: "연결선은 같은 줄의 음표를 두 개 이상 선택해야 적용할 수 있습니다."
                };
            }

            const lineIndex = this.getSelectedBeamLineIndex();
            if (lineIndex === null) {
                return {
                    ok: false,
                    reason: "연결선은 같은 줄의 음표만 함께 적용할 수 있습니다."
                };
            }

            return this.validateBeamSelectionItems(
                this.selectedBeamNotes.filter((item) => item.lineIndex === lineIndex)
            );
        }

        canApplyBeamSelection() {
            return this.getBeamSelectionValidation().ok;
        }

        canClearBeamSelection() {
            this.normalizeBeamSelection();
            return this.selectedBeamNotes.length > 0;
        }

        beginBeamDragSelection(event) {
            const notationEl = event.target.closest(".notation-container");
            const lineEl = notationEl ? notationEl.closest(".editor-line") : null;
            if (!notationEl || !lineEl) {
                return;
            }

            this.clearSelectedNoteTarget(false);

            const rect = notationEl.getBoundingClientRect();
            const lineRect = lineEl.getBoundingClientRect();
            const startX = event.clientX - rect.left;
            const startY = event.clientY - rect.top;
            const appendMode = event.ctrlKey || event.metaKey;
            const lineIndex = parseInt(lineEl.dataset.lineIndex, 10);

            if (this.selectedBeamNotes.length > 0) {
                const selectedLineIndex = this.getSelectedBeamLineIndex();
                if (selectedLineIndex !== null && selectedLineIndex !== lineIndex) {
                    this.clearBeamSelection({
                        statusMessage: `${lineIndex + 1}번째 줄로 연결선 선택 대상을 바꿨습니다. 연결선은 한 줄씩만 편집합니다.`
                    });
                } else if (!appendMode) {
                    this.clearBeamSelection();
                }
            }

            const selectionBox = document.createElement("div");
            selectionBox.className = "editor-drag-box";
            selectionBox.style.left = `${rect.left - lineRect.left + startX}px`;
            selectionBox.style.top = `${rect.top - lineRect.top + startY}px`;
            selectionBox.style.width = "0px";
            selectionBox.style.height = "0px";
            lineEl.appendChild(selectionBox);

            this.beamDragState = {
                notationEl,
                lineEl,
                lineIndex,
                startX,
                startY,
                currentX: startX,
                currentY: startY,
                moved: false,
                appendMode,
                offsetX: rect.left - lineRect.left,
                offsetY: rect.top - lineRect.top,
                selectionBox
            };

            event.preventDefault();
        }

        updateBeamDragSelection(event) {
            const state = this.beamDragState;
            if (!state) {
                return;
            }

            const rect = state.notationEl.getBoundingClientRect();
            state.currentX = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
            state.currentY = Math.max(0, Math.min(rect.height, event.clientY - rect.top));

            const left = Math.min(state.startX, state.currentX);
            const top = Math.min(state.startY, state.currentY);
            const width = Math.abs(state.currentX - state.startX);
            const height = Math.abs(state.currentY - state.startY);
            state.moved = state.moved || width > 6 || height > 6;

            state.selectionBox.style.left = `${state.offsetX + left}px`;
            state.selectionBox.style.top = `${state.offsetY + top}px`;
            state.selectionBox.style.width = `${width}px`;
            state.selectionBox.style.height = `${height}px`;
        }

        finishBeamDragSelection() {
            const state = this.beamDragState;
            if (!state) {
                return;
            }

            this.beamDragState = null;
            if (state.selectionBox && state.selectionBox.parentNode) {
                state.selectionBox.parentNode.removeChild(state.selectionBox);
            }

            if (!state.moved) {
                return;
            }

            const slide = this.getCurrentSlide();
            const lineEl = this.dom.canvas.querySelector(`.editor-line[data-line-index="${state.lineIndex}"]`);
            if (!slide || !lineEl || !lineEl._layout) {
                return;
            }

            const lineNotes = slide.notes && slide.notes[state.lineIndex] ? slide.notes[state.lineIndex] : [];
            const left = Math.min(state.startX, state.currentX);
            const right = Math.max(state.startX, state.currentX);
            const top = Math.min(state.startY, state.currentY);
            const bottom = Math.max(state.startY, state.currentY);
            const nextSelection = [];

            lineNotes.forEach((note, charIndex) => {
                if (!hasNoteData(note) || !isBeamableDuration(note.duration)) {
                    return;
                }

                const position = this.getNoteVisualPosition(lineEl._layout, slide, charIndex, note.pitch);
                const noteX = lineEl._layout.positions[charIndex];
                const noteY = position.y;
                if (noteX >= left && noteX <= right && noteY >= top && noteY <= bottom) {
                    nextSelection.push({
                        lineIndex: state.lineIndex,
                        charIndex
                    });
                }
            });

            const candidateSelection = state.appendMode
                ? [...this.selectedBeamNotes]
                : [];

            nextSelection.forEach((item) => {
                if (!candidateSelection.some((selected) => (
                    selected.lineIndex === item.lineIndex && selected.charIndex === item.charIndex
                ))) {
                    candidateSelection.push(item);
                }
            });

            const validation = this.validateBeamSelectionItems(candidateSelection);
            if (!validation.ok) {
                if (!state.appendMode) {
                    this.selectedBeamNotes = [];
                }
                this.renderLine(state.lineIndex);
                this.updateToolbarState();
                this.suppressClickUntil = Date.now() + 250;
                this.setStatus(validation.reason, "warning");
                return;
            }

            this.selectedBeamNotes = candidateSelection;
            this.selectedBeamNotes.sort((a, b) => a.charIndex - b.charIndex);
            this.renderLine(state.lineIndex);
            this.updateToolbarState();
            this.suppressClickUntil = Date.now() + 250;
            this.setStatus(nextSelection.length > 0 ? "드래그 박스로 연결선 후보 음표를 선택했습니다." : "드래그 박스 안에 선택 가능한 연결선 음표가 없었습니다.", nextSelection.length > 0 ? null : "warning");
        }

        findNearestCharIndex(positions, localX) {
            let bestIndex = 0;
            let bestDistance = Number.POSITIVE_INFINITY;

            for (let i = 0; i < positions.length; i++) {
                const distance = Math.abs(positions[i] - localX);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    bestIndex = i;
                }
            }

            return bestIndex;
        }

        calculatePitch(localY) {
            let bestPitch = "B4";
            let bestDistance = Number.POSITIVE_INFINITY;

            for (const [pitch, position] of Object.entries(this.notesEngine.pitchMap)) {
                // Pitch snapping should follow the staff grid, not the font glyph's visual center.
                const noteY = this.notesEngine.staffTopMargin
                    + (position * this.notesEngine.lineSpacing);
                const distance = Math.abs(noteY - localY);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    bestPitch = pitch;
                }
            }

            return bestPitch;
        }

        applyClickAction(target, direction) {
            const slide = this.getCurrentSlide();
            const lineEl = this.dom.canvas.querySelector(`.editor-line[data-line-index="${target.lineIndex}"]`);
            if (!lineEl || !lineEl._layout) {
                return;
            }

            this.recordHistory();
            const lineNotes = this.ensureLineNotes(slide, target.lineIndex, lineEl._layout.chars.length);
            const existing = lineNotes[target.charIndex];

            if (!hasNoteData(existing)) {
                lineNotes[target.charIndex] = {
                    pitch: target.pitch,
                    duration: target.duration
                };
            } else {
                existing.pitch = target.pitch;
            }

            this.cleanupOrphanBeamGroups(slide);
            this.commitSlideNotes(slide);
            this.renderLine(target.lineIndex);
            this.updateToolbarState();
            this.renderExportJson();
            this.setStatus("새 음표를 추가했습니다.");
            return;

            if (!hasNoteData(existing)) {
                if (existing.pitch !== target.pitch) {
                    existing.pitch = target.pitch;
                    this.setStatus(`음높이를 ${target.pitch}(으)로 변경했습니다.`);
                } else {
                    existing.duration = this.cycleDuration(existing.duration, direction);
                    this.normalizeNoteBeamState(existing);
                }
            } else {
                lineNotes[target.charIndex] = {
                    pitch: target.pitch,
                    duration: target.duration
                };
            }

            this.cleanupOrphanBeamGroups(slide);
            this.commitSlideNotes(slide);
            if (
                this.selectedNoteTarget
                && this.selectedNoteTarget.lineIndex === target.lineIndex
                && this.selectedNoteTarget.charIndex === target.charIndex
            ) {
                this.selectedNoteTarget = null;
                this.noteMenuMode = "main";
            }
            this.renderLine(target.lineIndex);
            this.updateToolbarState();
            this.renderExportJson();
        }

        toggleBeamSelection(target, appendMode = false) {
            if (!this.isBeamTargetEligible(target)) {
                this.setStatus("연결선은 기존 8분음표나 16분음표에서만 선택할 수 있습니다.", "warning");
                return;
            }

            if (this.selectedBeamNotes.length > 0) {
                const selectedLineIndex = this.getSelectedBeamLineIndex();
                if (selectedLineIndex !== null && selectedLineIndex !== target.lineIndex) {
                    this.clearBeamSelection({
                        statusMessage: `${target.lineIndex + 1}번째 줄로 연결선 선택 대상을 바꿨습니다. 연결선은 한 줄씩만 편집합니다.`
                    });
                } else if (!appendMode && !this.hasSelectedBeamNote(target.lineIndex, target.charIndex)) {
                    this.clearBeamSelection();
                }
            }

            const existingIndex = this.selectedBeamNotes.findIndex((item) => (
                item.lineIndex === target.lineIndex && item.charIndex === target.charIndex
            ));

            if (existingIndex >= 0) {
                this.selectedBeamNotes.splice(existingIndex, 1);
                this.renderLine(target.lineIndex);
                this.updateToolbarState();
                this.setStatus("연결선 선택에서 음표를 제거했습니다.");
                return;
            }

            this.selectedBeamNotes.push({
                lineIndex: target.lineIndex,
                charIndex: target.charIndex
            });
            const validation = this.validateBeamSelectionItems(this.selectedBeamNotes);
            if (!validation.ok) {
                this.selectedBeamNotes = this.selectedBeamNotes.filter((item) => !(
                    item.lineIndex === target.lineIndex && item.charIndex === target.charIndex
                ));
                this.renderLine(target.lineIndex);
                this.updateToolbarState();
                this.setStatus(validation.reason, "warning");
                return;
            }
            this.selectedBeamNotes.sort((a, b) => a.charIndex - b.charIndex);
            this.renderLine(target.lineIndex);
            this.updateToolbarState();
            this.setStatus("연결선 적용 후보에 음표를 추가했습니다.");
        }

        clearBeamSelection(options = {}) {
            const { statusMessage = null } = options;
            this.normalizeBeamSelection();
            if (this.selectedBeamNotes.length === 0) {
                this.renderBeamContextMenu();
                return false;
            }

            const touchedLines = [...new Set(this.selectedBeamNotes.map((item) => item.lineIndex))];
            this.selectedBeamNotes = [];
            touchedLines.forEach((lineIndex) => this.renderLine(lineIndex));
            this.updateToolbarState();

            if (statusMessage) {
                this.setStatus(statusMessage);
            }
            return true;
        }

        getNextBeamGroupId() {
            let maxId = 0;

            this.slides.forEach((slide) => {
                if (!slide.notes || !isPlainObject(slide.notes)) {
                    return;
                }

                Object.values(slide.notes).forEach((lineNotes) => {
                    if (!Array.isArray(lineNotes)) {
                        return;
                    }

                    lineNotes.forEach((note) => {
                        if (note && Number.isFinite(note.beamGroup)) {
                            maxId = Math.max(maxId, note.beamGroup);
                        }
                    });
                });
            });

            return maxId + 1;
        }

        applySelectedBeamGroup() {
            const validation = this.getBeamSelectionValidation();
            if (!validation.ok) {
                this.setStatus(validation.reason || "연결선 선택을 다시 확인해 주세요.", "warning");
                return;
            }

            const slide = this.getCurrentSlide();
            const lineIndex = validation.lineIndex;
            const lineEl = this.dom.canvas.querySelector(`.editor-line[data-line-index="${lineIndex}"]`);
            if (!slide || !lineEl || !lineEl._layout) {
                return;
            }

            this.recordHistory();
            const lineNotes = this.ensureLineNotes(slide, lineIndex, lineEl._layout.chars.length);
            const nextBeamGroup = this.getNextBeamGroupId();

            this.selectedBeamNotes.forEach((item) => {
                const note = lineNotes[item.charIndex];
                if (!hasNoteData(note) || !isBeamableDuration(note.duration)) {
                    return;
                }
                note.beamGroup = nextBeamGroup;
            });

            this.cleanupOrphanBeamGroups(slide);
            this.commitSlideNotes(slide);
            this.renderLine(lineIndex);
            this.updateToolbarState();
            this.renderExportJson();
            this.setStatus("선택한 음표에 연결선을 적용했습니다.");
        }

        clearSelectedBeamGroup() {
            this.normalizeBeamSelection();
            if (this.selectedBeamNotes.length === 0) {
                this.setStatus("해제할 연결선 선택이 없습니다.", "warning");
                return;
            }

            const slide = this.getCurrentSlide();
            const touchedLines = new Set();
            this.recordHistory();

            this.selectedBeamNotes.forEach((item) => {
                const note = this.getNoteAt(item.lineIndex, item.charIndex);
                if (note && note.beamGroup !== undefined) {
                    delete note.beamGroup;
                }
                touchedLines.add(item.lineIndex);
            });

            this.cleanupOrphanBeamGroups(slide);
            this.commitSlideNotes(slide);
            touchedLines.forEach((lineIndex) => this.renderLine(lineIndex));
            this.updateToolbarState();
            this.renderExportJson();
            this.setStatus("선택한 음표의 연결선을 해제했습니다.");
        }

        removeBeamGroupFromTarget(target) {
            if (!this.isBeamTargetEligible(target)) {
                return;
            }

            const note = this.getNoteAt(target.lineIndex, target.charIndex);
            if (!note || note.beamGroup === undefined) {
                return;
            }

            const slide = this.getCurrentSlide();
            const groupId = note.beamGroup;
            const lineNotes = slide && slide.notes ? slide.notes[target.lineIndex] : null;
            if (!Array.isArray(lineNotes)) {
                return;
            }

            this.recordHistory();
            lineNotes.forEach((lineNote) => {
                if (lineNote && lineNote.beamGroup === groupId) {
                    delete lineNote.beamGroup;
                }
            });

            this.selectedBeamNotes = this.selectedBeamNotes.filter((item) => item.lineIndex !== target.lineIndex);
            this.cleanupOrphanBeamGroups(slide);
            this.commitSlideNotes(slide);
            this.renderLine(target.lineIndex);
            this.updateToolbarState();
            this.renderExportJson();
            this.setStatus("해당 연결선을 제거했습니다.");
        }

        renderSelectedNoteOverlay(notationEl, slide, metrics, lineIndex) {
            const selectedNote = this.getSelectedNote();
            if (!selectedNote || selectedNote.lineIndex !== lineIndex) {
                return;
            }

            const svgEl = notationEl.querySelector("svg");
            if (!svgEl) {
                return;
            }

            const position = this.getNoteVisualPosition(metrics, slide, selectedNote.charIndex, selectedNote.note.pitch);
            svgEl.innerHTML += `
                <circle cx="${position.x}" cy="${position.y}"
                        r="${this.notesEngine.lineSpacing * 0.86}"
                        fill="none"
                        stroke="#3e2a19"
                        stroke-width="2.2"/>
            `;
        }

        getNoteMenuElement() {
            const slideCard = this.dom.canvas.querySelector(".editor-slide-card");
            if (!slideCard) {
                return null;
            }

            let menuEl = slideCard.querySelector("[data-note-menu]");
            if (!menuEl) {
                menuEl = document.createElement("div");
                menuEl.className = "editor-note-menu";
                menuEl.dataset.noteMenu = "true";
                menuEl.hidden = true;
                slideCard.appendChild(menuEl);
            }

            return menuEl;
        }

        renderNoteContextMenu() {
            const menuEl = this.getNoteMenuElement();
            if (!menuEl) {
                return;
            }

            const selectedNote = this.getSelectedNote();
            if (!this.isEditMode || !selectedNote) {
                menuEl.hidden = true;
                menuEl.innerHTML = "";
                return;
            }

            const lineEl = this.dom.canvas.querySelector(`.editor-line[data-line-index="${selectedNote.lineIndex}"]`);
            const notationEl = lineEl ? lineEl.querySelector(".notation-container") : null;
            const slideCard = this.dom.canvas.querySelector(".editor-slide-card");
            if (!lineEl || !notationEl || !lineEl._layout || !slideCard) {
                menuEl.hidden = true;
                menuEl.innerHTML = "";
                return;
            }

            const position = this.getNoteVisualPosition(lineEl._layout, this.getCurrentSlide(), selectedNote.charIndex, selectedNote.note.pitch);
            const notationRect = notationEl.getBoundingClientRect();
            const cardRect = slideCard.getBoundingClientRect();
            const noteX = notationRect.left - cardRect.left + position.x;
            const noteY = notationRect.top - cardRect.top + position.y;
            const currentBaseDuration = getBaseDuration(selectedNote.note.duration);

            menuEl.hidden = false;
            menuEl.style.left = `${noteX}px`;
            menuEl.style.top = `${noteY - 18}px`;

            if (this.noteMenuMode === "duration") {
                menuEl.innerHTML = `
                    <span class="editor-note-menu-label">길이 변경</span>
                    <div class="editor-note-duration-list">
                        ${NOTE_LENGTH_OPTIONS.map((item) => `
                            <button type="button" data-note-duration="${item.value}" class="${item.value === currentBaseDuration ? "is-current" : ""}">
                                ${item.label}
                            </button>
                        `).join("")}
                    </div>
                    <button type="button" data-note-menu-action="back">닫기</button>
                `;
                return;
            }

            menuEl.innerHTML = `
                <button type="button" data-note-menu-action="length">길이 변경</button>
                <button type="button" data-note-menu-action="dot">${selectedNote.note.duration.endsWith(".") ? "점 제거" : "점 추가"}</button>
                <button type="button" data-note-menu-action="delete">삭제</button>
                <button type="button" data-note-menu-action="close">닫기</button>
            `;
        }

        handleNoteMenuAction(action) {
            if (action === "length") {
                this.noteMenuMode = "duration";
                this.updateToolbarState();
                return;
            }

            if (action === "back") {
                this.noteMenuMode = "main";
                this.updateToolbarState();
                return;
            }

            if (action === "delete") {
                const selectedNote = this.getSelectedNote();
                if (selectedNote) {
                    this.deleteNote(selectedNote);
                    this.clearSelectedNoteTarget(false);
                }
                return;
            }

            if (action === "dot") {
                this.applySelectedNoteDotToggle();
                return;
            }

            if (action === "close") {
                this.clearSelectedNoteTarget();
            }
        }

        applySelectedNoteDuration(nextBaseDuration) {
            const selectedNote = this.getSelectedNote();
            if (!selectedNote) {
                return;
            }

            const slide = this.getCurrentSlide();
            const note = this.getNoteAt(selectedNote.lineIndex, selectedNote.charIndex);
            if (!slide || !note) {
                return;
            }

            const wasDotted = (note.duration || "").endsWith(".");
            this.recordHistory();
            note.duration = wasDotted ? `${nextBaseDuration}.` : nextBaseDuration;
            this.normalizeNoteBeamState(note);
            this.cleanupOrphanBeamGroups(slide);
            this.commitSlideNotes(slide);
            this.noteMenuMode = "main";
            this.renderLine(selectedNote.lineIndex);
            this.updateToolbarState();
            this.renderExportJson();
            this.setStatus("음표 길이를 변경했습니다.");
        }

        applySelectedNoteDotToggle() {
            const selectedNote = this.getSelectedNote();
            if (!selectedNote) {
                return;
            }

            const slide = this.getCurrentSlide();
            const note = this.getNoteAt(selectedNote.lineIndex, selectedNote.charIndex);
            if (!slide || !note) {
                return;
            }

            this.recordHistory();
            note.duration = this.toggleDottedDuration(note.duration);
            this.cleanupOrphanBeamGroups(slide);
            this.commitSlideNotes(slide);
            this.renderLine(selectedNote.lineIndex);
            this.updateToolbarState();
            this.renderExportJson();
            this.setStatus(note.duration.endsWith(".") ? "점음표를 추가했습니다." : "점음표를 제거했습니다.");
        }

        getBeamMenuElement() {
            const slideCard = this.dom.canvas.querySelector(".editor-slide-card");
            if (!slideCard) {
                return null;
            }

            let menuEl = slideCard.querySelector("[data-beam-menu]");
            if (!menuEl) {
                menuEl = document.createElement("div");
                menuEl.className = "editor-beam-menu";
                menuEl.dataset.beamMenu = "true";
                menuEl.hidden = true;
                slideCard.appendChild(menuEl);
            }

            return menuEl;
        }

        renderBeamContextMenu() {
            const menuEl = this.getBeamMenuElement();
            if (!menuEl) {
                return;
            }

            const lineIndex = this.getSelectedBeamLineIndex();
            if (!this.isEditMode || lineIndex === null || this.selectedBeamNotes.length === 0) {
                menuEl.hidden = true;
                menuEl.innerHTML = "";
                return;
            }

            const lineEl = this.dom.canvas.querySelector(`.editor-line[data-line-index="${lineIndex}"]`);
            const notationEl = lineEl ? lineEl.querySelector(".notation-container") : null;
            const slideCard = this.dom.canvas.querySelector(".editor-slide-card");
            if (!lineEl || !notationEl || !lineEl._layout || !slideCard) {
                menuEl.hidden = true;
                menuEl.innerHTML = "";
                return;
            }

            const selectedNotes = this.getSelectedBeamNotesForLine(lineIndex);
            if (selectedNotes.length === 0) {
                menuEl.hidden = true;
                menuEl.innerHTML = "";
                return;
            }

            const notePositions = selectedNotes
                .map((item) => lineEl._layout.positions[item.charIndex])
                .filter((value) => Number.isFinite(value));
            if (notePositions.length === 0) {
                menuEl.hidden = true;
                menuEl.innerHTML = "";
                return;
            }

            const minX = Math.min(...notePositions);
            const maxX = Math.max(...notePositions);
            const centerX = (minX + maxX) / 2;
            const notationRect = notationEl.getBoundingClientRect();
            const cardRect = slideCard.getBoundingClientRect();

            menuEl.hidden = false;
            menuEl.style.left = `${notationRect.left - cardRect.left + centerX}px`;
            menuEl.style.top = `${notationRect.top - cardRect.top - 12}px`;
            menuEl.innerHTML = `
                <span class="editor-beam-menu-count">${selectedNotes.length}개 선택</span>
                <button type="button" data-beam-menu-action="apply" ${this.canApplyBeamSelection() ? "" : "disabled"}>연결선 적용</button>
                <button type="button" data-beam-menu-action="clear" ${this.canClearBeamSelection() ? "" : "disabled"}>연결선 해제</button>
                <button type="button" data-beam-menu-action="cancel">선택 취소</button>
            `;
        }

        handleBeamMenuAction(action) {
            if (action === "apply") {
                this.applySelectedBeamGroup();
                return;
            }

            if (action === "clear") {
                this.clearSelectedBeamGroup();
                return;
            }

            if (action === "cancel") {
                this.clearBeamSelection({ statusMessage: "연결선 선택을 해제했습니다." });
            }
        }

        applyDotClickAction(target) {
            if (!target || target.kind !== "note" || !target.existingNote) {
                return;
            }

            const slide = this.getCurrentSlide();
            const lineEl = this.dom.canvas.querySelector(`.editor-line[data-line-index="${target.lineIndex}"]`);
            if (!slide || !lineEl || !lineEl._layout) {
                return;
            }

            this.recordHistory();
            const lineNotes = this.ensureLineNotes(slide, target.lineIndex, lineEl._layout.chars.length);
            const existing = lineNotes[target.charIndex];
            if (!hasNoteData(existing)) {
                return;
            }

            existing.duration = this.toggleDottedDuration(existing.duration);
            this.cleanupOrphanBeamGroups(slide);
            this.commitSlideNotes(slide);
            this.renderLine(target.lineIndex);
            this.updateToolbarState();
            this.renderExportJson();
            this.setStatus(existing.duration.endsWith(".") ? "점음표를 추가했습니다." : "점음표를 제거했습니다.");
        }

        applyKeyClickAction(target) {
            const hymn = this.data.hymn;
            const currentKey = this.notesEngine.parseKeySignature(hymn.key);
            const nextType = target.accidentalType;
            const nextCount = currentKey.type === nextType ? currentKey.count + 1 : 1;

            if (nextCount > 7) {
                this.setStatus("조표는 같은 종류로 최대 7개까지 추가할 수 있습니다.", "warning");
                return;
            }

            const nextKey = buildKeyString(nextType, nextCount);
            this.recordHistory();
            this.updateHymnKey(nextKey);
            this.setStatus(`조표를 ${nextKey || "없음"}으로 변경했습니다.`);
        }

        removeLastKeyAccidental() {
            const hymn = this.data.hymn;
            const currentKey = this.notesEngine.parseKeySignature(hymn.key);

            if (!currentKey.type || currentKey.count === 0) {
                this.setStatus("삭제할 조표가 없습니다.", "warning");
                return;
            }

            const nextCount = Math.max(0, currentKey.count - 1);
            const nextKey = buildKeyString(currentKey.type, nextCount);
            this.recordHistory();
            this.updateHymnKey(nextKey);
            this.setStatus(`조표를 ${nextKey || "없음"}으로 변경했습니다.`);
        }

        updateHymnKey(nextKey) {
            this.data.hymn.key = nextKey;
            this.slides.forEach((slide) => {
                slide.key = nextKey;
            });
            this.updateHeader();
            this.refreshCurrentSlideLayout();
            this.renderExportJson();
        }

        deleteNote(target) {
            const slide = this.getCurrentSlide();
            if (!slide.notes || !slide.notes[target.lineIndex]) {
                return;
            }

            this.recordHistory();
            slide.notes[target.lineIndex][target.charIndex] = null;
            this.cleanupOrphanBeamGroups(slide);
            this.commitSlideNotes(slide);
            if (
                this.selectedNoteTarget
                && this.selectedNoteTarget.lineIndex === target.lineIndex
                && this.selectedNoteTarget.charIndex === target.charIndex
            ) {
                this.selectedNoteTarget = null;
                this.noteMenuMode = "main";
            }
            this.renderLine(target.lineIndex);
            this.updateToolbarState();
            this.renderExportJson();
            this.setStatus("음표를 삭제했습니다.");
        }

        ensureLineNotes(slide, lineIndex, charCount) {
            if (!slide.notes || !isPlainObject(slide.notes)) {
                slide.notes = {};
                slide.notesOwner[slide.notesIndex] = slide.notes;
            }

            if (!Array.isArray(slide.notes[lineIndex])) {
                slide.notes[lineIndex] = new Array(charCount).fill(null);
            }

            while (slide.notes[lineIndex].length < charCount) {
                slide.notes[lineIndex].push(null);
            }

            return slide.notes[lineIndex];
        }

        cycleDuration(duration, direction) {
            const safeDuration = duration || "q";
            const isDotted = safeDuration.endsWith(".");
            const baseDuration = isDotted ? safeDuration.slice(0, -1) : safeDuration;
            const currentIndex = DURATION_ORDER.indexOf(baseDuration);
            const safeIndex = currentIndex >= 0 ? currentIndex : DURATION_ORDER.indexOf("q");
            const nextIndex = (safeIndex + direction + DURATION_ORDER.length) % DURATION_ORDER.length;
            const nextBase = DURATION_ORDER[nextIndex];
            return isDotted ? `${nextBase}.` : nextBase;
        }

        toggleDottedDuration(duration) {
            if (!duration) {
                return "q.";
            }

            return duration.endsWith(".") ? duration.slice(0, -1) : `${duration}.`;
        }

        normalizeNoteBeamState(note) {
            if (!note || note.beamGroup === undefined) {
                return;
            }

            if (!isBeamableDuration(note.duration)) {
                delete note.beamGroup;
            }
        }

        cleanupOrphanBeamGroups(slide) {
            if (!slide || !slide.notes || !isPlainObject(slide.notes)) {
                return;
            }

            this.cleanupOrphanBeamGroupsInNotesMap(slide.notes);
            this.normalizeBeamSelection();
        }

        commitSlideNotes(slide) {
            if (!slide.notes || !isPlainObject(slide.notes)) {
                slide.notesOwner[slide.notesIndex] = null;
                slide.notes = null;
                return;
            }

            slide.notes = this.normalizeNotesMapValue(slide.notes);
            slide.notesOwner[slide.notesIndex] = slide.notes;
        }

        clearHover() {
            if (!this.hoveredTarget) {
                return;
            }

            const previousLine = this.hoveredTarget.lineIndex;
            this.hoveredTarget = null;
            this.renderLine(previousLine);
        }

        isSameTarget(a, b) {
            if (!a || !b) {
                return false;
            }

            if (a.kind !== b.kind) {
                return false;
            }

            if (a.kind === "key") {
                return a.lineIndex === b.lineIndex
                    && a.accidentalType === b.accidentalType;
            }

            return a.lineIndex === b.lineIndex
                && a.charIndex === b.charIndex
                && a.pitch === b.pitch
                && a.duration === b.duration
                && !!a.existingNote === !!b.existingNote;
        }

        async saveCurrentHymn() {
            if (!this.data || !this.data.hymn || !window.HymnStorage) {
                this.setStatus("저장할 곡 데이터가 없습니다.", "warning");
                return;
            }

            try {
                await window.HymnStorage.saveHymn(this.data.hymn);
                this.refreshSavedHymnList();
                this.updateHeader();
                this.setStatus(`${this.data.hymn.number}장을 ${window.HymnStorage.getStorageLabel()}에 저장했습니다.`);
            } catch (error) {
                this.setStatus("저장 중 오류가 발생했습니다. 서버 상태를 확인해 주세요.", "warning");
            }
        }

        async deleteSavedHymn(hymnNumber) {
            if (!window.HymnStorage) {
                this.setStatus("삭제할 저장본이 없습니다.", "warning");
                return;
            }

            try {
                const deleted = await window.HymnStorage.deleteSavedHymn(hymnNumber);
                if (!deleted) {
                    this.setStatus("삭제할 저장본이 없습니다.", "warning");
                    return;
                }

                const isCurrent = this.data && this.data.hymn && this.data.hymn.number === hymnNumber;
                this.refreshSavedHymnList();

                if (isCurrent) {
                    this.loadHymn(hymnNumber);
                    this.setStatus(`${hymnNumber}장의 저장본을 삭제하고 기본 곡으로 다시 불러왔습니다.`);
                    return;
                }

                this.setStatus(`${hymnNumber}장의 저장본을 삭제했습니다.`);
            } catch (error) {
                this.setStatus("저장본 삭제 중 오류가 발생했습니다. 서버 상태를 확인해 주세요.", "warning");
            }
        }

        async deleteCurrentSavedHymn() {
            if (!this.data || !this.data.hymn) {
                return;
            }

            await this.deleteSavedHymn(this.data.hymn.number);
        }

        extractImportedHymn(payload) {
            if (!payload || typeof payload !== "object") {
                return null;
            }

            if (payload.number && /^\d+$/.test(String(payload.number))) {
                return deepClone(payload);
            }

            const keys = Object.keys(payload);
            if (keys.length !== 1) {
                return null;
            }

            const hymn = payload[keys[0]];
            if (!hymn || typeof hymn !== "object") {
                return null;
            }

            if (!hymn.number) {
                hymn.number = keys[0];
            }

            return /^\d+$/.test(String(hymn.number)) ? deepClone(hymn) : null;
        }

        async handleImportFile(event) {
            const file = event.target.files && event.target.files[0];
            if (!file) {
                return;
            }

            try {
                const text = await file.text();
                const payload = JSON.parse(text);
                const hymn = this.extractImportedHymn(payload);

                if (!hymn) {
                    throw new Error("invalid-payload");
                }

                if (!hymn.verses || typeof hymn.verses !== "object") {
                    hymn.verses = {};
                }

                if (!Array.isArray(hymn.chorus?.korean) && hymn.chorus) {
                    hymn.chorus.korean = hymn.chorus.korean || [];
                    hymn.chorus.english = hymn.chorus.english || [];
                    hymn.chorus.notes = hymn.chorus.notes || [];
                }

                await window.HymnStorage.saveHymn(hymn);
                this.refreshSavedHymnList();
                this.loadHymn(hymn.number);
                this.setStatus(`${hymn.number}장 JSON을 가져와 저장소에 반영했습니다.`);
            } catch (error) {
                this.setStatus("JSON 형식을 확인해 주세요. 한 곡 데이터 또는 export 형식만 가져올 수 있습니다.", "warning");
            } finally {
                event.target.value = "";
            }
        }

        buildExportPayload() {
            const hymn = this.data.hymn;
            const payload = {
                [hymn.number]: deepClone(hymn)
            };

            Object.keys(payload[hymn.number].verses).forEach((verseNum) => {
                const verse = payload[hymn.number].verses[verseNum];
                verse.notes = this.normalizeNotesArray(verse.notes);
            });

            if (payload[hymn.number].chorus) {
                payload[hymn.number].chorus.notes = this.normalizeNotesArray(payload[hymn.number].chorus.notes);
            }

            return payload;
        }

        normalizeNotesArray(slideNotesArray) {
            if (!Array.isArray(slideNotesArray)) {
                return null;
            }

            const normalized = slideNotesArray.map((slideNotes) => {
                if (!slideNotes || !isPlainObject(slideNotes)) {
                    return null;
                }

                const result = {};
                Object.keys(slideNotes)
                    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
                    .forEach((lineKey) => {
                        const trimmedLine = trimTrailingNulls(slideNotes[lineKey] || [])
                            .map((note) => note ? { ...note } : null);

                        if (trimmedLine.some(hasNoteData)) {
                            result[lineKey] = trimmedLine;
                        }
                    });

                return Object.keys(result).length > 0 ? result : null;
            });

            return normalized.some((item) => item !== null) ? normalized : null;
        }

        renderExportJson() {
            this.dom.exportOutput.value = JSON.stringify(this.buildExportPayload(), null, 2);
        }

        async copyExportJson() {
            const text = this.dom.exportOutput.value;

            if (!text) {
                this.setStatus("복사할 JSON이 없습니다.", "warning");
                return;
            }

            try {
                await navigator.clipboard.writeText(text);
                this.setStatus("현재 곡의 notes JSON을 클립보드에 복사했습니다.");
            } catch (error) {
                this.dom.exportOutput.focus();
                this.dom.exportOutput.select();
                this.setStatus("클립보드 권한이 없어 JSON을 선택해 두었습니다.", "warning");
            }
        }

        downloadExportJson() {
            const hymnNumber = this.data.hymn.number;
            const text = this.dom.exportOutput.value;
            const blob = new Blob([text], { type: "application/json;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `hymn-${hymnNumber}-notes.json`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            this.setStatus(`${hymnNumber}장 notes JSON을 다운로드했습니다.`);
        }

        setStatus(message, tone) {
            this.dom.status.textContent = message;
            this.dom.status.className = `editor-status${tone ? ` ${tone}` : ""}`;
        }
    }

    document.addEventListener("DOMContentLoaded", () => {
        const editor = new HymnEditor();
        window.hymnEditor = editor;
        editor.init();
    });
})();
