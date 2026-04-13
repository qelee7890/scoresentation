(function () {
    const STORAGE_KEY = "scoresentation.saved_hymns.v1";
    const API_BASE = "/api/hymns";
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
    let activeStore = {};
    let storageMode = "local";
    let initPromise = null;

    function deepClone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function readStore() {
        try {
            const raw = window.localStorage.getItem(STORAGE_KEY);
            if (!raw) {
                return {};
            }

            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === "object" ? parsed : {};
        } catch (error) {
            return {};
        }
    }

    function writeStore(store) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    }

    function isValidHymnNumber(value) {
        return /^\d+$/.test(String(value || ""));
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

    function normalizeHymnRecord(hymn) {
        if (!hymn || typeof hymn !== "object" || !isValidHymnNumber(hymn.number)) {
            return null;
        }

        return normalizeHymnPitchLabels(deepClone(hymn));
    }

    function normalizeStoreEntry(entry) {
        if (!entry || typeof entry !== "object" || !entry.hymn) {
            return null;
        }

        const hymn = normalizeHymnRecord(entry.hymn);
        if (!hymn) {
            return null;
        }

        return {
            hymn,
            updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : ""
        };
    }

    function normalizeStore(store) {
        const normalized = {};
        if (!store || typeof store !== "object") {
            return normalized;
        }

        Object.keys(store).forEach((number) => {
            const entry = normalizeStoreEntry(store[number]);
            if (entry) {
                normalized[number] = entry;
            }
        });

        return normalized;
    }

    function setActiveStore(store) {
        activeStore = normalizeStore(store);
    }

    function getStorageLabel() {
        return storageMode === "database" ? "데이터베이스" : "브라우저 저장소";
    }

    async function requestJson(url, options) {
        const response = await fetch(url, options);
        const text = await response.text();
        const payload = text ? JSON.parse(text) : {};

        if (!response.ok) {
            const error = new Error(payload && payload.error ? payload.error : `HTTP ${response.status}`);
            error.status = response.status;
            throw error;
        }

        return payload;
    }

    function normalizeRemoteItem(item) {
        if (!item || typeof item !== "object") {
            return null;
        }

        const hymn = normalizeHymnRecord(item.hymn || item);
        if (!hymn) {
            return null;
        }

        return {
            hymn,
            updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : ""
        };
    }

    async function loadRemoteStore() {
        const payload = await requestJson(API_BASE, { cache: "no-store" });
        const items = Array.isArray(payload) ? payload : Array.isArray(payload.items) ? payload.items : [];
        const store = {};

        items.forEach((item) => {
            const normalized = normalizeRemoteItem(item);
            if (normalized) {
                store[normalized.hymn.number] = normalized;
            }
        });

        return store;
    }

    async function syncLegacyLocalStore() {
        const localStore = normalizeStore(readStore());
        const hymnNumbers = Object.keys(localStore);

        for (const number of hymnNumbers) {
            const localEntry = localStore[number];
            const remoteEntry = activeStore[number];
            const shouldUpload = !remoteEntry
                || (
                    localEntry.updatedAt
                    && (!remoteEntry.updatedAt || localEntry.updatedAt > remoteEntry.updatedAt)
                );

            if (!shouldUpload) {
                continue;
            }

            try {
                const payload = await requestJson(`${API_BASE}/${encodeURIComponent(number)}`, {
                    method: "PUT",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({ hymn: localEntry.hymn })
                });
                const normalized = normalizeRemoteItem(payload.item || payload);
                if (normalized) {
                    activeStore[number] = normalized;
                }
            } catch (error) {
                console.warn("Failed to migrate legacy local hymn to database:", number, error);
            }
        }
    }

    async function init(options) {
        const forceRefresh = !!(options && options.forceRefresh);

        if (forceRefresh) {
            initPromise = null;
        }

        if (initPromise) {
            return initPromise;
        }

        initPromise = (async () => {
            try {
                const remoteStore = await loadRemoteStore();
                storageMode = "database";
                setActiveStore(remoteStore);
                await syncLegacyLocalStore();
            } catch (error) {
                storageMode = "local";
                const localStore = normalizeStore(readStore());
                writeStore(localStore);
                setActiveStore(localStore);
            }

            return {
                mode: storageMode,
                label: getStorageLabel(),
                count: Object.keys(activeStore).length
            };
        })();

        return initPromise;
    }

    function ensureReady() {
        if (initPromise) {
            return initPromise;
        }

        return Promise.resolve({
            mode: storageMode,
            label: getStorageLabel(),
            count: Object.keys(activeStore).length
        });
    }

    function listSavedHymns() {
        return Object.keys(activeStore)
            .map((number) => {
                const entry = activeStore[number];
                if (!entry || !entry.hymn) {
                    return null;
                }

                return {
                    number,
                    title: entry.hymn.title || "",
                    newNumber: entry.hymn.newNumber || "",
                    composer: entry.hymn.composer || "",
                    key: entry.hymn.key || "",
                    timeSignature: entry.hymn.timeSignature || "",
                    updatedAt: entry.updatedAt || ""
                };
            })
            .filter(Boolean)
            .sort((a, b) => parseInt(a.number, 10) - parseInt(b.number, 10));
    }

    function getSavedHymn(number) {
        const id = String(number || "");
        const entry = activeStore[id];
        if (!entry || !entry.hymn) {
            return null;
        }

        return deepClone(entry.hymn);
    }

    function hasSavedHymn(number) {
        return !!getSavedHymn(number);
    }

    async function saveHymn(hymn) {
        const normalized = normalizeHymnRecord(hymn);
        if (!normalized) {
            throw new Error("Invalid hymn payload");
        }

        await ensureReady();

        if (storageMode === "database") {
            const payload = await requestJson(`${API_BASE}/${encodeURIComponent(normalized.number)}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ hymn: normalized })
            });
            const entry = normalizeRemoteItem(payload.item || payload);
            if (!entry) {
                throw new Error("Invalid server response");
            }
            activeStore[normalized.number] = entry;
            return normalized.number;
        }

        const store = normalizeStore(readStore());
        store[normalized.number] = {
            hymn: deepClone(normalized),
            updatedAt: new Date().toISOString()
        };
        writeStore(store);
        setActiveStore(store);
        return normalized.number;
    }

    async function deleteSavedHymn(number) {
        const id = String(number || "");
        await ensureReady();

        if (storageMode === "database") {
            try {
                await requestJson(`${API_BASE}/${encodeURIComponent(id)}`, {
                    method: "DELETE"
                });
            } catch (error) {
                if (error && error.status === 404) {
                    return false;
                }
                throw error;
            }

            delete activeStore[id];
            return true;
        }

        const store = normalizeStore(readStore());
        if (!store[id]) {
            return false;
        }

        delete store[id];
        writeStore(store);
        setActiveStore(store);
        return true;
    }

    function getAvailableHymnNumbers(baseMap) {
        const savedNumbers = listSavedHymns().map((item) => item.number);
        const baseNumbers = baseMap ? Object.keys(baseMap) : [];
        return Array.from(new Set([...baseNumbers, ...savedNumbers]))
            .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    }

    setActiveStore(readStore());

    window.HymnStorage = {
        init,
        listSavedHymns,
        getSavedHymn,
        hasSavedHymn,
        saveHymn,
        deleteSavedHymn,
        getAvailableHymnNumbers,
        getMode: () => storageMode,
        getStorageLabel
    };
})();
