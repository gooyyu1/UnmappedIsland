import type { Rng } from '../domain/Rng';
import { parseSeed, randomSeed } from '../save/newGameInput';

/**
 * 起動URLで固定された島の種（`?seed=`）。指定が無ければundefined。
 *
 * 開始状態は種だけで決まる（SaveDataManagement.md「新規ゲーム作成時の入力とランダム生成」）ので、
 * これを固定できると同じ島を何度でも作れる——変更前と変更後のスクリーンショットを同じ盤面で
 * 撮って並べられるようになる。
 */
let launchSeed: number | undefined;

/**
 * クエリ文字列から島の種を読む。値の解釈は入力欄と同じで（parseSeed）、数字以外・値域外は
 * 「指定なし」として捨てる——URLの打ち間違いで起動できなくなるより、いつもどおり始まるほうがよい。
 */
export function parseLaunchSeed(search: string): number | undefined {
  const value = new URLSearchParams(search).get('seed');
  return value === null ? undefined : parseSeed(value);
}

/** 起動時に読んだ種を入れる（src/main.ts）。 */
export function setLaunchSeed(seed: number | undefined): void {
  launchSeed = seed;
}

/** 新規ゲーム作成画面に最初から入れる種。URLで固定されていればそれ、無ければ毎回違う値。 */
export function initialSeed(rng: Rng): number {
  return launchSeed ?? randomSeed(rng);
}
