import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { WorldObject } from '../../src/domain/WorldObject';
import type { WorldSession } from '../../src/domain/WorldSession';
import { SAMPLE_CHARACTER } from './worldCodexFiles';

/**
 * 明るさ以外を確かめるテストのための足場（docs/engine/IlluminationSystem.md 5節）。
 *
 * 採取・移動・手元の作業には明るさの条件が付いているので、暗いままだとどの操作も成立しない。
 * 時刻・天気・光源を組み立てる代わりに、キャラクタ自身の値へ積んで条件を黙らせる。
 */

/** どのしきい値（-5・+5）も確実に超える上積み。 */
const BRIGHT_ENOUGH = 100;

/** そのキャラクタを、明るさの条件に一切引っかからない状態にする。 */
export function makeBrightEnoughForAnyAction(character: WorldObject, codex: WorldCodex): void {
  for (const name of ['hand_brightness', 'looking_brightness'])
    character.getProperty(codex.propertyNames.getId(name)).setNumberWithoutEvents(BRIGHT_ENOUGH);
}

/**
 * 明るさの条件に引っかからないキャラクタを1体作る。**どのスロットへも入れない**ので、
 * 呼び手は置き場所を用意しなくてよく、居場所の明るさにも左右されない。
 */
export function createBrightEnoughAgent(session: WorldSession, codex: WorldCodex): WorldObject {
  const character = session.createObject(codex.objectNames.getId(SAMPLE_CHARACTER));
  makeBrightEnoughForAnyAction(character, codex);
  return character;
}
