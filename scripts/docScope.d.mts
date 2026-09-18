export function trackedFiles(root: string, pathspec?: string): string[];
export function trackedDocs(root: string): string[];
export const COMMENTED_EXTENSIONS: readonly string[];
export function trackedRefSources(root: string): string[];
export function isVerbatimRecord(rel: string): boolean;
export function isAnalysisRecord(rel: string): boolean;
export function isMarkRuleDoc(rel: string): boolean;
