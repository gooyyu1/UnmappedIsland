import Phaser from 'phaser';
import type { AlertLevel } from '../../domain/defs/AlertLevel';
import type { ScreenMetrics } from '../looks/ScreenMetrics';
import { ProgressBar } from './ProgressBar';
import { onPressRelease } from './tap';
import { COLOR, FONT_FAMILY, cssColor } from '../looks/theme';

/** バーの高さ（ScreenLayout_Mock.htmlの.status-bar-container）。 */
const BAR_HEIGHT = 36;

/** アイコン欄の幅と、そこに出す絵の大きさ。 */
const ICON_WIDTH = 44;
const ICON_SIZE = 34;

/** 見出しとバーの間隔。 */
const LABEL_GAP = 12;

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

/**
 * 影響1件の見せ方（[`Windows.md`](../../../docs/ui/Windows.md) 8節）。相手の絵と名前、影響方法の
 * 記号だけを出す。量は出さない——プレイヤーが決めるのは「何をすればどれが動くか」で、いくつ動くかを
 * 突き合わせる画面ではない。
 */
export interface StatusInfluence {
  /**
   * 相手がプロパティなら、その識別子（表示名ではない）。枠をタップしたときに開く相手を指す。
   * 相手がオブジェクトのときはundefinedで、その枠は押しても何も起きない。
   */
  readonly key: string | undefined;

  /** 相手の表示名。絵を持たない相手の枠に、絵の代わりとして出す。 */
  readonly name: string;

  /** 相手がプロパティなら対応表の絵文字、オブジェクトなら種別の絵文字（絵が無いときの代用）。 */
  readonly icon: string | undefined;

  /** 相手がオブジェクトなら、その絵の名前（objectArt）。プロパティは絵を持たないのでundefined。 */
  readonly art: string | undefined;

  /** 可逆な寄与（modify）か。三角と＋−を分ける。 */
  readonly reversible: boolean;

  /** 相手を増やす向きか。記号の向き（▲▼・＋−）がこれで決まる。 */
  readonly increases: boolean;

  /**
   * この記号が表す変化が、それを受けるステータスにとって悪化か。記号の色だけがこれを見る
   * （増減の記号と同じ規則、[`StatusArea.md`](../../../docs/ui/StatusArea.md) 6節）。
   *
   * **受けるのがどちらかは一覧が決まれば決まる**——与えている影響なら相手が、受けている影響なら
   * 自分が動く側なので、その側にとっての良し悪しになる。
   */
  readonly worsens: boolean;

  /** 今その条件が成立しているか。成立していない影響は薄く、記号を出さずに並べる。 */
  readonly active: boolean;
}

/**
 * バーに重ねる、段の刻みと今いる段（[`Windows.md`](../../../docs/ui/Windows.md) 8.1節）。
 */
export interface StatusStage {
  /** 今いる段の表示名。 */
  readonly name: string;

  /** 今いる段がバーの中で占める区間（0〜1）。持たない段では囲みも名札も出さない。 */
  readonly span: { readonly start: number; readonly end: number } | undefined;

  /** 段の境目（0〜1、昇順）。バーに刻む目盛りになる。 */
  readonly boundaries: readonly number[];
}

/** ステータス詳細ウィンドウ（[`Windows.md`](../../../docs/ui/Windows.md) 8節）に出す内容。 */
export interface StatusDetail {
  /** そのステータスが何を表すか（対応表の`description`）。まだ書かれていなければundefined。 */
  readonly description: string | undefined;

  /** 段の刻みと今いる段。段を宣言していないプロパティはundefined。 */
  readonly stage: StatusStage | undefined;

  /** このステータスが与えている影響。 */
  readonly given: readonly StatusInfluence[];

  /** このステータスが受けている影響。 */
  readonly received: readonly StatusInfluence[];
}

/** ステータス1件分の表示内容（名前は識別子ではなく表示名）。 */
export interface StatusContent {
  /** プロパティの識別子（表示名ではない）。増減の対応付けと固定表示の記憶に使う。 */
  readonly key: string;

  readonly name: string;

  /**
   * 名前の代わりに行の左へ出す絵（StatusArea.md 3節）。宣言が無ければ表示名を出すので、
   * 絵を持たないプロパティを固定表示にしても行が無名にはならない。
   */
  readonly icon?: string;

  /** 実効値。ratioを持たないプロパティを数値で見せるために使う。 */
  readonly value: number;

  /** 満たされ具合（0〜1）。rangeを持たず割合を定義できないプロパティはundefined。 */
  readonly ratio: number | undefined;

  /** 値がどの域にあるか（GameElementDefinition.md 6.4節のalert）。 */
  readonly alert: AlertLevel;

  /** 増えるほど悪い値か（PropertyDef.worsensUpward）。バーの向きと増減の記号の色が変わる。 */
  readonly worsensUpward?: boolean;

  /** 直前の行動での増減。undefinedなら記号を出さない。 */
  readonly change?: StatusChange;

  /**
   * 直前の行動を始める前の満たされ具合。出ていなかった行を出すときに、この値から見せ始めることで
   * 「その行動で変わった分」だけが帯になる（show参照）。増減が無ければundefined。
   */
  readonly ratioBefore?: number;

  /** その行動の途中の値か（trueの間は変化の帯を動かさず、合計の変化量を残す。ProgressBar.setRatio参照）。 */
  readonly midAction?: boolean;

  /** ユーザが固定表示にしているか。 */
  readonly pinned?: boolean;

  /** 名前をタップしたときの固定表示のトグル。持たない場合、名前はタップに反応しない。 */
  readonly onTogglePin?: () => void;

  /**
   * ステータス詳細ウィンドウ（Windows.md 8節）に出す内容。バー自身は使わず、開く側へそのまま渡る。
   * 詳細を持たない行（開けない行）ではundefined。
   */
  readonly detail?: StatusDetail;

  /** バーをタップしたときに詳細を開く。持たない場合、バーはタップに反応しない。 */
  readonly onOpenDetail?: () => void;
}

/**
 * 行の左に出す見出し。**どちらも絵を出し**、プロパティウィンドウはその右に表示名も添える
 * （絵と名前の対応をそこで覚えられるようにするため、Windows.md 6節）。ステータスエリアは絵だけで、
 * 名前に要る幅をバーへ回す。
 *
 * **添えるかどうかと名前欄の幅を1つの宣言にする**のは、幅が要るのが表示名だけだから——別々の
 * 選択肢にすると、呼ぶ側が2つを噛み合わせて渡す決まりを覚えることになる。
 */
export type StatusLabel = { readonly kind: 'icon' } | { readonly kind: 'withName'; readonly width: number };

/** 行の見せ方の選択肢。 */
export interface StatusBarOptions {
  /** 行の左に出す見出し。省略すると絵だけ。 */
  readonly label?: StatusLabel;

  /**
   * 変化を見せ終わったときに呼ぶ。安全域へ戻った行はそれまで並びに残しているため、外す機会が
   * ここにしか無い（isShowingChange・statusRows）。
   */
  readonly onCaughtUp?: () => void;
}

/**
 * ステータス1件分の「固定表示の印＋見出し＋バー＋増減」。行の高さはバーの高さと等しい。
 * 割合を定義できないプロパティは、バーの代わりに実効値そのものを出す。
 *
 * 危険域・致命的域のバーは枠を明滅させる（StatusArea.md）。見出しの欄をタップすると
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

  /** 増えるほど悪い値か。プロパティごとに決まっていて動かないため、作るときに1回だけ受け取る。 */
  private readonly worsensUpward: boolean;

  /** 今映している内容。詳細を開く入口は行動のたびに差し替わるため、押された時点のものを使う。 */
  private content: StatusContent;

  constructor(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    x: number,
    y: number,
    width: number,
    content: StatusContent,
    options: StatusBarOptions = {},
  ) {
    super(scene, x, y);
    this.worsensUpward = content.worsensUpward === true;
    this.content = content;

    const height = metrics.px(BAR_HEIGHT);
    const pinWidth = metrics.px(PIN_WIDTH);
    const label = options.label ?? { kind: 'icon' };
    const iconWidth = metrics.px(ICON_WIDTH);
    const labelWidth =
      label.kind === 'icon' ? iconWidth : iconWidth + metrics.px(LABEL_GAP) + metrics.px(label.width);
    const barX = pinWidth + labelWidth + metrics.px(LABEL_GAP);
    const changeWidth = metrics.px(CHANGE_WIDTH);
    const barWidth = Math.max(0, width - barX - changeWidth - metrics.px(CHANGE_GAP));

    this.pinMark = scene.add
      .text(pinWidth / 2, height / 2, '', {
        fontFamily: FONT_FAMILY,
        fontSize: `${metrics.fontPx(PIN_SIZE)}px`,
      })
      .setOrigin(0.5);
    this.add(this.pinMark);

    for (const text of createLabel(scene, metrics, content, label, pinWidth, iconWidth, height))
      this.add(text);

    // 見出しは小さすぎてタップしにくいため、印の欄と見出しの欄いっぱいの当たり判定を別に置く。
    const togglePin = content.onTogglePin;
    if (togglePin !== undefined) {
      const hitArea = scene.add
        .zone(0, 0, pinWidth + labelWidth, height)
        .setOrigin(0)
        .setInteractive({ useHandCursor: true });
      this.add(hitArea);
      onPressRelease(hitArea, { onRelease: togglePin });
    }

    if (content.ratio !== undefined) {
      this.bar = new ProgressBar(scene, metrics, barX, 0, barWidth, height, content.ratio, {
        worsensUpward: this.worsensUpward,
        onCaughtUp: options.onCaughtUp,
      });
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

    // バーの側をタップすると詳細が開く。見出しの側（印・絵・名前）は固定表示の切り替えのままで、
    // 1本の行の中で「何のステータスか」を押すか「その値」を押すかが2つの操作を分ける。
    //
    // 呼ぶのは**今の**内容の入口。行は作り直さず中身だけ差し替わる（setContent）ので、作った時点の
    // 入口を捕まえると、開いた詳細だけが行動する前の状態のままになる。
    if (content.onOpenDetail !== undefined) {
      const barHit = scene.add
        .zone(barX, 0, Math.max(0, width - barX), height)
        .setOrigin(0)
        .setInteractive({ useHandCursor: true });
      this.add(barHit);
      onPressRelease(barHit, { onRelease: () => this.content.onOpenDetail?.() });
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
   * 出ていなかった行は、直前の行動を始める前の値（ratioBefore）から見せ始める。こうすると帯は
   * 「その行動で変わった分」だけになる。出ていなかった間の変化まで帯にすると、目で追えなかった動きが
   * 今この瞬間の変化として出てしまう（安全域から現れた行が、満タンからいきなり減ったように見えていた）。
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

  /**
   * この行を渡した内容にしたとき、まだ見せ終わっていない変化が残るか。安全域へ戻った行を、変化を
   * 見せ切るまで並びに残すかの判断に使う（statusRows）。
   *
   * 出ていない行は動かさずに現れる（show参照）ので、残す理由が無い——出ていない間に進んだ分は
   * 見せない変化なので、バーが持っている値との差を変化として数えてはいけない。
   */
  isShowingChange(content: StatusContent): boolean {
    if (!this.visible || content.ratio === undefined) return false;
    return this.bar?.isBehind(content.ratio) === true;
  }

  /** 並びから外れた行にする（変化を見せ終わった、固定表示を外した）。 */
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

  /** showChangeがfalseなら、変化の帯を出さずに値を今の状態にする（show参照）。 */
  private applyContent(content: StatusContent, showChange: boolean): void {
    if (content.ratio !== undefined) {
      if (showChange) this.bar?.setRatio(content.ratio, content.midAction === true);
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
    this.content = content;
    this.bar?.setAlert(content.alert);
    this.pinMark.setText(content.pinned === true ? PIN_MARK : '');
    this.showChange(content.change);
  }

  /** 三角の向きは値の増減そのもの、色は良し悪し（増えると悪い値では緑と赤が入れ替わる）。 */
  private showChange(change: StatusChange | undefined): void {
    if (change === undefined) {
      this.changeMark.setText('');
      return;
    }

    const increased = change === 'increased';
    const worsened = increased === this.worsensUpward;
    this.changeMark
      .setText(increased ? '▲' : '▼')
      .setColor(cssColor(worsened ? COLOR.statusDecreased : COLOR.statusIncreased));
  }
}

/**
 * 行の左の見出し。絵は絵の欄の中央へ、表示名はその右へ置く。
 *
 * **名前を添えない欄では、絵を持たないプロパティは表示名が代わりを務める**（どのプロパティも固定表示に
 * すればステータスエリアへ出るため、絵は揃っているとは限らない）。欄の幅は代用しても変えない——バーの
 * 左端が行ごとにずれると、長さを見比べられなくなる。
 */
function createLabel(
  scene: Phaser.Scene,
  metrics: ScreenMetrics,
  content: StatusContent,
  label: StatusLabel,
  x: number,
  iconWidth: number,
  height: number,
): readonly Phaser.GameObjects.Text[] {
  const texts: Phaser.GameObjects.Text[] = [];

  if (content.icon !== undefined) {
    const icon = scene.add
      .text(x + iconWidth / 2, height / 2, content.icon, {
        fontFamily: FONT_FAMILY,
        fontSize: `${metrics.fontPx(ICON_SIZE)}px`,
      })
      .setOrigin(0.5);
    texts.push(fitted(icon, iconWidth));
  }

  const named = label.kind === 'withName';
  if (named || content.icon === undefined) {
    const name = scene.add
      .text(named ? x + iconWidth + metrics.px(LABEL_GAP) : x, height / 2, content.name, {
        fontFamily: FONT_FAMILY,
        fontSize: `${metrics.fontPx(30)}px`,
        fontStyle: 'bold',
        color: cssColor(COLOR.text),
      })
      .setOrigin(0, 0.5);
    texts.push(fitted(name, label.kind === 'withName' ? metrics.px(label.width) : iconWidth));
  }

  return texts;
}

/** 欄に収まらないものは縮めて収める（はみ出すとバーに重なって読めなくなるため）。 */
function fitted(text: Phaser.GameObjects.Text, width: number): Phaser.GameObjects.Text {
  if (text.width > width) text.setScale(width / text.width);
  return text;
}
