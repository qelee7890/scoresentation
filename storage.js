(function () {
    const STORAGE_KEY = "scoresentation.saved_hymns.v1";
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

    function listSavedHymns() {
        const store = readStore();
        return Object.keys(store)
            .map((number) => {
                const entry = store[number];
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
        const store = readStore();
        const entry = store[id];
        if (!entry || !entry.hymn) {
            return null;
        }

        const normalized = normalizeHymnRecord(entry.hymn);
        if (!normalized) {
            return null;
        }

        if (!entry.hymn.pitchLabelVersion || entry.hymn.pitchLabelVersion !== normalized.pitchLabelVersion) {
            store[id] = {
                ...entry,
                hymn: deepClone(normalized)
            };
            writeStore(store);
        }

        return normalized;
    }

    function hasSavedHymn(number) {
        return !!getSavedHymn(number);
    }

    function saveHymn(hymn) {
        const normalized = normalizeHymnRecord(hymn);
        if (!normalized) {
            throw new Error("Invalid hymn payload");
        }

        const store = readStore();
        store[normalized.number] = {
            hymn: normalized,
            updatedAt: new Date().toISOString()
        };
        writeStore(store);
        return normalized.number;
    }

    function deleteSavedHymn(number) {
        const id = String(number || "");
        const store = readStore();
        if (!store[id]) {
            return false;
        }

        delete store[id];
        writeStore(store);
        return true;
    }

    function getAvailableHymnNumbers(baseMap) {
        const savedNumbers = listSavedHymns().map((item) => item.number);
        const baseNumbers = baseMap ? Object.keys(baseMap) : [];
        return Array.from(new Set([...baseNumbers, ...savedNumbers]))
            .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    }

    window.HymnStorage = {
        listSavedHymns,
        getSavedHymn,
        hasSavedHymn,
        saveHymn,
        deleteSavedHymn,
        getAvailableHymnNumbers
    };
})();
