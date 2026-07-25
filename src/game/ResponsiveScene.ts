import Phaser from 'phaser';
import { ScreenMetrics } from './layout/ScreenMetrics';

/**
 * 画面サイズの変化に追従するシーンの土台。
 *
 * 縦型・横型では同じ要素を配置し直すだけという設計（ScreenLayout.md）に合わせ、リサイズ時は
 * 個々の要素を動かすのではなく画面全体を作り直す。UIしか持たないシーンなので、作り直しの方が
 * 「向きごとに位置を計算し直す」分岐を各要素に持たせるより単純で、崩れも起きない。
 */
export abstract class ResponsiveScene extends Phaser.Scene {
  /** 現在の画面寸法。buildの中でだけ参照する。 */
  protected metrics = new ScreenMetrics(1, 1);

  create(): void {
    this.rebuild();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.rebuild, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.rebuild, this);
    });
  }

  /** 画面を組み立てる。作り直しのたびに呼ばれるので、前回の状態は残っていない前提で書く。 */
  protected abstract build(): void;

  /**
   * 画面を作り直す。リサイズのほか、表示内容が変わったとき（プレイ画面のアクション実行後など）にも
   * 呼ぶ。開いている子ウィンドウも消えるため、buildは「今開いているもの」を毎回組み立て直す。
   */
  protected rebuild(): void {
    this.children.removeAll(true);
    this.cameras.resize(this.scale.width, this.scale.height);
    this.metrics = new ScreenMetrics(this.scale.width, this.scale.height);
    this.build();
  }
}
