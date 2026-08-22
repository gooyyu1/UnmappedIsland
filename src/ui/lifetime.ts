import type Phaser from 'phaser';

/**
 * まだ生きている表示物か（破棄されていないか）。
 *
 * **Phaserは破棄した表示物の`scene`をundefinedにするが、型は非省略可と言っている。** その嘘を
 * 受けるのはここだけにする——呼び出し側に `object.scene !== undefined` が散ると、Phaserの都合を
 * 知らない読み手には「何を確かめているのか」が読めないうえ、型の上では常に真の比較が並ぶ。
 *
 * 破棄済みを渡しうるのは、**破棄と、それを見て動く処理の間に時間が空く**ところ（飛んでいる札の
 * 着地、次のフレームの追従、経過の再生）。
 */
export function isAlive(object: Phaser.GameObjects.GameObject): boolean {
  return (object.scene as Phaser.Scene | undefined) !== undefined;
}
