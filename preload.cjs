const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
    // Hymns
    listHymns: () => ipcRenderer.invoke("hymns:list"),
    getHymn: (number) => ipcRenderer.invoke("hymns:get", number),
    saveHymn: (number, hymn) => ipcRenderer.invoke("hymns:save", number, hymn),
    deleteHymn: (number) => ipcRenderer.invoke("hymns:delete", number),

    // Setlists
    listSetlists: () => ipcRenderer.invoke("setlists:list"),
    getSetlist: (id) => ipcRenderer.invoke("setlists:get", id),
    createSetlist: (data) => ipcRenderer.invoke("setlists:create", data),
    updateSetlist: (id, data) => ipcRenderer.invoke("setlists:update", id, data),
    deleteSetlist: (id) => ipcRenderer.invoke("setlists:delete", id),
    exportSetlist: (id) => ipcRenderer.invoke("setlists:export", id),
    importSetlist: () => ipcRenderer.invoke("setlists:import"),

    // Media
    uploadMedia: (arrayBuffer, filename, mime) => ipcRenderer.invoke("media:upload", arrayBuffer, filename, mime),
    deleteMedia: (id) => ipcRenderer.invoke("media:delete", id),

    // Image folders
    listImageFolders: () => ipcRenderer.invoke("images-folders:list"),
    getImageFolder: (name) => ipcRenderer.invoke("images-folders:get", name),
    syncImageFolder: (params) => ipcRenderer.invoke("images-folders:sync", params),

    // Cross-window events
    onHymnSaved: (callback) => {
        ipcRenderer.on("hymn-saved", (_event, songId) => callback(songId));
    },

    // Unsaved-changes tracking (per window)
    setDirty: (value) => ipcRenderer.send("app:set-dirty", !!value),

    // Auto-update events (main window only)
    onUpdateDownloadStarted: (cb) => ipcRenderer.on("update:download-started", (_e, d) => cb(d)),
    onUpdateDownloadProgress: (cb) => ipcRenderer.on("update:download-progress", (_e, d) => cb(d)),
    onUpdateDownloaded: (cb) => ipcRenderer.on("update:downloaded", (_e, d) => cb(d)),
    onUpdateDownloadError: (cb) => ipcRenderer.on("update:download-error", (_e, d) => cb(d)),
    onUpdateInstalling: (cb) => ipcRenderer.on("update:installing", (_e, d) => cb(d)),
});
