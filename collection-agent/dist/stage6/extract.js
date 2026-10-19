import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { projectRoot } from "../utils/io.js";
const __dirname = dirname(fileURLToPath(import.meta.url));
export function resolveGetUrlDir(custom) {
    if (custom)
        return resolve(custom);
    const env = process.env.QPTM3_GET_URL_DIR?.trim();
    if (env)
        return resolve(env);
    return resolve(projectRoot(), "scripts");
}
export function resolveGetUrlScripts(customDir) {
    const dir = resolveGetUrlDir(customDir);
    const scripts = {
        prideHtml: join(dir, "1_html_pride_extract.py"),
        iproxXml: join(dir, "2_xml_iprox_extract.py"),
        jpostHtml: join(dir, "3_html_jpost_extract.py"),
        pdcExtract: join(dir, "4_PDC_CPTAC_extract.py"),
    };
    for (const [name, path] of Object.entries(scripts)) {
        if (!existsSync(path)) {
            throw new Error(`Missing get_url script (${name}): ${path}`);
        }
    }
    return scripts;
}
function findUrlsOutput(workDir, stem) {
    const prefix = `${stem}_urls_`;
    const matches = readdirSync(workDir)
        .filter((f) => f.startsWith(prefix) && f.endsWith(".txt"))
        .map((f) => join(workDir, f));
    if (matches.length === 0)
        return undefined;
    matches.sort((a, b) => basename(b).localeCompare(basename(a)));
    return matches[0];
}
function readUrlLines(path) {
    if (!existsSync(path))
        return [];
    return readFileSync(path, "utf8")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
}
export function countRawUrls(urls) {
    return urls.filter((u) => /\.raw(?:\?|$)/i.test(u)).length;
}
export function runPrideExtract(htmlPath, scripts, workDir) {
    execFileSync("python3", [scripts.prideHtml, htmlPath], {
        cwd: workDir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    });
    const stem = basename(htmlPath).replace(/\.html?$/i, "");
    const urlsFile = findUrlsOutput(workDir, stem);
    if (!urlsFile)
        throw new Error(`PRIDE extract produced no urls file for ${htmlPath}`);
    const urls = readUrlLines(urlsFile);
    return { urlsFile, urls, rawUrlCount: countRawUrls(urls) };
}
export function runIproxExtract(xmlPath, scripts) {
    execFileSync("python3", [scripts.iproxXml, xmlPath], {
        cwd: dirname(xmlPath),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    });
    const stem = basename(xmlPath).replace(/\.xml$/i, "");
    const urlsFile = findUrlsOutput(dirname(xmlPath), stem);
    if (!urlsFile)
        throw new Error(`iProX extract produced no urls file for ${xmlPath}`);
    const urls = readUrlLines(urlsFile);
    return { urlsFile, urls, rawUrlCount: countRawUrls(urls) };
}
export function runJpostExtract(htmlPath, scripts) {
    execFileSync("python3", [scripts.jpostHtml, htmlPath], {
        cwd: dirname(htmlPath),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    });
    const stem = basename(htmlPath).replace(/\.html?$/i, "");
    const urlsFile = findUrlsOutput(dirname(htmlPath), stem);
    if (!urlsFile)
        throw new Error(`jPOST extract produced no urls file for ${htmlPath}`);
    const urls = readUrlLines(urlsFile);
    return { urlsFile, urls, rawUrlCount: countRawUrls(urls) };
}
export function runPdcExtract(pdcId, scripts) {
    const stdout = execFileSync("python3", [scripts.pdcExtract, pdcId], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    });
    const urls = stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => /^https?:\/\//i.test(l));
    const urlsFile = join(process.cwd(), `${pdcId}_urls_${urls.length}.txt`);
    writeFileSync(urlsFile, urls.join("\n") + (urls.length ? "\n" : ""), "utf8");
    return { urlsFile, urls, rawUrlCount: countRawUrls(urls) };
}
