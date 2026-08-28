import type { WorldCodex } from '../../domain/WorldCodex';
import type { DefNames, DescriptionToken } from './Description';
import { objectRef, symbolRef, text } from './Description';

/**
 * グローバルIDを識別子へ戻す窓口（DefNames）を、Codexの名前空間の上に作る。
 *
 * **値をどう見せるかは読み手が決める**ので、シンボル型かどうかだけをCodexへ訊いて、書き表し方は
 * こちらで決める（Codexは表示の語彙を知らない）。
 */
export function defNamesOf(codex: WorldCodex): DefNames {
  return {
    objectName: (globalId) => codex.objectNames.getName(globalId),
    propertyName: (globalId) => codex.propertyNames.getName(globalId),
    slotName: (globalId) => codex.slotNames.getName(globalId),
    tagName: (globalId) => codex.tagNames.getName(globalId),
    propertyTagName: (globalId) => codex.propertyTagNames.getName(globalId),

    /**
     * シンボル型（6.6節）・型を指す値（6.9節）と宣言しているプロパティの値だけ名前へ戻す。どちらでも
     * 数値リテラルが書かれている箇所（未登録のIDになる）は数値のまま出す。
     */
    propertyValueToken: (propertyGlobalId: number, value: number): DescriptionToken => {
      if (codex.objectDefProperties.has(propertyGlobalId)) {
        const name = codex.objectNames.tryGetName(value);
        return name === undefined ? text(String(value)) : objectRef(name);
      }
      if (!codex.symbolicProperties.has(propertyGlobalId)) return text(String(value));
      const name = codex.symbolNames.tryGetName(value);
      return name === undefined ? text(String(value)) : symbolRef(name);
    },
  };
}
