export interface SkillLockEntry {
  source: string;
  sourceUrl?: string | undefined;
  ref?: string | undefined;
  sourceType: "github" | "git" | "local" | string;
  skillPath?: string | undefined;
  computedHash: string;
}

export interface SkillLock {
  version: number;
  skills: Record<string, SkillLockEntry>;
}

export interface ResolvedSource {
  original: string;
  cloneUrl: string;
  source: string;
  sourceType: "github" | "git" | "local";
  ref?: string | undefined;
  subpath?: string | undefined;
}

export interface PendingMerge {
  version: 1;
  skill: string;
  entry: SkillLockEntry;
  conflicts: string[];
}
