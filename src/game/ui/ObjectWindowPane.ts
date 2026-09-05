import type { CardLane } from './CardLane';

/**
 * 面が持つレーンの役割。**窓は中身を知らないので、レーンの意味はこの札だけが伝える**——並べる枠を
 * 決めるのも、落とし先にするかを決めるのも呼び出し側（PlayScene）で、その唯一の根拠になる。
 */
export type ObjectWindowLaneRole =
  /** 借りてきた1枚を置く枠（Windows.md 1.1節）。 */
  | 'card'
  /** スロットの中身の並び。 */
  | 'content'
  /** 探索で見つかった物の並び（Windows.md 5.1節）。 */
  | 'found';

/** 面が持つレーン1本と、それが何の並びなのか。 */
export interface ObjectWindowLane {
  readonly role: ObjectWindowLaneRole;
  readonly lane: CardLane;
}

/**
 * オブジェクトウィンドウのタブ1つぶんの中身（ObjectWindow）。
 *
 * **窓が呼ぶのはここに在るものだけ**で、何をどう描くかは面が決める。窓は中身を知らないので、
 * タブの種類が増えても窓は変わらない。
 */
export interface ObjectWindowPane {
  /** この面が持つレーン。レーンを持たない面は空。 */
  readonly lanes: readonly ObjectWindowLane[];

  /** 元にしている内容を読み直す。外から内容が変わらない面は何もしない。 */
  refresh(): void;

  destroy(): void;
}
