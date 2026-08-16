import Phaser from 'phaser';
import type { Rect } from '../../ui/Rect';

/** 砂埃の粒の画像のテクスチャキー（実体は src/assets/dust_puff.png、BootSceneが読む）。 */
export const DUST_PUFF_TEXTURE = 'dust_puff';

/**
 * 砂埃を置く層。飛んでいる札（CardTable）より手前で、空の翳り（PlayScene.SKY_TINT_DEPTH）
 * よりは奥——埃は場に舞うものなので、時間帯の明るさはカードと同じだけ受ける。
 */
const DEPTH = 1.2;

/** 1回に散らす粒の数。 */
const GRAINS = 7;

/**
 * 粒の直径・散る距離・浮き上がる高さ。いずれも札の幅に対する比。
 *
 * **札からはみ出す距離まで散らす。** 札の中に収まる散り方だと「その札が埃っぽい」に見えて、
 * そこで何かが起きたようには見えない。
 */
const GRAIN = 0.6;
const DISTANCE = 0.8;
const RISE = 0.1;

/** 向き・距離・速さのばらつき（1に対する比）。同じ形の粒が等間隔に並ぶと、埃ではなく飾りに見える。 */
const SCATTER = 0.35;

/** 出る大きさと消える大きさ（GRAINに対する比）、および出るときの濃さ。 */
const SCALE_FROM = 0.45;
const SCALE_TO = 1.3;
const ALPHA = 0.9;

/** 散り切るまでの時間（ミリ秒）と、動きの加速の形。強く出て緩く止まる（ぱふっ、と出る形）。 */
const MS = 420;
const EASE = 'Cubic.easeOut';

/**
 * 薄れ方だけは動きと逆に、**始めは濃いまま散り、終わり際に一気に消える**。動きと同じ形で薄めると、
 * 濃さが残っているうちは重なった塊のままで、散り切る前に見えなくなる。
 */
const FADE_EASE = 'Quad.easeIn';

/** 札の中心から外へ、砂埃をぱふっと散らす（CardInteraction.md 6.1節）。 */
export class DustPuff {
  private readonly scene: Phaser.Scene;
  private readonly layer: Phaser.GameObjects.Container;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.layer = scene.add.container(0, 0).setDepth(DEPTH);
  }

  /**
   * 札1枚ぶんの矩形の中心から散らす。絵が届いていなければ何もしない——図形で代用しても埃には
   * 見えないので、無いなら出さないほうがよい。
   */
  burst(at: Rect): void {
    if (!this.scene.textures.exists(DUST_PUFF_TEXTURE)) return;

    const x = at.x + at.width / 2;
    const y = at.y + at.height / 2;
    const turn = Phaser.Math.FloatBetween(0, Math.PI * 2);
    for (let index = 0; index < GRAINS; index += 1) {
      this.scatter(x, y, turn + ((Math.PI * 2) / GRAINS) * (index + this.vary() - 1), at.width);
    }
  }

  /** 粒を1つ、その向きへ飛ばして消す。 */
  private scatter(x: number, y: number, angle: number, cardWidth: number): void {
    const grain = this.scene.add.image(x, y, DUST_PUFF_TEXTURE);
    this.layer.add(grain);

    // 絵の画素数は絵の都合なので、札の幅に対する比へ直してから倍率にする。
    const size = (cardWidth * GRAIN) / grain.width;
    const distance = cardWidth * DISTANCE * this.vary();
    grain
      .setScale(size * SCALE_FROM)
      .setAlpha(ALPHA)
      .setAngle(Phaser.Math.FloatBetween(0, 360));

    this.scene.tweens.add({
      targets: grain,
      x: x + Math.cos(angle) * distance,
      y: y + Math.sin(angle) * distance - cardWidth * RISE,
      scale: size * SCALE_TO,
      alpha: { value: 0, ease: FADE_EASE },
      duration: MS * this.vary(),
      ease: EASE,
      onComplete: () => grain.destroy(),
    });
  }

  /** 1を中心に、SCATTERのぶんだけ揺らした倍率。 */
  private vary(): number {
    return 1 + Phaser.Math.FloatBetween(-SCATTER, SCATTER);
  }
}
