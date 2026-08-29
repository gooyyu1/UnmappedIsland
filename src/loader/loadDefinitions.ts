import type { AssetPack } from '../asset-pack/AssetPack';
import { installPackArt } from '../asset-pack/install';
import type { WorldCodex } from '../domain/WorldCodex';
import type { Localization } from '../locale/Localization';
import { loadLocalization } from '../locale/Localization';
import { LoadReport } from './LoadReport';
import { loadWorldCodex, WORLD_CODEX_TEXTS } from './loadWorldCodex';
import { messageOf } from './errorMessage';

/** 読み込めた定義一式。 */
export interface Definitions {
  readonly codex: WorldCodex;
  readonly localization: Localization;
  /** 実際に読んだ定義YAMLのファイル名（外したパックのぶんは入らない）。 */
  readonly files: readonly string[];
}

/**
 * 同梱ぶんとアセットパックから定義一式を読み、載ったパックの絵を在庫表へ重ねる
 * （AssetPack.md 6.1節）。パックは渡された順に載る（同6.2節）。
 *
 * **読めなければ、読めなかったパックだけを外して組み直す。** 定義の一部だけを生かすと参照切れが
 * 残り、壊れ方が原因から遠い場所に出る。パック単位で外せば、結果は必ず「同梱ぶん＋無事なパック」
 * という、それ自体で筋の通った世界になる。
 *
 * **1つのパックは、定義も絵もまとめて載るかまとめて外れる。** 絵を先に入れてしまうと、定義を外した
 * パックの背景が同梱の型に敷かれ、絵だけ外せばその型が絵を持たない世界になる。どちらも「同梱ぶん＋
 * 無事なパック」ではないので、絵の名前の衝突（同6節）もパック1つを外す失敗として、ここで受ける。
 *
 * 同梱ぶんの誤りは今までどおり投げる。ゲーム自身のバグで、外して続ける先が無いうえ、ここを
 * 緩めるとパックのせいに見える形で本体のバグが隠れる。
 */
export function loadDefinitions(packs: readonly AssetPack[], report: LoadReport): Definitions {
  const mark = report.problems.length;
  try {
    return built(packs, report);
  } catch (error) {
    if (packs.length === 0) throw error;

    report.forgetAfter(mark);
    return built(acceptable(packs, report), report);
  }
}

/**
 * その並びで載せてみる。**絵まで入れて初めて「載った」**——途中で投げれば、そのパックは外れる。
 *
 * 絵の在庫表は渡された並びから毎回組み直される（installPackArt）ので、試して駄目だった並びが
 * 残ることはない。
 */
function built(packs: readonly AssetPack[], report: LoadReport): Definitions {
  const codex = loadWorldCodex(packs, report);
  const localization = loadLocalization(packs);
  installPackArt(packs);
  return {
    codex,
    localization,
    files: [...WORLD_CODEX_TEXTS.keys(), ...packs.flatMap((pack) => [...pack.worldCodexTexts().keys()])],
  };
}

/**
 * 落ちたパックを外した並び。**1つずつ足して確かめる**——どのパックが落としたのかは、まとめて
 * 読んだときの例外からは言えないため。定義が読めないパックも、絵の名前が重なるパックも、ここで
 * 同じように外れる。外した理由は記録に残す（AssetPack.md 6.1節）。
 *
 * 確かめるときの記録は捨てる。ここで組み立てたものは使わず、生き残った並びで組み直すので、
 * 同じ記録が2度並ぶことになる。
 */
function acceptable(packs: readonly AssetPack[], report: LoadReport): readonly AssetPack[] {
  const accepted: AssetPack[] = [];
  for (const pack of packs) {
    try {
      built([...accepted, pack], new LoadReport());
      accepted.push(pack);
    } catch (error) {
      report.addDiscarded(
        pack.name,
        undefined,
        `読み込めないので、このパックを外しました: ${messageOf(error)}`,
      );
    }
  }
  return accepted;
}
