(function () {
    const DEFAULT_HYMN_ID = "46";

    function deepClone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function normalizeHymnPitchLabels(hymn) {
        if (!hymn || typeof hymn !== "object") return hymn;
        hymn.id = getSongId(hymn);
        hymn.category = getSongCategory(hymn);
        return hymn;
    }

    function getSongId(song) {
        return String((song && (song.id || song.number)) || "").trim();
    }

    function getSongCategory(song) {
        if (song && typeof song.category === "string" && song.category.trim()) {
            return song.category.trim();
        }

        return /^\d+$/.test(getSongId(song)) ? "hymn" : "song";
    }

    function isHymnSong(song) {
        return getSongCategory(song) === "hymn";
    }

    function getSongReference(song) {
        if (!song) {
            return "";
        }

        if (isHymnSong(song) && song.number) {
            return `${song.number}장`;
        }

        return getSongId(song);
    }

    function getSongDisplayTitle(song) {
        const reference = getSongReference(song);
        if (!song || !song.title) {
            return reference;
        }

        return reference ? `${reference} ${song.title}` : song.title;
    }


    function getRequestedHymnId() {
        const params = new URLSearchParams(window.location.search);
        const queryValue = params.get("song") || params.get("hymn");
        const hashValue = window.location.hash.replace(/^#/, "");
        const candidate = queryValue || hashValue || DEFAULT_HYMN_ID;
        return candidate ? candidate.trim() : DEFAULT_HYMN_ID;
    }

    function updateTitle(hymn) {
        document.title = `${getSongDisplayTitle(hymn)} - 악보 프레젠테이션`;
    }

    function setStatus(message, tone) {
        const statusEl = document.getElementById("app-status");
        if (!statusEl) {
            return;
        }

        if (!message) {
            statusEl.hidden = true;
            statusEl.textContent = "";
            statusEl.className = "app-status";
            return;
        }

        statusEl.hidden = false;
        statusEl.textContent = message;
        statusEl.className = `app-status ${tone || "info"}`;
    }

    function updatePicker(hymn, enabled) {
        const inputEl = document.getElementById("hymn-number");
        const titleEl = document.getElementById("hymn-picker-title");
        const buttonEl = document.querySelector("#hymn-picker button");

        if (inputEl) {
            inputEl.value = getSongId(hymn);
            inputEl.disabled = !enabled;
        }

        if (buttonEl) {
            buttonEl.disabled = !enabled;
        }

        if (titleEl) {
            titleEl.textContent = getSongDisplayTitle(hymn);
        }
    }

    function hasRenderableNotes(song) {
        if (!song || typeof song !== "object") {
            return false;
        }

        const hasLineNotes = (slides) => Array.isArray(slides) && slides.some((slideNotes) => {
            if (!slideNotes || typeof slideNotes !== "object") {
                return false;
            }

            return Object.values(slideNotes).some((lineNotes) => (
                Array.isArray(lineNotes) && lineNotes.some((note) => note && note.pitch)
            ));
        });

        if (song.verses && typeof song.verses === "object") {
            const hasVerseNotes = Object.values(song.verses).some((verse) => verse && hasLineNotes(verse.notes));
            if (hasVerseNotes) {
                return true;
            }
        }

        return !!(song.chorus && hasLineNotes(song.chorus.notes));
    }

    function buildOptions(song) {
        return {
            useBackground: false,
            backgroundImage: null,
            backgroundOpacity: 0.7,
            showNotes: hasRenderableNotes(song)
        };
    }

    async function initStorage() {
        if (!window.HymnStorage || typeof window.HymnStorage.init !== "function") {
            return null;
        }

        try {
            return await window.HymnStorage.init();
        } catch (error) {
            return null;
        }
    }

    function hasAvailableHymn(hymnId, hymnMap) {
        return !!(hymnMap && hymnMap[hymnId]);
    }

    function buildPresentationData(hymnId, hymnMap) {
        if (!hymnMap) {
            return { options: buildOptions({}), hymn: {} };
        }

        const selectedHymn = hymnMap[hymnId] || hymnMap[DEFAULT_HYMN_ID];
        if (!selectedHymn) {
            return { options: buildOptions({}), hymn: {} };
        }

        return {
            options: buildOptions(selectedHymn),
            hymn: normalizeHymnPitchLabels(deepClone(selectedHymn))
        };
    }

    function buildHymnMapFromStorage() {
        if (!window.HymnStorage) {
            return null;
        }

        const list = window.HymnStorage.listSavedHymns();
        if (!list || list.length === 0) {
            return null;
        }

        const map = {};
        for (const item of list) {
            const hymn = window.HymnStorage.getSavedHymn(item.id);
            if (hymn) {
                map[item.id] = hymn;
            }
        }

        return Object.keys(map).length > 0 ? map : null;
    }

    function navigateToHymn(hymnId) {
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set("song", hymnId);
        nextUrl.searchParams.delete("hymn");
        nextUrl.hash = hymnId;
        window.location.href = nextUrl.toString();
    }

    function bindPicker(datasetReady, hymnMap) {
        const formEl = document.getElementById("hymn-picker");
        if (!formEl) {
            return;
        }

        formEl.dataset.datasetReady = datasetReady ? "true" : "false";
        formEl._hymnMap = hymnMap || null;
        if (formEl.dataset.bound === "true") {
            return;
        }

        formEl.dataset.bound = "true";

        formEl.addEventListener("submit", (event) => {
            event.preventDefault();

            const inputEl = document.getElementById("hymn-number");
            if (!inputEl) {
                return;
            }

            const hymnId = inputEl.value.trim();
            if (!hymnId) {
                setStatus("곡 ID를 입력해 주세요.", "warning");
                inputEl.focus();
                return;
            }

            if (formEl.dataset.datasetReady !== "true" && !hasAvailableHymn(hymnId, formEl._hymnMap)) {
                setStatus("지금은 전체 곡 데이터셋을 읽지 못하고 있습니다. 저장본이나 46장만 열 수 있습니다.", "warning");
                return;
            }

            navigateToHymn(hymnId);
        });
    }

    function startPresentation(data) {
        updateTitle(data.hymn);
        updatePicker(data.hymn, true);
        window.currentPresentation = new PresentationEngine("presentation", data);
    }

    async function init() {
        const requestedHymnId = getRequestedHymnId();

        await initStorage();
        bindPicker(false, null);

        const hymnMap = buildHymnMapFromStorage();
        const datasetReady = !!hymnMap;

        if (!datasetReady) {
            setStatus("곡 데이터를 불러올 수 없습니다. 로컬 서버(server.py)를 실행해 주세요.", "warning");
            startPresentation(buildPresentationData(DEFAULT_HYMN_ID, null));
            return;
        }

        const resolvedId = hasAvailableHymn(requestedHymnId, hymnMap) ? requestedHymnId : DEFAULT_HYMN_ID;
        const data = buildPresentationData(resolvedId, hymnMap);
        startPresentation(data);
        bindPicker(true, hymnMap);

        if (resolvedId !== requestedHymnId) {
            setStatus(`${requestedHymnId} 곡을 찾지 못해 ${getSongReference(data.hymn) || resolvedId}(으)로 대신 열었습니다.`, "warning");
        }
    }

    document.addEventListener("DOMContentLoaded", init);
})();
