import { app, BrowserWindow, ipcMain, protocol, net, shell, dialog } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { autoUpdater } from "electron-updater";
import { HymnRepository, SetlistRepository } from "./main/db.js";
import {
    generateMediaFilename, cleanupOrphanMedia,
    listImageFolders, listImageFolderContents, syncImageFolder,
    ALLOWED_IMAGE_MIMES, MAX_UPLOAD_BYTES, IMAGE_EXT_FOR_MIME,
} from "./main/media.js";
import fs from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = __dirname;
const IS_PACKAGED = app.isPackaged;
const DATA_DIR = IS_PACKAGED
    ? path.join(process.resourcesPath, "data")
    : path.join(ROOT_DIR, "data");
const DB_PATH = path.join(DATA_DIR, "scoresentation.db");
const SETLIST_DB_PATH = path.join(DATA_DIR, "setlists.db");
const MEDIA_DIR = path.join(DATA_DIR, "media");
const IMAGES_DIR = path.join(DATA_DIR, "images");

// Ensure directories
fs.mkdirSync(MEDIA_DIR, { recursive: true });
fs.mkdirSync(IMAGES_DIR, { recursive: true });

let hymnRepo;
let setlistRepo;
let mainWindow;

// ── Custom protocol ──

function setupProtocol() {
    protocol.handle("app", (request) => {
        const url = new URL(request.url);
        let filePath;

        if (url.pathname.startsWith("/media/")) {
            const filename = decodeURIComponent(url.pathname.slice(7));
            filePath = path.join(MEDIA_DIR, filename);
        } else if (url.pathname.startsWith("/images/")) {
            const rest = decodeURIComponent(url.pathname.slice(8));
            filePath = path.join(IMAGES_DIR, rest);
        } else if (url.pathname.startsWith("/node_modules/")) {
            filePath = path.join(ROOT_DIR, decodeURIComponent(url.pathname));
        } else if (url.pathname.startsWith("/fonts/")) {
            filePath = path.join(ROOT_DIR, decodeURIComponent(url.pathname));
        } else {
            let p = decodeURIComponent(url.pathname);
            if (p === "/" || p === "") p = "/index.html";
            filePath = path.join(ROOT_DIR, "src", p);
        }

        return net.fetch("file:///" + filePath.replace(/\\/g, "/"));
    });
}

// ── Window management ──

function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        webPreferences: {
            preload: path.join(__dirname, "preload.cjs"),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    mainWindow.loadURL("app://./index.html");

    // Editor opens in new window via window.open
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith("app://")) {
            return {
                action: "allow",
                overrideBrowserWindowOptions: {
                    width: 1200,
                    height: 900,
                    webPreferences: {
                        preload: path.join(__dirname, "preload.cjs"),
                        contextIsolation: true,
                        nodeIntegration: false,
                    },
                },
            };
        }
        // External links open in system browser
        shell.openExternal(url);
        return { action: "deny" };
    });

    mainWindow.on("closed", () => { mainWindow = null; });
}

// ── IPC: Hymns ──

function registerHymnHandlers() {
    ipcMain.handle("hymns:list", () => {
        return { items: hymnRepo.listHymns() };
    });

    ipcMain.handle("hymns:get", (_event, number) => {
        const item = hymnRepo.getHymn(String(number));
        if (!item) return { error: "not found" };
        return { item };
    });

    ipcMain.handle("hymns:save", (_event, number, hymn) => {
        const [item, isNew] = hymnRepo.saveHymn(String(number), hymn);
        // Notify all windows
        for (const win of BrowserWindow.getAllWindows()) {
            win.webContents.send("hymn-saved", item.id || number);
        }
        return { item, isNew };
    });

    ipcMain.handle("hymns:delete", (_event, number) => {
        const deleted = hymnRepo.deleteHymn(String(number));
        return { deleted };
    });
}

// ── IPC: Setlists ──

function registerSetlistHandlers() {
    ipcMain.handle("setlists:list", () => {
        return { items: setlistRepo.listSetlists() };
    });

    ipcMain.handle("setlists:get", (_event, id) => {
        const item = setlistRepo.getSetlist(Number(id));
        if (!item) return { error: "not found" };
        return { item };
    });

    ipcMain.handle("setlists:create", (_event, data) => {
        const created = setlistRepo.createSetlist(
            data.name || "",
            Array.isArray(data.items) ? data.items : null,
            data.settings || null,
        );
        cleanupOrphanMediaSafe();
        return { item: created };
    });

    ipcMain.handle("setlists:update", (_event, id, data) => {
        const updated = setlistRepo.updateSetlist(
            Number(id),
            data.name !== undefined ? data.name : null,
            Array.isArray(data.items) ? data.items : null,
            data.settings !== undefined ? data.settings : null,
        );
        if (!updated) return { error: "not found" };
        cleanupOrphanMediaSafe();
        return { item: updated };
    });

    ipcMain.handle("setlists:delete", (_event, id) => {
        const deleted = setlistRepo.deleteSetlist(Number(id));
        return { deleted };
    });
}

// ── IPC: Media ──

function registerMediaHandlers() {
    ipcMain.handle("media:upload", (_event, arrayBuffer, filename, mime) => {
        if (!ALLOWED_IMAGE_MIMES.has(mime)) {
            return { error: `지원하지 않는 이미지 형식: ${mime}` };
        }
        const data = Buffer.from(arrayBuffer);
        if (data.length > MAX_UPLOAD_BYTES) {
            return { error: "파일 크기는 50MB까지 지원합니다." };
        }
        const savedFilename = generateMediaFilename(mime, filename);
        const target = path.join(MEDIA_DIR, savedFilename);
        fs.writeFileSync(target, data);
        const media = setlistRepo.registerMedia(savedFilename, mime, data.length);
        return { item: media };
    });

    ipcMain.handle("media:delete", (_event, id) => {
        const media = setlistRepo.deleteMedia(Number(id));
        if (!media) return { error: "not found" };
        const filePath = path.join(MEDIA_DIR, media.filename);
        try { fs.unlinkSync(filePath); } catch (_) { /* ignore */ }
        return { deleted: true };
    });
}

// ── IPC: Image Folders ──

function registerImageFolderHandlers() {
    ipcMain.handle("images-folders:list", () => {
        return { items: listImageFolders(IMAGES_DIR) };
    });

    ipcMain.handle("images-folders:get", (_event, name) => {
        const entries = listImageFolderContents(IMAGES_DIR, name);
        if (!entries) return { error: "not found" };
        return { folder: name, images: entries };
    });

    ipcMain.handle("images-folders:sync", (_event, params) => {
        return syncImageFolder(IMAGES_DIR, MEDIA_DIR, params);
    });
}

// ── Orphan cleanup ──

function cleanupOrphanMediaSafe() {
    try {
        const stats = cleanupOrphanMedia(setlistRepo, MEDIA_DIR);
        if (stats.files || stats.rows) {
            console.log(`[cleanup] pruned: ${stats.files} file(s), ${stats.rows} DB row(s).`);
        }
    } catch (err) {
        console.error("[cleanup] error:", err.message);
    }
}

// ── Auto updater ──

function setupAutoUpdater() {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on("update-available", (info) => {
        console.log(`[updater] Update available: ${info.version}`);
    });

    autoUpdater.on("update-downloaded", (info) => {
        dialog.showMessageBox(mainWindow, {
            type: "info",
            title: "업데이트 준비 완료",
            message: `새 버전 ${info.version}이(가) 다운로드되었습니다.\n지금 재시작하시겠습니까?`,
            buttons: ["재시작", "나중에"],
            defaultId: 0,
        }).then((result) => {
            if (result.response === 0) {
                autoUpdater.quitAndInstall();
            }
        });
    });

    autoUpdater.on("error", (err) => {
        console.error("[updater] error:", err.message);
    });

    autoUpdater.checkForUpdatesAndNotify();
}

// ── App lifecycle ──

app.whenReady().then(() => {
    setupProtocol();

    hymnRepo = new HymnRepository(DB_PATH);
    setlistRepo = new SetlistRepository(SETLIST_DB_PATH);

    registerHymnHandlers();
    registerSetlistHandlers();
    registerMediaHandlers();
    registerImageFolderHandlers();

    createMainWindow();

    if (IS_PACKAGED) {
        setupAutoUpdater();
    }
});

app.on("window-all-closed", () => {
    cleanupOrphanMediaSafe();
    app.quit();
});

app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
    }
});
