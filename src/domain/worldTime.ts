/**
 * 世界の暦と刻み。**`src/assets/world-codex/core.yaml` の `world` が宣言している `hour`・`minute` の
 * range と `minutes_per_tick`** と同じものを、実体化された世界を持たずに読める形で持つ。
 *
 * 時計の表示も、航海にかかる日数の見積もりも、収支の表も、ここの値を使う——別々に持つと、世界の
 * 暦を変えたときに片方だけが古い長さのまま残る。
 *
 * 宣言との一致は `tests/world-codex/coreYaml.test.ts` が見る（rangeと宣言された値から数え直して
 * 突き合わせる）。
 *
 * **ここの値を字で書いた文章——tickの数を人に読める長さへ言い換えた記述——の書き方は
 * [`docs/DocumentStyle.md`](../../docs/DocumentStyle.md) 11節が持つ**（`tests/docs/tickReadings.test.ts`
 * が、並べた数をここから計算し直して照合する）。
 */

export const HOURS_PER_DAY = 24;
export const MINUTES_PER_HOUR = 60;
export const MINUTES_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR;

/** 1tickに相当するゲーム内時間（分）。ゲーム側（WorldSession）は実行時にworldの値を読む。 */
export const MINUTES_PER_TICK = 15;

/** 1日に回るtickの数。暦と刻みの両方から決まるので、どちらを変えてもここは付いてくる。 */
export const TICKS_PER_DAY = MINUTES_PER_DAY / MINUTES_PER_TICK;
