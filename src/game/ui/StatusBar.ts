import Phaser from 'phaser';
import type { AlertLevel } from '../../domain/defs/AlertLevel';
import type { ScreenMetrics } from '../layout/ScreenMetrics';
import { ProgressBar } from './ProgressBar';
import { onPressRelease } from './tap';
import { COLOR, FONT_FAMILY, cssColor } from './theme';

/** 名前欄の幅とバーの高さ（ScreenLayout_Mock.htmlの.status-name/.status-bar-container）。 */
const NAME_WIDTH = 140;
const BAR_HEIGHT = 36;

/** 名前とバーの間隔。 */
const NAME_GAP = 12;

/** 固定表示の印を出す欄の幅。印が出ていない間も名前の位置が動かないよう、常に空けておく。 */
const PIN_WIDTH = 34;

/** 増減の記号を出す欄の幅と、バーとの間隔。記号が出ていない間もバーは伸ばさず、幅を空けておく。 */
const CHANGE_WIDTH = 40;
const CHANGE_GAP = 8;

/** 増減の記号と固定表示の印の大きさ。 */
const CHANGE_SIZE = 34;
const PIN_SIZE = 26;

/** 固定表示の印。 */
const PIN_MARK = '📌';

/** 並び順が変わったときに、その位置まで動く時間。 */
const MOVE_DURATION_MS = 250;

/** 直前の行動でその値が増えたか減ったか。変わらなかった項目には記号を出さない。 */
export type StatusChange = 'increased' | 'decreased';

/** ステータス1件分の表示内容（名前は識別子ではなく表示名）。 */
export interface StatusContent {
  /** プロパティの識別子（表示名ではない）。増減の対応付けと固定表示の記憶に使う。 */
  readonly key: string;

  readonly name: string;

  /** 実効値。ratioを持たないプロパティを数値で見せるために使う。 */
  readonly value: number;

  /** 満たされ具合（0〜1）。rangeを持たず割合を定義できないプロパティはundefined。 */
  readonly ratio: number | undefined;

  /** 値がどの域にあるか（GameElementDefinition.md 6.4節のalert）。 */
  readonly alert: AlertLevel;

  /** 直前の行動での増減。undefinedなら記号を出さない。 */
  readonly change?: StatusChange;

  /**
   * 直前の行動を始める前の満たされ具合。出ていなかった行を出すときに、この値から見せ始めることで
   * 「その行動で減った分」だけが赤い帯になる（show参照）。増減が無ければundefined。
   */
  readonly ratioBefore?: number;

  /** その行動の途中の値か（trueの間は赤い帯を縮めず、合計の減少量を残す。ProgressBar.setRatio参照）。 */
  readonly midAction?: boolean;

  /** ユーザが固定表示にしているか。 */
  readonly pinned?: boolean;

  /** 名前をタップしたときの固定表示のトグル。持たない場合、名前はタップに反応しない。 */
  readonly onTogglePin?: () => void;
}

/** 域ごとのバーの枠の色（明滅させない域はundefined）。 */
function alertColor(alert: AlertLevel): number | undefined {
  if (alert === 'danger') return COLOR.statusAlertDanger;
  if (alert === 'fatal') return COLOR.statusAlertFatal;
  return undefined;
}

/**
 * ステータス1件分の「固定表示の印＋名前＋バー＋増減」。行の高さはバーの高さと等しい。
 * 割合を定義できないプロパティは、バーの代わりに実効値そのものを出す。
 * 名前欄の幅（nameWidthU）は、長い表示名が並ぶプロパティウィンドウだけが広げる。
 *
 * 危険域・致命的域のバーは枠を明滅させる（ScreenLayout.md ステータスエリア節）。名前欄をタップすると
 * 固定表示が切り替わる。
 */
export class StatusBar extends Phaser.GameObjects.Container {
  static height(metrics: ScreenMetrics): number {
    return metrics.px(BAR_HEIGHT);
  }

  /** 割合を持つ項目のバー。持たない項目（valueText）はどちらか一方だけを作る。 */
  private readonly bar: ProgressBar | undefined;
  private readonly valueText: Phaser.GameObjects.Text | undefined;

  /** 増減の記号と固定表示の印。出ていないときは空文字にする（作り直すと表示順が変わるため消さない）。 */
  private readonly changeMark: Phaser.GameObjects.Text;
  private readonly pinMark: Phaser.GameObjects.Text;

  /** 移動中の動き。画面を作り直すと捨てられるため、消えるときに止める。 */
  private moveTween: Phaser.Tweens.Tween | undefined;

  constructor(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    x: number,
    y: number,
    width: number,
    content: StatusContent,
    nameWidthU: number = NAME_WIDTH,
  ) {
    super(scene, x, y);

    const height = metrics.px(BAR_HEIGHT);
    const pinWidth = metrics.px(PIN_WIDTH);
    const nameWidth = metrics.px(nameWidthU);
    const barX = pinWidth + nameWidth + metrics.px(NAME_GAP);
    const changeWidth = metrics.px(CHANGE_WIDTH);
    const barWidth = Math.max(0, width - barX - changeWidth - metrics.px(CHANGE_GAP));

    this.pinMark = scene.add
      .text(pinWidth / 2, height / 2, '', {
        fontFamily: FONT_FAMILY,
        fontSize: `${metrics.fontPx(PIN_SIZE)}px`,
      })
      .setOrigin(0.5);
    this.add(this.pinMark);

    const label = scene.add
      .text(pinWidth, height / 2, content.name, {
        fontFamily: FONT_FAMILY,
        fontSize: `${metrics.fontPx(30)}px`,
        fontStyle: 'bold',
        color: cssColor(COLOR.text),
      })
      .setOrigin(0, 0.5);
    // 名前欄に収まらない長い表示名は縮めて収める（はみ出すとバーに重なって読めなくなるため）。
    if (label.width > nameWidth) label.setScale(nameWidth / label.width);
    this.add(label);

    // 名前は小さすぎてタップしにくいため、印の欄と名前欄いっぱいの当たり判定を別に置く。
    const togglePin = content.onTogglePin;
    if (togglePin !== undefined) {
      const hitArea = scene.add
        .zone(0, 0, pinWidth + nameWidth, height)
        .setOrigin(0)
        .setInteractive({ useHandCursor: true });
      this.add(hitArea);
      onPressRelease(hitArea, { onRelease: togglePin });
    }

    if (content.ratio !== undefined) {
      this.bar = new ProgressBar(scene, metrics, barX, 0, barWidth, height, content.ratio);
      this.add(this.bar);
    } else {
      this.valueText = scene.add
        .text(barX, height / 2, String(content.value), {
          fontFamily: FONT_FAMILY,
          fontSize: `${metrics.fontPx(30)}px`,
          color: cssColor(COLOR.text),
        })
        .setOrigin(0, 0.5);
      this.add(this.valueText);
    }

    this.changeMark = scene.add
      .text(width - changeWidth / 2, height / 2, '', {
        fontFamily: FONT_FAMILY,
        fontSize: `${metrics.fontPx(CHANGE_SIZE)}px`,
      })
      .setOrigin(0.5);
    this.add(this.changeMark);
    this.showContent(content);

    this.once(Phaser.GameObjects.Events.DESTROY, () => this.moveTween?.stop());
    scene.add.existing(this);
  }

  /**
   * この行を、今の内容でyの位置へ出す。既に出ていた場合は、位置が変わったぶんを動きとして見せる
   * （並び順が変わったとき、どのバーがどこへ動いたのかを目で追えるようにするため）。
   * 出ていなかった場合は動かさずその位置に現れる（見えていなかった位置から飛んでこないように）。
   *
   * 出ていなかった行は、直前の行動を始める前の値（ratioBefore）から見せ始める。こうすると赤い帯は
   * 「その行動で減った分」だけになる。出ていなかった間の減少まで帯にすると、目で追えなかった減り方が
   * 今この瞬間の減少として出てしまう（安全域から現れた行が、満タンからいきなり減ったように見えていた）。
   * 内容と位置を1つの操作にしているのは、呼び出し側が「出す前に中身を入れる」順序を覚えなくて済むよう。
   */
  show(y: number, content: StatusContent): void {
    if (this.visible) {
      this.setContent(content);
      this.slideTo(y);
      return;
    }

    const before = content.ratioBefore;
    if (before !== undefined) this.bar?.resetRatio(before);
    this.applyContent(content, before !== undefined);
    this.stopMoving();
    this.setVisible(true).setY(y);
  }

  /** 並びから外れた行にする（安全域に戻った、固定表示を外した）。 */
  hide(): void {
    this.stopMoving();
    this.setVisible(false);
  }

  /**
   * 値・増減・域・固定表示を今の状態へ書き換える。作り直さず中身だけ差し替えるのは、作り直すと画面の
   * 表示順が変わって子ウィンドウの覆いより手前へ出てしまうことと、バーが減る様子（ProgressBar.setRatio）を
   * 見せている途中で捨てないため。
   */
  setContent(content: StatusContent): void {
    this.applyContent(content, true);
  }

  /** showDecreaseがfalseなら、減った分の赤い帯を出さずに値を今の状態にする（show参照）。 */
  private applyContent(content: StatusContent, showDecrease: boolean): void {
    if (content.ratio !== undefined) {
      if (showDecrease) this.bar?.setRatio(content.ratio, content.midAction === true);
      else this.bar?.resetRatio(content.ratio);
    }
    this.valueText?.setText(String(content.value));
    this.showContent(content);
  }

  /** 位置が変わったぶんを動きとして見せる。 */
  private slideTo(y: number): void {
    this.stopMoving();
    if (this.y === y) return;

    this.moveTween = this.scene.tweens.add({
      targets: this,
      y,
      duration: MOVE_DURATION_MS,
      ease: 'Cubic.easeOut',
    });
  }

  private stopMoving(): void {
    this.moveTween?.stop();
    this.moveTween = undefined;
  }

  private showContent(content: StatusContent): void {
    this.bar?.setAlertBorder(alertColor(content.alert));
    this.pinMark.setText(content.pinned === true ? PIN_MARK : '');
    this.showChange(content.change);
  }

  private showChange(change: StatusChange | undefined): void {
    if (change === undefined) {
      this.changeMark.setText('');
      return;
    }

    const increased = change === 'increased';
    this.changeMark
      .setText(increased ? '▲' : '▼')
      .setColor(cssColor(increased ? COLOR.statusIncreased : COLOR.statusDecreased));
  }
}
