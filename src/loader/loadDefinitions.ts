import type { AssetPack } from '../asset-pack/AssetPack';
import type { WorldCodex } from '../domain/WorldCodex';
import type { Localization } from '../locale/Localization';
import { loadLocalization } from '../locale/Localization';
import type { LoadReport } from './LoadReport';
import { loadWorldCodex, WORLD_CODEX_TEXTS } from './loadWorldCodex';

/** 読み込めた定義一式。 */
export interface Definitions {
  readonly codex: WorldCodex;
  readonly localization: Localization;
  /** 実際に読んだ定義YAMLのファイル名（外したパックのぶんは入らない）。 */
  readonly files: readonly string[];
}

/**
 * 同梱ぶんとアセットパックから定義一式を読む（AssetPack.md 6.1節）。
 *
 * **パックが読めなければ、そのパックだけを外して組み直す。** 定義の一部だけを生かすと参照切れが
 * 残り、壊れ方が原因から遠い場所に出る。パック単位で外せば、結果は必ず「同梱ぶん＋無事なパック」
 * という、それ自体で筋の通った世界になる。
 *
 * 同梱ぶんの誤りは今までどおり投げる。ゲーム自身のバグで、外して続ける先が無いうえ、ここを
 * 緩めるとパックのせいに見える形で本体のバグが隠れる。
 */
export function loadDefinitions(pack: AssetPack | undefined, report: LoadReport): Definitions {
  try {
    return {
      codex: loadWorldCodex(pack, report),
      localization: loadLocalization(pack),
      files: [...WORLD_CODEX_TEXTS.keys(), ...(pack?.worldCodexTexts().keys() ?? [])],
    };
  } catch (error) {
    if (pack === undefined) throw error;

    report.add(pack.name, undefined, `読み込めないので、このパックを外しました: ${messageOf(error)}`);
    return loadDefinitions(undefined, report);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
