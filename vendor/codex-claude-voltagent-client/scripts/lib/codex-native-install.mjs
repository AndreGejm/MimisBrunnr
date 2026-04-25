import { existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const defaultSkillInstallName = "voltagent-default";

export function createNativeSkillInstallLayout(options = {}) {
  const homeRoot = resolve(options.homeRoot ?? homedir());
  const sourcePath = resolve(options.sourcePath);
  const skillsRoot = join(homeRoot, ".codex", "skills");
  const targetPath = join(
    skillsRoot,
    options.installName ?? defaultSkillInstallName
  );

  return {
    homeRoot,
    skillsRoot,
    sourcePath,
    targetPath
  };
}

export function installNativeCodexSkills(layout) {
  mkdirSync(layout.skillsRoot, { recursive: true });
  rmSync(layout.targetPath, { recursive: true, force: true });
  symlinkSync(
    layout.sourcePath,
    layout.targetPath,
    process.platform === "win32" ? "junction" : "dir"
  );
}

export function nativeCodexInstallPath(homeRoot = homedir()) {
  return join(resolve(homeRoot), ".codex", "skills", defaultSkillInstallName);
}

export function hasNativeCodexInstall(homeRoot = homedir()) {
  return existsSync(nativeCodexInstallPath(homeRoot));
}
