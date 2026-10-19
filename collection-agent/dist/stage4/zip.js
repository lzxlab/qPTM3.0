/**
 * List / selectively extract entries from a ZIP using system `unzip` (available on macOS).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
function walkFind(dir, base) {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
            const hit = walkFind(p, base);
            if (hit)
                return hit;
        }
        else if (name === base) {
            return p;
        }
    }
    return null;
}
/** `unzip -l` listing (skips directories). */
export function listZipEntries(zipPath) {
    if (!existsSync(zipPath))
        return [];
    const out = execFileSync("unzip", ["-l", zipPath], {
        encoding: "utf8",
        maxBuffer: 20 * 1024 * 1024,
    });
    const entries = [];
    for (const line of out.split("\n")) {
        const m = line.match(/^\s*(\d+)\s+\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}\s+(.+)$/);
        if (!m)
            continue;
        const path = m[2].trim();
        if (!path || path.endsWith("/"))
            continue;
        entries.push({ path, size: Number(m[1]) || 0 });
    }
    return entries;
}
/** Extract one entry and return its bytes (capped). */
export function readZipEntry(zipPath, entryPath, maxBytes = 256_000) {
    const stamp = randomBytes(6).toString("hex");
    const destDir = join(tmpdir(), `qptm-supp-${stamp}`);
    mkdirSync(destDir, { recursive: true });
    try {
        execFileSync("unzip", ["-o", "-q", zipPath, entryPath, "-d", destDir], {
            maxBuffer: 20 * 1024 * 1024,
            stdio: ["ignore", "pipe", "pipe"],
        });
        let filePath = join(destDir, entryPath);
        if (!existsSync(filePath)) {
            const base = entryPath.split("/").pop();
            if (!base)
                return null;
            const found = walkFind(destDir, base);
            if (!found)
                return null;
            filePath = found;
        }
        const buf = readFileSync(filePath);
        return buf.length > maxBytes ? buf.subarray(0, maxBytes) : buf;
    }
    catch {
        return null;
    }
    finally {
        try {
            execFileSync("rm", ["-rf", destDir], { stdio: "ignore" });
        }
        catch {
            // ignore cleanup errors
        }
    }
}
export function writeBuffer(path, buffer) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, buffer);
}
