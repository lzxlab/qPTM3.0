import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { cfg } from "../config.js";
const ALWAYS = ["biology-qa", "ptm-databases"];
export function loadSkill(name) {
    const path = join(cfg.skillsDir, name, "SKILL.md");
    if (!existsSync(path))
        return "";
    return readFileSync(path, "utf8").slice(0, 6000);
}
export function loadSkills(names = ALWAYS) {
    const parts = [];
    for (const n of names) {
        const text = loadSkill(n);
        if (text)
            parts.push(`### Skill: ${n}\n${text}`);
    }
    return parts.join("\n\n");
}
