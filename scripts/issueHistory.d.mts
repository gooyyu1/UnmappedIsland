export interface IssueHistory {
  readonly measuredDay: string;
  readonly createdByDay: ReadonlyMap<string, number>;
}

export const ISSUE_HISTORY_FILE: URL;
export function formatIssueHistory(createdByDay: ReadonlyMap<string, number>, measuredDay: string): string;
export function parseIssueHistory(text: string): IssueHistory;
export function readIssueHistory(): IssueHistory;
export interface IssueCount {
  readonly count: number;
  readonly measured: boolean;
}

export function issueCountAt(history: IssueHistory, day: string): IssueCount;
export function formatIssueCount(counted: IssueCount): string;
