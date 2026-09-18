export function isPathTarget(target: string): boolean;
export function linksIn(markdown: string): { file: string; anchor: string | null }[];
export function pathTargetsIn(markdown: string): string[];
export function linksRebasedToRepoRoot(markdown: string, dirFromRepoRoot: string): string;
