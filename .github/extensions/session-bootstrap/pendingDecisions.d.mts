export const DECISIONS_THRESHOLD: number;

/** `<repoDir>/agent-ops/decisions/` 直下の、未処理の履歴の件数。置き場が無ければ 0。 */
export function countPendingDecisions(repoDir: string): Promise<number>;
