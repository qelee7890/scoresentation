(function () {
    const API_BASE = "/api/setlists";
    const MEDIA_API = "/api/media";

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
            const result = await request("GET", API_BASE);
            return Array.isArray(result.items) ? result.items : [];
        },

        async get(id) {
            const result = await request("GET", `${API_BASE}/${encodeURIComponent(id)}`);
            return result.item || null;
        },

        async create({ name, items, settings }) {
            const result = await request("POST", API_BASE, {
                name: name || "",
                items: items || [],
                settings: settings || {}
            });
            return result.item;
        },

        async update(id, { name, items, settings }) {
            const body = {};
            if (name !== undefined) body.name = name;
            if (items !== undefined) body.items = items;
            if (settings !== undefined) body.settings = settings;
            const result = await request("PUT", `${API_BASE}/${encodeURIComponent(id)}`, body);
            return result.item;
        },

        async remove(id) {
            return request("DELETE", `${API_BASE}/${encodeURIComponent(id)}`);
        },

        async uploadImage(file) {
            if (!file) throw new Error("파일이 없습니다.");
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
            return request("DELETE", `${MEDIA_API}/${encodeURIComponent(mediaId)}`);
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
