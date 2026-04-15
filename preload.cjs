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
});
