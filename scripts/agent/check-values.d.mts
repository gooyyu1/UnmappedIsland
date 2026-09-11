/** 見回った値1つ。意味は [`check-values.mjs`](check-values.mjs) の冒頭が持つ。 */
export interface CheckedValue {
  readonly key: string;
  /** 告げる本文に出る綴り。 */
  readonly label: string;
  /** `unknown` は「確かめられなかった」——死でも生でもない。 */
  readonly state: 'alive' | 'dead' | 'unknown';
  /** 死んでいるときに見える形。 */
  readonly seen: string;
  readonly remedy: string;
}

/** 外を触る手。省いたものは本物が入る。 */
export interface SurveyValuesDeps {
  call?: (tool: string, args?: Record<string, unknown>) => Promise<string>;
  gh?: (args: readonly string[], options?: { allowFail?: boolean }) => string | undefined;
  envs?: () => readonly { readonly name: string; readonly id: string }[];
}

export interface CheckValuesDeps extends SurveyValuesDeps {
  /** 台帳の置き場。省くと [`board-state.mjs`](board-state.mjs) の既定。 */
  stateDir?: string;
  now?: Date;
  /** 死んだまま、これだけ経ってから告げる（時間）。 */
  grace?: number;
  dryRun?: boolean;
  say?: (line: string) => void;
}

/** 告げ先の題。**2本目を作らない鍵はこれだけ。** */
export const TITLE: string;

export function surveyValues(deps?: SurveyValuesDeps): Promise<CheckedValue[]>;

export function checkValues(deps?: CheckValuesDeps): Promise<boolean>;
