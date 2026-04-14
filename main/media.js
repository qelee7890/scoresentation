import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const ALLOWED_IMAGE_MIMES = new Set([
    "image/jpeg", "image/png", "image/gif", "image/webp",
    "image/bmp", "image/svg+xml", "image/heic", "image/heif",
]);
export const IMAGE_EXT_FOR_MIME = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/bmp": ".bmp",
    "image/svg+xml": ".svg",
    "image/heic": ".heic",
    "image/heif": ".heif",
};

function isSafeFolderName(name) {
    if (!name) return false;
    const s = name.trim();
    if (!s || s === "." || s === "..") return false;
    return !s.includes("/") && !s.includes("\\") && !s.includes("\0");
}

function naturalKey(name) {
    return name.split(/(\d+)/).map((s) => /^\d+$/.test(s) ? Number(s) : s.toLowerCase());
}

function naturalCompare(a, b) {
    const ka = naturalKey(a);
    const kb = naturalKey(b);
    for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
        const va = ka[i] ?? "";
        const vb = kb[i] ?? "";
        if (typeof va === "number" && typeof vb === "number") {
            if (va !== vb) return va - vb;
        } else {
            const sa = String(va);
            const sb = String(vb);
            if (sa !== sb) return sa < sb ? -1 : 1;
        }
    }
    return 0;
}

export function generateMediaFilename(mime, originalName) {
    let ext = "";
    if (originalName) {
        const suffix = path.extname(originalName).toLowerCase();
        if (suffix && suffix.length <= 6) ext = suffix;
    }
    if (!ext) ext = IMAGE_EXT_FOR_MIME[mime] || ".bin";
    const token = randomUUID().replace(/-/g, "").slice(0, 12);
    return `${token}${ext}`;
}

export function listImageFolders(imagesDir) {
    if (!fs.existsSync(imagesDir)) return [];
    const entries = fs.readdirSync(imagesDir, { withFileTypes: true });
    return entries
        .filter((e) => e.isDirectory() && !e.name.startsWith("."))
        .sort((a, b) => naturalCompare(a.name, b.name))
        .map((e) => {
            const files = fs.readdirSync(path.join(imagesDir, e.name))
                .filter((f) => !f.startsWith(".") && fs.statSync(path.join(imagesDir, e.name, f)).isFile());
            return { name: e.name, count: files.length };
        });
}

export function listImageFolderContents(imagesDir, name) {
    const folder = path.join(imagesDir, name);
    if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) return null;

    const files = fs.readdirSync(folder)
        .filter((f) => !f.startsWith(".") && fs.statSync(path.join(folder, f)).isFile())
        .sort(naturalCompare);

    return files.map((f) => {
        let version = 0;
        try { version = Math.floor(fs.statSync(path.join(folder, f)).mtimeMs / 1000); } catch (_) { /* ignore */ }
        return {
            filename: f,
            url: `/images/${encodeURIComponent(name)}/${encodeURIComponent(f)}?v=${version}`,
        };
    });
}

function resolveUrlToPath(url, mediaDir, imagesDir) {
    if (!url) return null;
    try {
        const parsed = new URL(url, "http://localhost");
        const p = decodeURIComponent(parsed.pathname);
        if (p.startsWith("/media/")) {
            const name = p.slice(7);
            if (name.includes("/") || name.includes("\\") || name.includes("..")) return null;
            const candidate = path.join(mediaDir, name);
            return fs.existsSync(candidate) ? candidate : null;
        }
        if (p.startsWith("/images/")) {
            const rest = p.slice(8).replace(/^\/+|\/+$/g, "");
            const parts = rest.split("/");
            if (parts.length !== 2) return null;
            if (!isSafeFolderName(parts[0])) return null;
            const candidate = path.join(imagesDir, parts[0], parts[1]);
            return fs.existsSync(candidate) ? candidate : null;
        }
    } catch (_) { /* ignore */ }
    return null;
}

export function syncImageFolder(imagesDir, mediaDir, params) {
    const folderName = (params.folderName || "").trim();
    const previousName = (params.previousName || "").trim();
    const overwrite = !!params.overwrite;
    const images = Array.isArray(params.images) ? params.images : null;

    if (!isSafeFolderName(folderName)) return { error: "폴더 이름이 올바르지 않습니다." };
    if (previousName && !isSafeFolderName(previousName)) return { error: "기존 폴더 이름이 올바르지 않습니다." };
    if (!images || images.length === 0) return { error: "이미지 목록이 비어 있습니다." };

    fs.mkdirSync(imagesDir, { recursive: true });
    const target = path.join(imagesDir, folderName);
    const previous = previousName ? path.join(imagesDir, previousName) : null;

    const inPlace = previous && path.basename(previous) === folderName;
    if (!inPlace && fs.existsSync(target) && !overwrite) {
        return { error: "같은 이름의 폴더가 이미 존재합니다.", conflict: true, folder: folderName };
    }

    // Resolve source paths
    const sources = [];
    for (const img of images) {
        const url = (img && img.url) || "";
        const src = resolveUrlToPath(url, mediaDir, imagesDir);
        if (!src) return { error: `원본 파일을 찾지 못했습니다: ${url}` };
        sources.push(src);
    }

    const tempDir = path.join(imagesDir, `.sync_${randomUUID().replace(/-/g, "")}`);
    try {
        fs.mkdirSync(tempDir, { recursive: true });
        for (let i = 0; i < sources.length; i++) {
            const ext = path.extname(sources[i]) || ".jpg";
            fs.copyFileSync(sources[i], path.join(tempDir, `${i + 1}${ext}`));
        }
        if (previous && fs.existsSync(previous) && path.resolve(previous) !== path.resolve(target)) {
            fs.rmSync(previous, { recursive: true, force: true });
        }
        if (fs.existsSync(target)) {
            fs.rmSync(target, { recursive: true, force: true });
        }
        fs.renameSync(tempDir, target);
    } catch (err) {
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
        return { error: `폴더 동기화 실패: ${err.message}` };
    }

    const entries = listImageFolderContents(imagesDir, folderName) || [];
    return { folder: folderName, images: entries };
}

export function cleanupOrphanMedia(setlistRepo, mediaDir) {
    const referenced = new Set();
    const pattern = /\/media\/([^"/?#\s]+)/g;
    for (const blob of setlistRepo.iterSetlistPayloadJson()) {
        let match;
        while ((match = pattern.exec(blob)) !== null) {
            referenced.add(decodeURIComponent(match[1]));
        }
        pattern.lastIndex = 0;
    }

    let removedFiles = 0;
    let removedRows = 0;

    if (fs.existsSync(mediaDir)) {
        for (const entry of fs.readdirSync(mediaDir)) {
            if (entry.startsWith(".")) continue;
            const full = path.join(mediaDir, entry);
            if (!fs.statSync(full).isFile()) continue;
            if (referenced.has(entry)) continue;
            try { fs.unlinkSync(full); removedFiles++; } catch (_) { /* ignore */ }
        }
    }

    const orphanRows = [];
    for (const media of setlistRepo.listMedia()) {
        if (!referenced.has(media.filename)) orphanRows.push(media.filename);
    }
    if (orphanRows.length) removedRows = setlistRepo.deleteMediaRowsByFilenames(orphanRows);

    return { files: removedFiles, rows: removedRows, referenced: referenced.size };
}
