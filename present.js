(function () {
    const PITCH_LABEL_VERSION = 2;
    const LEGACY_PITCH_SHIFT_DOWN = {
        C4: "B3", D4: "C4", E4: "D4", F4: "E4", G4: "F4", A4: "G4", B4: "A4",
        C5: "B4", D5: "C5", E5: "D5", F5: "E5", G5: "F5", A5: "G5", B5: "A5",
        C6: "B5", D6: "C6", E6: "D6"
    };

    function deepClone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function shiftPitchLabelsInNotes(notes) {
        if (Array.isArray(notes)) {
            notes.forEach((item) => shiftPitchLabelsInNotes(item));
            return;
        }
        if (!notes || typeof notes !== "object") return;
        if (typeof notes.pitch === "string") {
            notes.pitch = LEGACY_PITCH_SHIFT_DOWN[notes.pitch] || notes.pitch;
            return;
        }
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
        if (hymn.chorus && Array.isArray(hymn.chorus.notes)) {
            shiftPitchLabelsInNotes(hymn.chorus.notes);
        }
        hymn.pitchLabelVersion = PITCH_LABEL_VERSION;
        return hymn;
    }

    function getSongId(song) {
        return String((song && (song.id || song.number)) || "").trim();
    }

    function getSongCategory(song) {
        if (song && typeof song.category === "string" && song.category.trim()) return song.category.trim();
        return /^\d+$/.test(getSongId(song)) ? "hymn" : "song";
    }

    function isHymnSong(song) {
        return getSongCategory(song) === "hymn";
    }

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
            id: songId,
            song,
            haystack: normalizeSearchText([...titleParts, ...lyricSegments].join(" ")),
            titleText: normalizeSearchText(titleParts.join(" ")),
            lyricSegments
        };
    }

    function getSongPreviewText(song) {
        const lyrics = flattenSongLyrics(song);
        return lyrics.length > 0 ? lyrics[0] : "";
    }

    // ──────────────────────────────────────────
    // Presentation Mode Controller
    // ──────────────────────────────────────────

    class PresentMode {
        constructor() {
            this.dom = {
                sidebar: document.getElementById("present-sidebar"),
                toggleSidebar: document.getElementById("present-toggle-sidebar"),
                searchForm: document.getElementById("present-search-form"),
                searchInput: document.getElementById("present-search-input"),
                searchResults: document.getElementById("present-search-results"),
                setlist: document.getElementById("present-setlist"),
                status: document.getElementById("present-status"),
                counter: document.getElementById("present-slide-counter"),
                presentationContainer: document.getElementById("presentation")
            };

            this.songMap = {};
            this.searchIndex = [];
            this.searchQuery = "";
            this.setlistItems = [];       // [{id, song}]
            this.presentation = null;     // PresentationEngine (현재 슬라이드 컨트롤)
            this.allSlides = [];          // 전체 곡 순서에 따른 통합 슬라이드 정보
            this.currentGlobalIndex = 0;
            this.dragSourceIndex = null;
        }

        async init() {
            await this.loadSongs();
            this.bindControls();
            this.listenForUpdates();
            this.renderSetlist();
            this.renderSearchResults();
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
            // DB에서 최신 데이터 다시 불러오기
            await window.HymnStorage.init({ forceRefresh: true });
            const hymn = window.HymnStorage.getSavedHymn(songId);
            if (!hymn) return;

            // songMap 및 검색 인덱스 갱신
            this.songMap[songId] = hymn;
            this.searchIndex = Object.keys(this.songMap)
                .map((id) => buildSongSearchEntry(this.songMap[id]))
                .filter((entry) => !!entry.id);

            // 곡 순서에 해당 곡이 있으면 데이터 교체 후 프레젠테이션 재빌드
            let affected = false;
            for (const item of this.setlistItems) {
                if (item.id === songId) {
                    item.song = deepClone(hymn);
                    affected = true;
                }
            }

            if (affected) {
                const savedIndex = this.currentGlobalIndex;
                this.rebuildPresentation();
                this.showGlobalSlide(Math.min(savedIndex, this.allSlides.length - 1));
            }
        }

        async loadSongs() {
            if (!window.HymnStorage) return;
            try {
                await window.HymnStorage.init();
            } catch (_) { /* ignore */ }

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

        bindControls() {
            // 사이드바 토글
            this.dom.toggleSidebar.addEventListener("click", () => {
                document.querySelector(".present-shell").classList.toggle("sidebar-collapsed");
            });

            // 검색
            if (this.dom.searchForm && this.dom.searchInput) {
                this.dom.searchForm.addEventListener("submit", (event) => {
                    event.preventDefault();
                    this.searchQuery = this.dom.searchInput.value;
                    this.renderSearchResults();
                });
            }

            // 검색 결과 클릭 (곡 순서에 추가)
            if (this.dom.searchResults) {
                this.dom.searchResults.addEventListener("click", (event) => {
                    const addButton = event.target.closest("[data-add-song]");
                    if (addButton) this.addToSetlist(addButton.dataset.addSong);
                });
            }

            // 곡 순서 클릭 (편집/삭제)
            this.dom.setlist.addEventListener("click", (event) => {
                const editButton = event.target.closest("[data-edit-song]");
                if (editButton) {
                    window.open(`editor.html?song=${encodeURIComponent(editButton.dataset.editSong)}`, "_blank");
                    return;
                }

                const deleteButton = event.target.closest("[data-delete-index]");
                if (deleteButton) {
                    this.removeFromSetlist(parseInt(deleteButton.dataset.deleteIndex, 10));
                }
            });

            // 키보드 제어
            document.addEventListener("keydown", (event) => {
                // 검색 input에 포커스 있으면 프레젠테이션 키보드 무시
                if (document.activeElement === this.dom.searchInput) return;

                switch (event.key) {
                    case "ArrowRight":
                    case " ":
                        event.preventDefault();
                        this.nextSlide();
                        break;
                    case "ArrowLeft":
                        event.preventDefault();
                        this.prevSlide();
                        break;
                    case "f":
                    case "F":
                        this.toggleFullscreen();
                        break;
                    case "Escape":
                        if (document.fullscreenElement) document.exitFullscreen();
                        break;
                }
            });

            // 클릭 제어 (메인 영역)
            this.dom.presentationContainer.addEventListener("click", (event) => {
                const x = event.clientX;
                const rect = this.dom.presentationContainer.getBoundingClientRect();
                if (x < rect.left + rect.width / 2) {
                    this.prevSlide();
                } else {
                    this.nextSlide();
                }
            });
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
            if (!this.dom.searchResults) return;

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
                        <span class="present-search-title">${getSongDisplayTitle(entry.song)}</span>
                        <span class="present-search-meta">${entry.id}</span>
                        <span class="present-search-snippet">${preview || "가사 미리보기가 없습니다."}</span>
                        <button type="button" class="present-search-add" data-add-song="${entry.id}">곡 순서에 추가</button>
                    </div>
                `;
            }).join("");
        }

        // ── 곡 순서 관리 ──

        addToSetlist(songId) {
            const song = this.songMap[songId];
            if (!song) return;
            this.setlistItems.push({ id: songId, song: deepClone(song) });
            this.renderSetlist();
            this.rebuildPresentation();
        }

        removeFromSetlist(index) {
            if (index < 0 || index >= this.setlistItems.length) return;
            this.setlistItems.splice(index, 1);
            this.renderSetlist();
            this.rebuildPresentation();
        }

        moveSetlistItem(fromIndex, toIndex) {
            if (fromIndex === toIndex) return;
            if (fromIndex < 0 || fromIndex >= this.setlistItems.length) return;
            if (toIndex < 0 || toIndex >= this.setlistItems.length) return;
            const [item] = this.setlistItems.splice(fromIndex, 1);
            this.setlistItems.splice(toIndex, 0, item);
            this.renderSetlist();
            this.rebuildPresentation();
        }

        renderSetlist() {
            if (!this.dom.setlist) return;

            if (this.setlistItems.length === 0) {
                this.dom.setlist.innerHTML = '<div class="present-setlist-empty">곡 검색에서 곡을 추가하세요.</div>';
                return;
            }

            this.dom.setlist.innerHTML = this.setlistItems.map((item, index) => `
                <div class="present-setlist-card" draggable="true" data-setlist-index="${index}">
                    <span class="present-setlist-order">${index + 1}</span>
                    <div class="present-setlist-info">
                        <span class="present-setlist-title">${getSongDisplayTitle(item.song)}</span>
                        <span class="present-setlist-meta">${getSongId(item.song)}</span>
                    </div>
                    <div class="present-setlist-actions">
                        <button type="button" class="present-setlist-edit" data-edit-song="${getSongId(item.song)}" title="편집">&#9998;</button>
                        <button type="button" class="present-setlist-delete" data-delete-index="${index}" title="삭제">&times;</button>
                    </div>
                </div>
            `).join("");

            // 드래그 이벤트 바인딩
            this.bindDragEvents();
        }

        bindDragEvents() {
            const cards = this.dom.setlist.querySelectorAll(".present-setlist-card");

            cards.forEach((card) => {
                card.addEventListener("dragstart", (event) => {
                    this.dragSourceIndex = parseInt(card.dataset.setlistIndex, 10);
                    card.classList.add("is-dragging");
                    event.dataTransfer.effectAllowed = "move";
                });

                card.addEventListener("dragend", () => {
                    card.classList.remove("is-dragging");
                    this.dragSourceIndex = null;
                    cards.forEach((c) => c.classList.remove("drag-over"));
                });

                card.addEventListener("dragover", (event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    card.classList.add("drag-over");
                });

                card.addEventListener("dragleave", () => {
                    card.classList.remove("drag-over");
                });

                card.addEventListener("drop", (event) => {
                    event.preventDefault();
                    card.classList.remove("drag-over");
                    const toIndex = parseInt(card.dataset.setlistIndex, 10);
                    if (this.dragSourceIndex !== null && this.dragSourceIndex !== toIndex) {
                        this.moveSetlistItem(this.dragSourceIndex, toIndex);
                    }
                    this.dragSourceIndex = null;
                });
            });
        }

        // ── 프레젠테이션 빌드 ──

        buildSlidesForHymn(hymn) {
            const slides = [];
            const showNotes = hasRenderableNotes(hymn);
            const songRef = getSongReference(hymn);
            const songTitle = getSongDisplayTitle(hymn);

            // 타이틀 슬라이드
            const subtitle = getSongCategory(hymn) === "hymn" && hymn.newNumber
                ? `새찬송가 ${hymn.newNumber}장`
                : (hymn.subtitle || "");

            slides.push({
                type: "title",
                html: `
                    <div class="slide title-slide">
                        <div class="slide-content">
                            <div class="hymn-number">${songRef || getSongId(hymn)}</div>
                            <div class="hymn-title">${hymn.title || ""}</div>
                            ${subtitle ? `<div class="hymn-subtitle">${subtitle}</div>` : ""}
                            <div class="hymn-meta">${hymn.key || ""} | ${hymn.timeSignature || ""} | ${hymn.composer || ""}</div>
                        </div>
                    </div>
                `,
                notes: null
            });

            // 절 슬라이드
            if (hymn.verses) {
                const verseNumbers = Object.keys(hymn.verses).sort((a, b) => parseInt(a) - parseInt(b));
                const totalVerses = verseNumbers.length;

                for (const verseNum of verseNumbers) {
                    const verse = hymn.verses[verseNum];
                    const slideCount = Math.max(
                        (verse.korean || []).length,
                        (verse.english || []).length
                    );

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
                                        <div class="slide-title">${songTitle}</div>
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

                    // 후렴
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
                                            <div class="slide-title">${songTitle}</div>
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
            this.allSlides = [];
            this.slideData = [];
            const container = this.dom.presentationContainer;

            if (this.setlistItems.length === 0) {
                container.innerHTML = "";
                this.updateCounter();
                return;
            }

            container.innerHTML = "";

            for (const item of this.setlistItems) {
                const hymn = normalizeHymnPitchLabels(deepClone(item.song));
                const slides = this.buildSlidesForHymn(hymn);
                slides.forEach((s) => this.slideData.push(s));
            }

            // 슬라이드 HTML을 컨테이너에 삽입
            container.innerHTML = this.slideData.map((s) => s.html).join("");
            this.allSlides = Array.from(container.querySelectorAll(".slide"));

            // 음표 렌더링
            this.renderAllNotes();

            this.currentGlobalIndex = 0;
            this.showGlobalSlide(0);
        }

        renderAllNotes() {
            if (!window.NotesEngine) return;
            const notesEngine = new NotesEngine({ staffHeight: 40, staffColor: "#bbb", noteColor: "#000" });

            this.allSlides.forEach((slideEl, index) => {
                const data = this.slideData[index];
                if (!data || !data.notes) return;

                const koreanEl = slideEl.querySelector(".lyrics-korean");
                if (koreanEl) {
                    notesEngine.addNotationToLyrics(koreanEl, data.notes, data.timeSignature, data.key);
                }
            });
        }

        showGlobalSlide(index) {
            if (this.allSlides.length === 0) return;
            if (index < 0) index = 0;
            if (index >= this.allSlides.length) index = this.allSlides.length - 1;

            this.allSlides.forEach((el, i) => {
                el.classList.toggle("active", i === index);
            });

            this.currentGlobalIndex = index;
            this.updateCounter();

            // 악보 재렌더링 (display:none에서 보이게 될 때 레이아웃 재계산 필요)
            const data = this.slideData && this.slideData[index];
            if (data && data.notes && window.NotesEngine) {
                const slideEl = this.allSlides[index];
                const koreanEl = slideEl.querySelector(".lyrics-korean");
                if (koreanEl) {
                    requestAnimationFrame(() => {
                        const notesEngine = new NotesEngine({ staffHeight: 40, staffColor: "#bbb", noteColor: "#000" });
                        notesEngine.renderNotations(koreanEl, data.notes, data.key);
                    });
                }
            }
        }

        nextSlide() {
            if (this.currentGlobalIndex < this.allSlides.length - 1) {
                this.showGlobalSlide(this.currentGlobalIndex + 1);
            }
        }

        prevSlide() {
            if (this.currentGlobalIndex > 0) {
                this.showGlobalSlide(this.currentGlobalIndex - 1);
            }
        }

        updateCounter() {
            if (!this.dom.counter) return;
            if (this.allSlides.length === 0) {
                this.dom.counter.textContent = "";
                return;
            }
            this.dom.counter.textContent = `${this.currentGlobalIndex + 1} / ${this.allSlides.length}`;
        }

        toggleFullscreen() {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen();
            } else {
                document.exitFullscreen();
            }
        }

        setStatus(message, tone) {
            if (!this.dom.status) return;
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
