(function () {
    const API_BASE = "/api/setlists";
    const MEDIA_API = "/api/media";
    const FOLDERS_API = "/api/images-folders";

    function useElectronAPI() {
        return !!(window.electronAPI && window.electronAPI.listSetlists);
    }

    async function request(method, url, body) {
        const options = { method };
        if (body !== undefined) {
            options.headers = { "Content-Type": "application/json" };
            options.body = JSON.stringify(body);
        }
        const response = await fetch(url, options);
        const text = await response.text();
        let payload = null;
        if (text) {
            try { payload = JSON.parse(text); } catch (_) { payload = { error: text }; }
        }
        if (!response.ok) {
            const message = (payload && payload.error) || `HTTP ${response.status}`;
            const error = new Error(message);
            error.status = response.status;
            throw error;
        }
        return payload || {};
    }

    const SetlistStorage = {
        async list() {
            if (useElectronAPI()) {
                const result = await window.electronAPI.listSetlists();
                return Array.isArray(result.items) ? result.items : [];
            }
            const result = await request("GET", API_BASE);
            return Array.isArray(result.items) ? result.items : [];
        },

        async get(id) {
            if (useElectronAPI()) {
                const result = await window.electronAPI.getSetlist(id);
                return result.item || null;
            }
            const result = await request("GET", `${API_BASE}/${encodeURIComponent(id)}`);
            return result.item || null;
        },

        async create({ name, items, settings }) {
            if (useElectronAPI()) {
                const result = await window.electronAPI.createSetlist({ name: name || "", items: items || [], settings: settings || {} });
                return result.item;
            }
            const result = await request("POST", API_BASE, { name: name || "", items: items || [], settings: settings || {} });
            return result.item;
        },

        async update(id, { name, items, settings }) {
            const body = {};
            if (name !== undefined) body.name = name;
            if (items !== undefined) body.items = items;
            if (settings !== undefined) body.settings = settings;
            if (useElectronAPI()) {
                const result = await window.electronAPI.updateSetlist(id, body);
                return result.item;
            }
            const result = await request("PUT", `${API_BASE}/${encodeURIComponent(id)}`, body);
            return result.item;
        },

        async remove(id) {
            if (useElectronAPI()) {
                return window.electronAPI.deleteSetlist(id);
            }
            return request("DELETE", `${API_BASE}/${encodeURIComponent(id)}`);
        },

        async exportSetlist(id) {
            if (useElectronAPI()) {
                return window.electronAPI.exportSetlist(id);
            }
            throw new Error("내보내기는 데스크톱 앱에서만 지원됩니다.");
        },

        async importSetlist() {
            if (useElectronAPI()) {
                return window.electronAPI.importSetlist();
            }
            throw new Error("들여오기는 데스크톱 앱에서만 지원됩니다.");
        },

        async uploadImage(file) {
            if (!file) throw new Error("파일이 없습니다.");
            if (useElectronAPI()) {
                const buffer = await file.arrayBuffer();
                const result = await window.electronAPI.uploadMedia(buffer, file.name, file.type);
                if (result.error) throw new Error(result.error);
                return result.item;
            }
            const form = new FormData();
            form.append("file", file);
            const response = await fetch(MEDIA_API, { method: "POST", body: form });
            const text = await response.text();
            let payload = null;
            if (text) {
                try { payload = JSON.parse(text); } catch (_) { payload = { error: text }; }
            }
            if (!response.ok) {
                const message = (payload && payload.error) || `HTTP ${response.status}`;
                throw new Error(message);
            }
            return payload.item;
        },

        async deleteMedia(mediaId) {
            if (useElectronAPI()) {
                return window.electronAPI.deleteMedia(mediaId);
            }
            return request("DELETE", `${MEDIA_API}/${encodeURIComponent(mediaId)}`);
        },

        async listImageFolders() {
            if (useElectronAPI()) {
                const result = await window.electronAPI.listImageFolders();
                return Array.isArray(result.items) ? result.items : [];
            }
            const result = await request("GET", FOLDERS_API);
            return Array.isArray(result.items) ? result.items : [];
        },

        async getImageFolder(name) {
            if (useElectronAPI()) {
                const result = await window.electronAPI.getImageFolder(name);
                return { folder: result.folder, images: Array.isArray(result.images) ? result.images : [] };
            }
            const result = await request("GET", `${FOLDERS_API}/${encodeURIComponent(name)}`);
            return { folder: result.folder, images: Array.isArray(result.images) ? result.images : [] };
        },

        async syncImageFolder({ folderName, previousName, overwrite, images }) {
            if (useElectronAPI()) {
                const result = await window.electronAPI.syncImageFolder({
                    folderName: folderName || "", previousName: previousName || "",
                    overwrite: !!overwrite, images: images || []
                });
                if (result.error) {
                    const error = new Error(result.error);
                    error.conflict = !!result.conflict;
                    error.folder = result.folder;
                    throw error;
                }
                return result;
            }
            const response = await fetch(`${FOLDERS_API}/sync`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    folderName: folderName || "", previousName: previousName || "",
                    overwrite: !!overwrite, images: images || []
                })
            });
            const text = await response.text();
            let payload = null;
            if (text) { try { payload = JSON.parse(text); } catch (_) { payload = { error: text }; } }
            if (!response.ok) {
                const error = new Error((payload && payload.error) || `HTTP ${response.status}`);
                error.status = response.status;
                error.conflict = !!(payload && payload.conflict);
                error.folder = payload && payload.folder;
                throw error;
            }
            return payload || {};
        },

        mediaUrl(filenameOrItem) {
            if (!filenameOrItem) return "";
            if (typeof filenameOrItem === "string") return `/media/${encodeURIComponent(filenameOrItem)}`;
            if (filenameOrItem.url) return filenameOrItem.url;
            if (filenameOrItem.filename) return `/media/${encodeURIComponent(filenameOrItem.filename)}`;
            return "";
        }
    };

    window.SetlistStorage = SetlistStorage;
})();
