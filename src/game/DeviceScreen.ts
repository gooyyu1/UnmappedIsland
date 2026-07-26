import Phaser from 'phaser';

/** DeviceScreenが決める項目（表示先・拡大縮小）を除いたゲーム設定。 */
type GameConfigWithoutScale = Omit<Phaser.Types.Core.GameConfig, 'parent' | 'scale'>;

/** CSSピクセルあたりの物理ピクセル数。取得できない環境では1とする。 */
function pixelRatio(): number {
  const ratio = window.devicePixelRatio;
  return ratio > 0 ? ratio : 1;
}

/**
 * ゲームのキャンバスを、表示先の要素の大きさと端末の画素密度に合わせ続ける。
 *
 * PhaserのRESIZEモードはキャンバスをCSSピクセル数で作る。devicePixelRatioが1より大きい端末
 * （スマートフォンや高精細ディスプレイ）ではこれが実際の画素より粗い絵になり、引き伸ばされて
 * ぼやける。そのため拡大縮小はPhaserに任せず（NONEモード）、ゲームの座標系を物理ピクセルに
 * 取ってキャンバスを作り、CSS上の表示寸法だけを zoom = 1/devicePixelRatio で元に戻す。
 * これによりゲーム内の1ピクセルが端末の1画素に対応する。
 *
 * ゲーム内の座標が物理ピクセルになるため、ブラウザからCSSピクセルで受け取る量（ホイールの
 * 回転量など）はゲームの座標系へ換算してから使う（`ScaleManager.displayScale` が換算係数）。
 */
export class DeviceScreen {
  private readonly parent: HTMLElement;
  private readonly game: Phaser.Game;

  /** 直前に反映した物理ピクセルでの寸法。変化が無いのに画面を作り直さないために持つ。 */
  private width: number;
  private height: number;

  private constructor(parent: HTMLElement, config: GameConfigWithoutScale) {
    this.parent = parent;
    const size = this.deviceSize();
    this.width = size.width;
    this.height = size.height;
    this.game = new Phaser.Game({
      ...config,
      parent,
      scale: {
        mode: Phaser.Scale.NONE,
        width: size.width,
        height: size.height,
        zoom: 1 / pixelRatio(),
      },
    });
    this.watch();
  }

  /** 指定したid の要素を表示先として、端末の解像度に合わせたゲームを起動する。 */
  static startGame(parentId: string, config: GameConfigWithoutScale): Phaser.Game {
    const parent = document.getElementById(parentId);
    if (parent === null) throw new Error(`ゲームの表示先の要素が見つかりません: #${parentId}`);
    return new DeviceScreen(parent, config).game;
  }

  /** 表示先の大きさを物理ピクセルで測る。 */
  private deviceSize(): { width: number; height: number } {
    const ratio = pixelRatio();
    const rect = this.parent.getBoundingClientRect();
    return { width: Math.round(rect.width * ratio), height: Math.round(rect.height * ratio) };
  }

  /** 表示先の大きさと画素密度の変化を監視する。 */
  private watch(): void {
    new ResizeObserver(() => this.apply()).observe(this.parent);
    // 画素密度の変化（ブラウザのズーム、別の画面へのウィンドウ移動）は表示先の大きさが変わらない
    // ことがありResizeObserverでは捉えられないため、現在の密度から外れたことを個別に監視する。
    const watchPixelRatio = (): void => {
      const onChange = (): void => {
        this.apply();
        watchPixelRatio();
      };
      window
        .matchMedia(`(resolution: ${pixelRatio()}dppx)`)
        .addEventListener('change', onChange, { once: true });
    };
    watchPixelRatio();
  }

  /** 現在の大きさ・画素密度をゲームへ反映する。 */
  private apply(): void {
    const zoom = 1 / pixelRatio();
    const size = this.deviceSize();
    const scale = this.game.scale;
    if (size.width === this.width && size.height === this.height && zoom === scale.zoom) return;

    this.width = size.width;
    this.height = size.height;
    scale.resize(size.width, size.height);
    // 倍率が1のとき`resize`はキャンバスのCSS寸法を書き換えないため、倍率の変更は必ず`resize`の
    // 後に行う（`setZoom`が新しい倍率でCSS寸法を設定し直す）。
    if (zoom !== scale.zoom) scale.setZoom(zoom);
  }
}
