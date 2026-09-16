import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { cfg } from "../config.js";
export function loadSkill(name) {
    const path = join(cfg.skillsDir, name, "SKILL.md");
    if (!existsSync(path))
        return "";
    return readFileSync(path, "utf8").slice(0, 6000);
}
export function loadSkills(names) {
    const parts = [];
    for (const n of names) {
        const text = loadSkill(n);
        if (text)
            parts.push(`### Skill: ${n}\n${text}`);
    }
    return parts.join("\n\n");
}
export function listSkillNames() {
    if (!existsSync(cfg.skillsDir))
        return [];
    return readdirSync(cfg.skillsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
}
export function skillsForMode(mode, question) {
    if (mode === "compose")
        return ["answer-ptm"];
    const base = ["ptm-databases"];
    if (mode === "react") {
        base.unshift("biology-qa", "deep-research-ptm");
    }
    else if (mode === "qa")
        base.unshift("biology-qa");
    else
        base.unshift("deep-research-ptm");
    if (/kinase|激酶|磷酸化/i.test(question))
        base.push("kinase-substrate");
    if (/fold|定量|condition|倍数/i.test(question))
        base.push("quantitative-dynamics");
    if (/disease|疾病|cancer|功能/i.test(question))
        base.push("function-disease");
    return base;
}
