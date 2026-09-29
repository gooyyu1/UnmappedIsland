// 盤面の形は [`board-move.mjs`](board-move.mjs) の冒頭が持つ。ここで写すと定義が2つになるので、
// 受け口は `unknown` のままにする。
export function moves(board: unknown): string[];

/** 今その差分へ手が動いているか（`agent-ops/board-design.md` 1.6節）。 */
export function busySession(session: { status: string }): boolean;

/** 盤面を見回る係の名（`agent-ops/board-design.md` 2.21節）。間隔を引く側が綴りをここから取る。 */
export const PATROL: string;

/** PRの頭が動いたときに落ちる結論の札。剥がす手を打つ側が綴りをここから取る。 */
export const STALE_ON_PUSH: readonly string[];

/** PRを人の手番へ移す印（`agent-ops/board-design.md` 2.13.8節）。人へ見せる側が綴りをここから取る。 */
export const HUMAN_TURN: readonly string[];

/** 周期の係を前に立ててから空ける間隔（時間）。知らない名前には `undefined`。 */
export function cycleHours(name: string): number | undefined;

/** 未整理（棚卸しの結論が揃っていない issue。`agent-ops/board-design.md` 2.17.1節）。 */
export function unsorted(issue: { labels?: { name: string }[] }): boolean;

/** 実在するセッションIDの形（`agent-ops/board-design.md` 2.11.3節）。CIの `名乗り` と揃っている。 */
export const SESSION_ID: RegExp;

/** 宛先を引けない名乗りの形と、それぞれ人がすること（`agent-ops/board-design.md` 2.11.4節）。 */
export const STRANDS: Readonly<Record<string, { why: string; fix: string }>>;

/**
 * 差し戻す理由と、そこから決まるもの（`agent-ops/board-design.md` 2.13.6節）。人へ返す文面を書く側が
 * `why` をここから取る。
 */
export const MENDS: Readonly<Record<string, { kind: string; why: string }>>;

/**
 * 頼み終えた差し戻しを人へ返すときに、人がすること（`agent-ops/board-design.md` 2.13.6節）。鍵は
 * `MENDS` の `kind`。
 */
export const TAKEOVER: Readonly<Record<string, string>>;

/** そのPRの宛先を引けない形（引けるなら `undefined`）。 */
export function strandOf(
  pr: { number: number },
  prSessions: Readonly<Record<string, string>>,
  sessions: readonly { id: string }[],
): { kind: string; id: string | undefined } | undefined;

/**
 * 開いているPRのうち、差し戻す相手を引けないもの。**名乗りを引けなかった周（`undefined`）は
 * 1件も返さない**——空の対応表と混ぜると、健全なPRが全部宛先を失ったように見える。
 */
export function strandedPrs<Pr extends { number: number }>(
  prs: readonly Pr[],
  prSessions: Readonly<Record<string, string>> | undefined,
  sessions: readonly { id: string }[],
): { pr: Pr; kind: string; id: string | undefined }[];
