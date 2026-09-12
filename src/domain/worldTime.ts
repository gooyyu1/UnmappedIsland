/**
 * 世界の暦。**`src/assets/world-codex/core.yaml` の `world` が宣言している `hour`・`minute` の range**
 * （0-24時・0-60分）と同じものを、実体化された世界を持たずに読める形で持つ。
 */
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;

/**
 * 1日の長さ（分）。**時計の表示も、航海にかかる日数の見積もりも、収支の表も同じ長さを使う**
 * ——別々に持つと、世界の1日を変えたときに片方だけが古い長さのまま残る。
 *
 * 宣言との一致は `tests/world-codex/coreYaml.test.ts` が見る（`hour`・`minute` の range から
 * 数え直して突き合わせる）。
 */
export const MINUTES_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR;
