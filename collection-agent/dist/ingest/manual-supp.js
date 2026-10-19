/**
 * Ingest user-uploaded supplementary files into Stage 4 layout.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { packSupplementaryZip } from "../stage4/clients/doi-supp.js";
import { listAndScoreZip } from "../stage4/supp-scout.js";
import { stage4SuppDir } from "../utils/io.js";
import { registerManualSuppJob } from "./register-supp-job.js";
const TABULAR_EXT = new Set([".xlsx", ".xls", ".csv", ".tsv"]);
function safeZipName(filePath) {
    return basename(filePath).replace(/[\\/]/g, "_");
}
function walkFiles(dir) {
    const out = [];
    const stack = [dir];
    while (stack.length > 0) {
        const cur = stack.pop();
        for (const name of readdirSync(cur)) {
            const p = join(cur, name);
            if (statSync(p).isDirectory())
                stack.push(p);
            else
                out.push(p);
        }
    }
    return out;
}
function loadExistingZipFiles(zipPath) {
    if (!existsSync(zipPath))
        return [];
    const stamp = randomBytes(6).toString("hex");
    const destDir = join(tmpdir(), `qptm-supp-merge-${stamp}`);
    mkdirSync(destDir, { recursive: true });
    try {
        execFileSync("unzip", ["-o", "-q", zipPath, "-d", destDir], {
            maxBuffer: 40 * 1024 * 1024,
            stdio: ["ignore", "pipe", "pipe"],
        });
        return walkFiles(destDir).map((p) => ({
            filename: basename(p),
            buffer: readFileSync(p),
        }));
    }
    catch {
        return [];
    }
    finally {
        try {
            rmSync(destDir, { recursive: true, force: true });
        }
        catch {
            // ignore cleanup errors
        }
    }
}
function dedupeByFilename(files) {
    const byName = new Map();
    for (const f of files) {
        const key = f.filename.toLowerCase();
        byName.set(key, f);
    }
    return [...byName.values()];
}
function resolveInputPaths(options) {
    const paths = [...(options.filePaths ?? [])];
    if (options.filePath)
        paths.push(options.filePath);
    const seen = new Set();
    const out = [];
    for (const p of paths) {
        const t = (p || "").trim();
        if (!t || seen.has(t))
            continue;
        seen.add(t);
        out.push(t);
    }
    return out;
}
function fileToZipMembers(filePath) {
    const ext = extname(filePath).toLowerCase();
    if (ext === ".zip") {
        return loadExistingZipFiles(filePath);
    }
    if (TABULAR_EXT.has(ext)) {
        return [{ filename: safeZipName(filePath), buffer: readFileSync(filePath) }];
    }
    throw new Error(`Unsupported supplementary type: ${ext} (use .zip, .xlsx, .csv, .tsv)`);
}
export function ingestManualSupplementary(options) {
    const pmid = options.pmid.trim();
    if (!pmid)
        throw new Error("PMID is required");
    const inputPaths = resolveInputPaths(options);
    if (inputPaths.length === 0)
        throw new Error("At least one supplementary file path is required");
    for (const p of inputPaths) {
        if (!existsSync(p))
            throw new Error(`File not found: ${p}`);
    }
    const pmidDir = join(stage4SuppDir(), pmid);
    mkdirSync(pmidDir, { recursive: true });
    const localZip = join(pmidDir, "supplementary.zip");
    const listingPath = join(pmidDir, "listing.json");
    const merge = options.merge !== false;
    let members = [];
    if (merge)
        members.push(...loadExistingZipFiles(localZip));
    const onlyZip = inputPaths.length === 1 && extname(inputPaths[0]).toLowerCase() === ".zip";
    if (onlyZip && !merge && !existsSync(localZip)) {
        copyFileSync(inputPaths[0], localZip);
    }
    else {
        for (const p of inputPaths) {
            members.push(...fileToZipMembers(p));
        }
        members = dedupeByFilename(members);
        if (members.length === 0) {
            throw new Error("No tabular files found to pack into supplementary.zip");
        }
        packSupplementaryZip(localZip, members);
    }
    writeFileSync(join(pmidDir, "source_user_upload.txt"), "user_upload", "utf8");
    const zipHits = listAndScoreZip(localZip);
    writeFileSync(listingPath, JSON.stringify(zipHits, null, 2), "utf8");
    const sourceNames = inputPaths.map((p) => basename(p)).join("; ");
    registerManualSuppJob({
        pmid,
        zipHits,
        zipPath: localZip,
        sourceFile: sourceNames,
    });
    return {
        pmid,
        zipPath: localZip,
        listingPath,
        fileCount: zipHits.length,
    };
}
