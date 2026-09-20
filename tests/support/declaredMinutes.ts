import { analysisContextOf } from '../../src/analysis/craftingSteps';
import { staticResolverOf } from '../../src/analysis/staticValue';
import { resolveDeclaredNumber } from '../../src/domain/DeclaredNumber';
import type { DeclaredNumberReading } from '../../src/domain/EffectReader';
import type { ObjectDef } from '../../src/domain/ObjectDef';
import type { WorldCodex } from '../../src/domain/WorldCodex';

/**
 * `duration`（操作・枠、docs/engine/ActionSystem.md 6節）が世界を動かさずに解ける分数。**解けなければ
 * undefined**——参照の先が定義から辿れない宣言は、分数を名乗っていても答えが出ない。
 *
 * **宣言を省いていれば0**（時間を消費しない、`InteractionDef.minutesFor` と同じ規約）。ロールは長いほうの
 * 端で見るので、段のあるキャラクタが押しても宣言より短くはならない。
 *
 * **所要時間の線を引く検査が共有する**（6.2節の格子・6.3節の1時間）——読み方が2つに分かれると、
 * 片方の線だけが宣言の解き方を変えられる。
 */
export function declaredMinutesOf(
  codex: WorldCodex,
  def: ObjectDef,
  reading: DeclaredNumberReading | undefined,
): number | undefined {
  if (reading === undefined) return 0;
  return resolveDeclaredNumber(reading, staticResolverOf(def, 'highest', analysisContextOf(codex).resolve));
}
