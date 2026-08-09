import Phaser from 'phaser';
import type { Rect, ScreenMetrics } from '../layout/ScreenMetrics';
import { COLOR, FONT_FAMILY, SIZE, cssColor, durabilityColorFor } from './theme';
import { drawBox } from './shapes';
import { cardBackgroundTexture } from './backgroundArt';
import { CARD_ART_WIDTH, objectTexture } from './objectArt';
import { ProgressBar } from './ProgressBar';
import type { ProgressBarOptions } from './ProgressBar';
import type { AlertLevel } from '../../domain/defs/AlertLevel';
import { HoldRepeat } from './holdRepeat';
import { onPressRelease } from './tap';
import { wrapByCharacter } from './textLayout';

/**
 * カードの枠の画像のテクスチャキー（実体はsrc/assets/card_frame.png、BootSceneが読む）。
 * カードの寸法（SIZE.cardWidth/cardHeight）はこの画像の比率に合わせてある。
 */
export const CARD_FRAME_TEXTURE = 'card-frame';

/** 空き枠は同じ枠の画像を薄く敷いて表す。 */
const EMPTY_FRAME_ALPHA = 0.35;

/**
 * カードの絵の中で紙そのものが占める範囲（u単位）。絵は820x1280pxで、紙は周囲に10pxの余白を空け、
 * 角の半径は64px。カードの実寸は絵と同じ比率なので、u単位へは1/4で直せる。
 * 図形で描く枠（破線の空き枠・画像が無いときの代用）を絵の輪郭に重ねるために使う。
 */
const FRAME_INSET = 2.5;
const FRAME_RADIUS = 16;

/** カード名の最大行数。これを超える分は表示しない（モックの-webkit-line-clamp: 3に対応）。 */
const NAME_MAX_LINES = 3;

/**
 * カード名を紙の縁から離す余白と、白い縁取りの太さ（u単位）。
 * 余白は角の丸み（FRAME_RADIUS）の内側へ収まる幅を取り、文字が枠の線に触れないようにする。
 * 縁取りは、絵の上に載った暗い文字の輪郭を保つためのもの。
 */
const NAME_MARGIN = 8;
const NAME_STROKE = 4;

/**
 * 道のカードの左下に出す矢印の大きさと縁の太さ（u単位）。名前の文字（30u）の1.5倍ほど取り、
 * カードを縮めて並べても一目で道と分かるようにする。
 *
 * 絵文字（➡）ではなく図形で描く。字が無いフォントでは豆腐になるうえ、絵文字として描かれると
 * 環境ごとに色も形も変わってしまうため。
 *
 * 縁は名前の縁取り（NAME_STROKE）より細い。名前は文字の隙間を縁取りが埋めないよう太らせるが、
 * 矢印は一続きの塗りなので、太らせると形そのものが鈍る。
 */
const ROAD_ARROW_WIDTH = 51;
const ROAD_ARROW_HEIGHT = 45;
const ROAD_ARROW_STROKE = 2;

/**
 * 矢印を紙の左下の角から離す余白（u単位）。名前の余白（NAME_MARGIN）より広い。
 *
 * 絵は紙の縁の内側12uをかけて薄くなっていく（tools/comfyui/card_art.py の feather、410px幅で24px）。
 * そこへ矢印を置くと、絵の薄い帯と重なって輪郭が濁る。角の丸み（FRAME_RADIUS）ぶん空ければ、
 * 丸めた角でも縁までの距離が12uを下回らない。
 */
const ROAD_ARROW_MARGIN = FRAME_RADIUS;

/**
 * 押下中に紙の縁へ重ねる黒枠の太さ（u単位。ドロップ先を示す枠と揃える）。
 * 半透明にはしない——札が透けるとカードらしさが損なわれるため。
 */
const PRESSED_BORDER_WIDTH = 6;

/** 端の操作エリアの高さ（カード高さに対する比）。 */
const EDGE_RATIO = 1 / 6;

/** 押している間だけ出す、端の操作エリアのオーバーレイの濃さと矢印の大きさ（u単位）。 */
const EDGE_OVERLAY_ALPHA = 0.55;
const EDGE_ARROW_SIZE = 44;

/** スタック数を囲む丸の直径・絵の右上の角から外へはみ出させる量・中の数字の大きさ（u単位）。 */
const STACK_BADGE_SIZE = 56;
const STACK_BADGE_OVERHANG = 8;

/**
 * 状態を表す印（手当て済みの怪我など）の大きさと、紙の左下からの余白（u単位）。
 *
 * **絵を差し替えるのではなく、印を重ねる。** 手当ての有無で絵を差し替えると、怪我の部位 × 治療具の
 * 数だけ絵が要る（ScreenLayout.md カードの印 節）。
 */
const MARK_SIZE = 52;
const MARK_MARGIN = 18;
const STACK_COUNT_SIZE = 32;

/**
 * 枠の強調（CellHighlight）の太さ（u単位）。カードの矩形のすぐ外側にある余白——カード間ギャップの
 * 半分であり、レーンの左右の余白（SIZE.margin）とも同じ——をちょうど埋める。
 *
 * **カードの外側へ出すことで、カードが入っても隠れない。** カードより手前へ上げる手もあるが、それだと
 * 縁がスタック数の丸（addStackBadge）を横切る。数字はそのカードが何個かを表すもので、枠がどれかより
 * 先に読めるべきなので、縁の方が下がる。
 */
const CELL_HIGHLIGHT_WIDTH = SIZE.gap / 2;

/** カードへ重ねる文字の大きさ・板の内側の余白・紙の下端からの浮かせ方（u単位）。 */
const CELL_OVERLAY_SIZE = 40;
const CELL_OVERLAY_PADDING = 14;
const CELL_OVERLAY_BOTTOM = 20;
const CELL_OVERLAY_PLATE_ALPHA = 0.72;

/**
 * 製作中オブジェクトのカードにかぶせる青の濃さ（ScreenLayout.md 製作中オブジェクトのカード節）。
 *
 * **絵の上から重ねる**——`setTint`はCanvasレンダラで効かず（DesignNotes.md PhaserのWebGL専用機能節）、
 * 型ごとに染めた絵を焼くと製作中オブジェクトの数だけ絵が要るため。濃さは、絵が何かは読めるまま
 * 「まだ物になっていない」と分かる境で決める。
 */
const IN_PROGRESS_VEIL_ALPHA = 0.42;

/**
 * 耐久度バーの高さ（u単位）。ステータスバー（36u）とは比べ物にならない細さにする——どの道具にも
 * 常に出ているものなので、見に行けば読めるが視界には入らない、という控えめさに留める。
 */
const DURABILITY_BAR_HEIGHT = 6;

/**
 * そのカードの主要情報を映すバーの高さと、紙の左右から空ける余白・紙の下端から浮かせる高さ（u単位）。
 * 中身のバーと怪我のバーが同じ寸法・同じ位置を使う（1枚のカードが両方を出すことは無い）。
 */
const MAIN_BAR_HEIGHT = 15;
const MAIN_BAR_MARGIN = 28;
const MAIN_BAR_BOTTOM = 72;

/** 移動先のレーンがカードのどちら側にあるか。 */
export type CardEdgeDirection = 'up' | 'down';

/** 端の向き（上が先）。カードが出す端はこの順で調べる。 */
export const EDGE_DIRECTIONS: readonly CardEdgeDirection[] = ['up', 'down'];

/**
 * カードの端（上下1/6）を押したときの操作。1回の呼び出しで束のうち1つが動く。
 * 押し続けている間は繰り返し呼ばれる（addEdge参照）。
 */
export interface CardEdgeAction {
  readonly direction: CardEdgeDirection;
  readonly onTap: () => void;
}

/**
 * 量として存在する中身が入っているカードが出す、中身のバーの内容
 * （ScreenLayout.md カードの状態バー節）。空の容器はバーごと持たない。
 */
export interface CardFill {
  /** 容器の容量に対する中身の割合（0〜1）。 */
  readonly ratio: number;

  /** 塗りの色。中身の液体が自分で宣言している色（`color`プロパティ）そのもの。宣言していない液体はundefined。 */
  readonly color?: number;
}

/**
 * 怪我のカードが出す、残っている傷のバーの内容（ScreenLayout.md カードの状態バー節）。
 * 耐久度と違って**減るほど良い**量なので、色は値そのものではなく域（alert）から引く。
 */
export interface CardSeverity {
  /** 負った直後を1とした、残っている傷の割合（0〜1）。 */
  readonly ratio: number;

  /** 今の傷の重さの域。塗りの色になる。 */
  readonly alert: AlertLevel;
}

/** カード1枚の表示内容と操作。 */
export interface CardContent {
  readonly icon: string;
  readonly name: string;
  /**
   * 内容を差し替えたときに「前と同じカード」だと分かるための識別子（映しているインスタンスのID）。
   * 1枚が複数のインスタンス（スタック）を表すことがあるので集合で持ち、1つでも重なれば同じカードと
   * みなす。省略したカードは差し替えのたびに別のカードとして扱われる。
   */
  readonly identity?: readonly number[];
  /** 1枚が映しているインスタンスの数。2以上のときだけ、右上に丸で囲んだ数字として出す。 */
  readonly count?: number;
  /**
   * 絵を引くためのobject_defの識別子（objectArt参照）。その絵があれば枠の上に重ねて描き、
   * 無ければiconの絵文字で代用する。
   */
  readonly art?: string;
  /**
   * 地に敷く背景を引くための土地のobject_defの識別子（backgroundArt参照）。カードが「その土地に
   * 在るもの」だと分かるよう、絵の下に土地の景色を敷く。絵が無い土地では紙のまま。
   */
  readonly background?: string;
  /** カード全体を押したときの動作。持たないカードは押せない（押すと子ウィンドウを開くロケーションカード等）。 */
  readonly onTap?: () => void;
  /**
   * 端だけを押したときの動作（向きごとに1つ、最大2つ）。端ではカード全体の動作より優先される。
   * 上下の押せる範囲は重ならないので、両方向へ送れるカードは両方の端を持てる。
   */
  readonly edges?: readonly CardEdgeAction[];
  /** 掴んで他のカード・レーンへ落とせるカードか。ドラッグ中の扱いはCardDragController。 */
  readonly draggable?: boolean;
  /**
   * 名前を紙のどちら側へ寄せるか（既定は上）。主題が絵の上部にあるカード——顔が上端から始まる
   * キャラクタの肖像——だけが下を選ぶ。物の札の下半分は劣化度などの情報のために空けておく。
   */
  readonly namePosition?: 'top' | 'bottom';

  /**
   * 道のカードか（domainのpathタグ）。道は行き先の土地の名前と絵を出すので、そのままでは土地の
   * カードと見分けが付かない。左下の矢印だけがそれを区別する（ScreenLayout.md 設置物レーン節）。
   */
  readonly road?: boolean;

  /** 耐久度（0〜1）。耐久度を持たないカードはundefined（バーそのものを出さない）。 */
  readonly durability?: number;

  /** 中身の割合（液体容器のカードだけが持つ）。 */
  readonly fill?: CardFill;

  /** 残っている傷（怪我のカードだけが持つ）。 */
  readonly severity?: CardSeverity;

  /**
   * そのカードが映しているものの状態を表す絵文字の印（手当て済みの怪我の🩹など）。紙の左下へ小さく
   * 重ねる。持たないカードには何も出ない。
   */
  readonly mark?: string;

  /**
   * その行動の途中の値か（trueの間は状態バーの変化の帯を動かさず、合計の変化量を残す。
   * ProgressBar.setRatio参照）。
   */
  readonly midAction?: boolean;

  /**
   * まだ出来上がっていないもの（製作中オブジェクト）のカードか。青をかぶせ、土地の背景は敷かない
   * （ScreenLayout.md 製作中オブジェクトのカード節）。
   */
  readonly inProgress?: boolean;
}

/**
 * 見た目のぶんだけを取り出す（操作も識別子も引き継がない）。見せるためだけのカード——ドラッグ中の
 * 分身、探索で見つけたものの枠、スタックへ重なる1枚——を作るときに使う。
 */
export function cardFace(content: CardContent): CardContent {
  const { icon, name, art, background, namePosition, road, durability, fill, severity, mark } = content;
  const { inProgress } = content;
  return { icon, name, art, background, namePosition, road, durability, fill, severity, mark, inProgress };
}

/**
 * フィールド・ハンド・ポートレイトに共通のカード。
 * 大きなアイコンを中央に敷き、名前を左上へ重ねる（ScreenLayout.md デザインメモ）。
 */
export class Card extends Phaser.GameObjects.Container {
  private _content: CardContent;
  get content(): CardContent {
    return this._content;
  }

  /** カードの実寸。ドラッグ中の分身やドロップ先の枠を同じ大きさで描くために公開する。 */
  readonly cardWidth: number;
  readonly cardHeight: number;

  /** スタック数の表示。個数は差し替えのたびに変わるので、作り直さず書き換える。 */
  private readonly stackBadge: Phaser.GameObjects.Container;
  private readonly stackCount: Phaser.GameObjects.Text;

  /** 状態を表す絵文字の印（CardContent.mark）。持たないカードでは空文字で隠れる。 */
  private readonly mark: Phaser.GameObjects.Text;

  /** カードの名前。中身が入れ替われば同じインスタンスのままでも変わる（showName参照）。 */
  private readonly nameText: Phaser.GameObjects.Text;

  /** 道のカードだけに出す左下の矢印。出し入れは差し替えのたびに決まる（showNameが切り替える）。 */
  private readonly roadArrow: Phaser.GameObjects.Graphics;

  /**
   * 中身を入れ替える器。重なりの順序を殻の側で固定しておくことで、中身（絵・背景・端の操作エリア）が
   * 出入りしても順序が崩れない。
   */
  private readonly backgroundLayer: Phaser.GameObjects.Container;
  private readonly artLayer: Phaser.GameObjects.Container;
  private readonly edgeLayer: Phaser.GameObjects.Container;

  /** 製作中オブジェクトにかぶせる青（CardContent.inProgress）。それ以外のカードでは隠れる。 */
  private readonly inProgressVeil: Phaser.GameObjects.Graphics;

  /** 今その器に出しているもの。同じなら作り直さないための控え（showArt・showEdge参照）。 */
  private shownArt: string | undefined;
  private shownIcon: string | undefined;
  private shownBackground: string | undefined;
  private shownEdgeDirections = '';

  /**
   * 状態を表すバー。値を持たない間は隠すだけで、作り直さない——作り直すと、変わった分を遅れて
   * 追いつかせる動き（ProgressBar.setRatio）が途中で消えるため。
   */
  private readonly durabilityBar: ProgressBar;
  private readonly fillBar: ProgressBar;
  private readonly severityBar: ProgressBar;

  /** 中身を入れ直すときに要る採寸。 */
  private readonly metrics: ScreenMetrics;

  /** 端を押し続けている間の繰り返し（addEdge参照）と、既に1枚でも送ったかどうか。 */
  private readonly edgeRepeat: HoldRepeat;
  private edgeRepeated = false;

  /** 今の押下がタップでなくなったか（cancelTap参照）。押し始めるたびに戻す。 */
  private tapCancelled = false;

  /** 押下中だけ出す黒枠（makeTappable参照）。押せないカードは持たない。 */
  private pressHighlight: Phaser.GameObjects.Graphics | undefined;

  /**
   * ここで組み立てるのは**殻**——重なりの順序と、中身を入れる器だけ。何がどう見えるかは
   * `applyContent`（`setContent` と共通）が決める。初期表示も差し替えも同じ経路を通るので、
   * 反映の書き忘れは「後から古くなる」ではなく「最初から出ない」として現れる。
   */
  constructor(scene: Phaser.Scene, metrics: ScreenMetrics, x: number, y: number, content: CardContent) {
    super(scene, x, y);

    const width = metrics.px(SIZE.cardWidth);
    const height = metrics.px(SIZE.cardHeight);
    this._content = content;
    this.cardWidth = width;
    this.cardHeight = height;
    this.metrics = metrics;
    this.edgeRepeat = new HoldRepeat(scene);

    const face = addFrame(scene, metrics, width, height, false);
    // 土地の背景は絵より先に敷く。用意されていない土地では紙がそのまま地になる。
    this.backgroundLayer = scene.add.container(0, 0);
    this.artLayer = scene.add.container(0, 0);
    // 青は絵までを覆い、名前と状態のバーには掛けない。何が出来つつあるのかと、それが今どういう
    // 状態なのかは、覆いの下へ沈めずに読めるままにする。
    this.inProgressVeil = createInProgressVeil(scene, metrics, width, height);
    this.nameText = createNameText(scene, metrics, width, height);
    this.roadArrow = createRoadArrow(scene, metrics, width, height);
    this.add([face, this.backgroundLayer, this.artLayer, this.inProgressVeil, this.nameText, this.roadArrow]);

    // 状態のバーは絵より後に足して上へ重ねる（絵の濃淡に埋もれないようにするため）。
    this.durabilityBar = this.addDurabilityBar(scene, metrics, width, height);
    this.fillBar = this.addFillBar(scene, metrics, width, height);
    this.severityBar = this.addSeverityBar(scene, metrics, width, height);
    this.edgeLayer = scene.add.container(0, 0);
    this.add(this.edgeLayer);

    // 入力の配線だけは構築時に一度きり。押したときに何が起きるかは実行時に_contentから読む
    // （onTap・edges[].onTap）ので、差し替えで変わりうるのは「押せるかどうか」だけになる。
    if (content.onTap !== undefined || content.draggable === true) this.makeInteractive(width, height);
    if (content.onTap !== undefined) this.makeTappable(scene, metrics, width, height);
    // ドラッグはレーンの横スクロールと同じPhaserのdrag機構で受ける。重なった対象は最前面の1つだけが
    // 入力を受け取る（InputPlugin.topOnly）ため、カードを掴んでいる間レーンはスクロールしない。
    // 端の操作エリア（addEdge）はカードより手前にあってドラッグ対象ではないので、そこからは始まらない。
    if (content.draggable === true) scene.input.setDraggable(this);

    // 指を離した先がこのカードの外だと端のpointerupが来ないため、シーン全体の離上でも必ず止める。
    // 送り続けるものが残っているので、止め損なうと押していないのに動き続けてしまう。
    const stopEdgeRepeat = (): void => this.cancelEdgeRepeat();
    scene.input.on(Phaser.Input.Events.POINTER_UP, stopEdgeRepeat);
    this.once(Phaser.GameObjects.Events.DESTROY, () => {
      this.cancelEdgeRepeat();
      scene.input.off(Phaser.Input.Events.POINTER_UP, stopEdgeRepeat);
    });

    // スタック数は端の操作エリアより後に足して、オーバーレイが出ている間も読めるようにする。
    this.stackCount = scene.add
      .text(0, 0, '', {
        fontFamily: FONT_FAMILY,
        fontSize: `${metrics.fontPx(STACK_COUNT_SIZE)}px`,
        fontStyle: 'bold',
        color: cssColor(COLOR.text),
      })
      .setOrigin(0.5);
    this.stackBadge = this.addStackBadge(scene, metrics, width, height);
    this.add(this.stackBadge);

    // 状態の印もスタック数と同じく、端の操作エリアより後に足して隠れないようにする。
    const paper = paperRect(metrics, width, height);
    const markMargin = metrics.px(MARK_MARGIN);
    this.mark = scene.add
      .text(paper.x + markMargin, paper.y + paper.height - markMargin, '', {
        fontFamily: FONT_FAMILY,
        fontSize: `${metrics.fontPx(MARK_SIZE)}px`,
      })
      .setOrigin(0, 1);
    this.add(this.mark);

    this.applyContent(content, false);
    scene.add.existing(this);
  }

  /**
   * 同じインスタンスを映し続けるカードの表示内容を差し替える。カードが何を映しているかは、代表
   * （`represented_by`）が入れ替われば名前も絵も変わるため、**構築時の値をそのまま持ち続けてよい
   * ものは無い**という前提で全部を貼り直す。
   */
  setContent(content: CardContent): void {
    this.applyContent(content, true);
  }

  /**
   * 今の内容を殻へ流し込む。構築時（`showChange: false`）と差し替え時の両方が通る唯一の経路。
   *
   * showChangeは「この反映を、変化として見せるか」。現れたばかりのバーに変化の帯を出すと、見えて
   * いなかった間の増減が今この瞬間の変化として出てしまう（`StatusBar.show` と同じ理由）。
   */
  private applyContent(content: CardContent, showChange: boolean): void {
    this._content = content;
    this.showName(content);
    this.showArt(content);
    this.showBars(content, showChange);
    this.showEdge(content);
    this.showStackCount();
    this.mark.setText(content.mark ?? '');
    this.inProgressVeil.setVisible(content.inProgress === true);
  }

  /** 名前と、その寄せ位置。中身が入れ替われば名前は変わる（「ヤシの殻」⇔「水入りのヤシの殻」）。 */
  private showName(content: CardContent): void {
    const paper = paperRect(this.metrics, this.cardWidth, this.cardHeight);
    const margin = this.metrics.px(NAME_MARGIN);
    // 下寄せの名前は下端を固定して上へ伸ばす（行が増えても絵の下端との間が空かない）。
    const bottom = content.namePosition === 'bottom';
    this.nameText
      .setY(bottom ? paper.y + paper.height - margin : paper.y + margin)
      .setOrigin(0, bottom ? 1 : 0);
    if (this.nameText.text !== content.name) this.nameText.setText(content.name);
    this.roadArrow.setVisible(content.road === true);
  }

  /**
   * 絵と、その下に敷く土地の背景。絵があれば枠に重ね、無いあいだは絵文字で代用する
   * （絵は少しずつ用意されるため）。同じものを出し続ける間は作り直さない。
   *
   * 製作中オブジェクトには土地の背景を敷かない。青の覆いが読めるだけの無地の地が要るので、
   * 「その土地に在るもの」を表す景色より覆いの方を優先する（ScreenLayout.md 製作中オブジェクトの
   * カード節）。
   */
  private showArt(content: CardContent): void {
    const scene = this.scene;
    const background =
      content.background === undefined || content.inProgress === true
        ? undefined
        : cardBackgroundTexture(content.background);
    if (background !== this.shownBackground) {
      this.shownBackground = background;
      this.backgroundLayer.removeAll(true);
      if (background !== undefined && scene.textures.exists(background)) {
        this.backgroundLayer.add(placeArt(scene, background, this.cardWidth, this.cardHeight));
      }
    }

    const art = content.art === undefined ? undefined : objectTexture(content.art);
    if (art === this.shownArt && content.icon === this.shownIcon) return;
    this.shownArt = art;
    this.shownIcon = content.icon;

    this.artLayer.removeAll(true);
    if (art !== undefined && scene.textures.exists(art)) {
      this.artLayer.add(placeArt(scene, art, this.cardWidth, this.cardHeight));
      return;
    }
    this.artLayer.add(createIconText(scene, this.metrics, content.icon, this.cardWidth, this.cardHeight));
    if (art !== undefined) this.swapArtWhenLoaded(scene, art);
  }

  /**
   * 絵文字で代用中の絵が後から届いたら、自分で貼り替える。道のカードは行き先の土地の絵の
   * ロード完了（LocationArtLoader）を待たずに現れうるため。
   */
  private swapArtWhenLoaded(scene: Phaser.Scene, texture: string): void {
    const event = Phaser.Textures.Events.ADD_KEY + texture;
    const swap = (): void => {
      // 待っている間に映すものが変わっていれば、届いた絵はもうこのカードのものではない。
      if (this.shownArt !== texture) return;
      this.artLayer.removeAll(true);
      this.artLayer.add(placeArt(scene, texture, this.cardWidth, this.cardHeight));
    };
    scene.textures.once(event, swap);
    this.once(Phaser.GameObjects.Events.DESTROY, () => scene.textures.off(event, swap));
  }

  /** 状態のバー。値を持たない間は隠す（映すものが無いカードにバーは出さない）。 */
  private showBars(content: CardContent, showChange: boolean): void {
    const hold = content.midAction === true;
    this.showBar(this.durabilityBar, content.durability, showChange, hold);
    this.showBar(this.fillBar, content.fill?.ratio, showChange, hold);
    // 傷の重さは域が色を決めるので、割合より先に伝える（塗り直しを1回で済ませる）。
    if (content.severity !== undefined) this.severityBar.setAlert(content.severity.alert);
    this.showBar(this.severityBar, content.severity?.ratio, showChange, hold);
  }

  private showBar(bar: ProgressBar, ratio: number | undefined, showChange: boolean, hold: boolean): void {
    if (ratio === undefined) {
      bar.setVisible(false);
      return;
    }

    // 隠れていたバーが現れるときは、見えていなかった間の増減を今の変化として見せない。
    if (showChange && bar.visible) bar.setRatio(ratio, hold);
    else bar.resetRatio(ratio);
    bar.setVisible(true);
  }

  /**
   * 端の操作エリア。送れる先があるかどうかで付いたり外れたりする（`PlayScene.cardEdges`）ので、
   * 向きの組み合わせが変わったときだけ中身を入れ直す。押したときに何が起きるかは実行時に
   * `_content`から読む。
   */
  private showEdge(content: CardContent): void {
    const directions = EDGE_DIRECTIONS.filter((direction) => this.edgeActionFor(content, direction));
    const key = directions.join();
    if (key === this.shownEdgeDirections) return;

    this.shownEdgeDirections = key;
    this.cancelEdgeRepeat();
    this.edgeLayer.removeAll(true);
    for (const direction of directions) {
      this.addEdge(this.scene, this.metrics, this.cardWidth, this.cardHeight, direction);
    }
  }

  /** その向きの端を押したときの動作（その向きへ送れないならundefined）。 */
  private edgeActionFor(content: CardContent, direction: CardEdgeDirection): CardEdgeAction | undefined {
    return content.edges?.find((edge) => edge.direction === direction);
  }

  /**
   * 耐久度のバー。紙の下端の縁に接する形で、角の丸みに掛からない幅へ収める
   * （ScreenLayout.md カードの状態バー節）。
   */
  private addDurabilityBar(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    width: number,
    height: number,
  ): ProgressBar {
    const paper = paperRect(metrics, width, height);
    const barHeight = metrics.px(DURABILITY_BAR_HEIGHT);
    const inset = metrics.px(FRAME_RADIUS);
    const bar = new ProgressBar(
      scene,
      metrics,
      paper.x + inset,
      paper.y + paper.height - barHeight,
      paper.width - inset * 2,
      barHeight,
      0,
      // 枠線は数pxの太さの大半を占めてしまうので描かない。
      { fillColor: durabilityColorFor, borderless: true },
    );
    this.add(bar);
    return bar;
  }

  /** 中身のバー。カードの主要情報なので、下端へは付けず絵の下へ置く。 */
  private addFillBar(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    width: number,
    height: number,
  ): ProgressBar {
    return this.addMainBar(scene, metrics, width, height, {
      // 中身は入れ替わる（飲み干した水筒へ茶を注ぐ）ので、色は今の中身のものを引き直す。
      fillColor: () => this._content.fill?.color ?? COLOR.cardFillUnknown,
    });
  }

  /**
   * 残っている傷のバー。治るまでの残りは怪我カードの主要情報なので、道具の耐久度のような
   * 控えめな下端の細線ではなく、中身のバーと同じ太さ・同じ位置に出す。
   */
  private addSeverityBar(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    width: number,
    height: number,
  ): ProgressBar {
    // 減るほど良い量なので、増えた分の帯が赤くなるようにする（ProgressBarOptions.worsensUpward）。
    // 色は域から引く（fillColorを渡さない）ので、傷が引くほど緑へ寄る。
    return this.addMainBar(scene, metrics, width, height, { worsensUpward: true });
  }

  /** 主要情報のバー（中身・怪我）。絵の下・下端との間を空けた位置に、同じ寸法で置く。 */
  private addMainBar(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    width: number,
    height: number,
    options: ProgressBarOptions,
  ): ProgressBar {
    const paper = paperRect(metrics, width, height);
    const barHeight = metrics.px(MAIN_BAR_HEIGHT);
    const margin = metrics.px(MAIN_BAR_MARGIN);
    const bar = new ProgressBar(
      scene,
      metrics,
      paper.x + margin,
      paper.y + paper.height - metrics.px(MAIN_BAR_BOTTOM) - barHeight,
      paper.width - margin * 2,
      barHeight,
      0,
      options,
    );
    this.add(bar);
    return bar;
  }

  /**
   * スタック数を囲む丸。数字はスタックが増減しても位置が動かないよう、丸の中心へ固定する。
   * 絵の右上の角からわざと少しはみ出させる（カードに載せ切るより、札束の厚みとして目に付くため）。
   */
  private addStackBadge(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    width: number,
    height: number,
  ): Phaser.GameObjects.Container {
    const paper = paperRect(metrics, width, height);
    const radius = metrics.px(STACK_BADGE_SIZE) / 2;
    const offset = radius - metrics.px(STACK_BADGE_OVERHANG);

    const circle = scene.add.graphics();
    circle.fillStyle(COLOR.cardFace, 1);
    circle.fillCircle(0, 0, radius);
    circle.lineStyle(Math.max(1, metrics.px(3)), COLOR.cardBorder, 1);
    circle.strokeCircle(0, 0, radius);

    return scene.add.container(paper.x + paper.width - offset, paper.y + offset, [circle, this.stackCount]);
  }

  private showStackCount(): void {
    const count = this._content.count ?? 1;
    this.stackBadge.setVisible(count >= 2);
    this.stackCount.setText(String(count));
  }

  /** Containerのdisplay originによるヒット領域のずれを避ける理由はButtonと同じ（サイズを設定しない）。 */
  private makeInteractive(width: number, height: number): void {
    this.setInteractive(new Phaser.Geom.Rectangle(0, 0, width, height), Phaser.Geom.Rectangle.Contains);
  }

  /** 押下中は紙の縁を黒枠でなぞる。枠は紙の内側へ収める（paperStroke参照）。 */
  private makeTappable(scene: Phaser.Scene, metrics: ScreenMetrics, width: number, height: number): void {
    const highlight = scene.add.graphics().setVisible(false);
    const lineWidth = metrics.px(PRESSED_BORDER_WIDTH);
    const { rect, radius } = paperStroke(metrics, width, height, lineWidth);
    drawBox(highlight, rect, {
      border: COLOR.cardBorder,
      borderWidth: lineWidth,
      radius,
    });
    this.pressHighlight = highlight;
    this.add(highlight);

    onPressRelease(this, {
      onPress: () => {
        this.tapCancelled = false;
        highlight.setVisible(true);
      },
      onCancel: () => highlight.setVisible(false),
      onRelease: () => {
        highlight.setVisible(false);
        if (!this.tapCancelled) this._content.onTap?.();
      },
    });
  }

  /**
   * 今の押下をタップとして扱わない。掴んで動かす操作（カードのドラッグ・レーンの横スクロール）に
   * なったと分かった時点でCardDragControllerが呼ぶ。押下中の黒枠もここで引っ込める——押されている
   * ことを示す表示は、掴んだ時点で分身に役目を譲る。
   *
   * 押し始めたカードの上で指を離すと、動かしていてもタップとして成立してしまう（tap.ts）。
   * スタックの上の1枚を自分の位置へ重ねる操作（石と石の組み合わせ）や、カードを掴んだままの
   * レーンの横スクロールがこれに当たり、そのままでは操作のたびに子ウィンドウが開いてしまう。
   */
  cancelTap(): void {
    this.tapCancelled = true;
    this.pressHighlight?.setVisible(false);
  }

  /**
   * 隣のレーンへ移すための端の操作エリア。押している間だけ半透明のオーバーレイと矢印を出し、
   * どちら向きの操作なのかを示す。
   *
   * 押し続けると、指を離さないまま1枚目が動き、そのあとは間隔を詰めながら送り続ける
   * （HoldRepeat）。短く押して離した場合だけ、離した時点で1枚動かす——
   * 押し続けて既に動き出しているなら、離したぶんをもう1枚足すことにはならない。
   *
   * ヒット領域はカード本体の後に足す。重なった対象のうち描画順が最前面の1つだけが入力を受け取る
   * （InputPlugin.topOnly）ため、これで端はカード全体の操作もドラッグも横取りする。透明でも描画される
   * Rectangleを使うのは、Zoneが描画リストへ載らず前後関係が決まらないため。
   */
  private addEdge(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    width: number,
    height: number,
    direction: CardEdgeDirection,
  ): void {
    const up = direction === 'up';
    const paper = paperRect(metrics, width, height);
    const edgeHeight = paper.height * EDGE_RATIO;
    const top = up ? paper.y : paper.y + paper.height - edgeHeight;
    const radius = metrics.px(FRAME_RADIUS);

    const overlay = scene.add.graphics();
    overlay.fillStyle(COLOR.cardEdgeOverlay, EDGE_OVERLAY_ALPHA);
    overlay.fillRoundedRect(
      paper.x,
      top,
      paper.width,
      edgeHeight,
      up ? { tl: radius, tr: radius, bl: 0, br: 0 } : { tl: 0, tr: 0, bl: radius, br: radius },
    );

    const arrow = scene.add
      .text(width / 2, top + edgeHeight / 2, up ? '▲' : '▼', {
        fontFamily: FONT_FAMILY,
        fontSize: `${metrics.fontPx(EDGE_ARROW_SIZE)}px`,
        color: cssColor(COLOR.textOnDark),
      })
      .setOrigin(0.5);

    const feedback = scene.add.container(0, 0, [overlay, arrow]).setVisible(false);
    // 押せる範囲はカードの矩形いっぱいまで広げる。絵の余白は見た目だけのもので、そこを押しても
    // 端を押したことにしたいため。
    const hitArea = scene.add
      .rectangle(0, up ? 0 : top, width, up ? top + edgeHeight : height - top)
      .setOrigin(0, 0)
      .setInteractive();

    onPressRelease(hitArea, {
      onPress: () => {
        feedback.setVisible(true);
        this.startEdgeRepeat(direction);
      },
      onCancel: () => {
        feedback.setVisible(false);
        this.cancelEdgeRepeat();
      },
      onRelease: () => {
        feedback.setVisible(false);
        const moved = this.edgeRepeated;
        this.cancelEdgeRepeat();
        if (!moved) this.edgeActionFor(this._content, direction)?.onTap();
      },
    });

    this.edgeLayer.add([feedback, hitArea]);
  }

  /** 押し続けの繰り返しを始める。速さはHoldRepeatが持つ。 */
  private startEdgeRepeat(direction: CardEdgeDirection): void {
    this.edgeRepeated = false;
    this.edgeRepeat.start(() => {
      const edge = this.edgeActionFor(this._content, direction);
      if (edge === undefined) return false;

      this.edgeRepeated = true;
      edge.onTap();
      // 送った結果このカードが空になっていれば、破棄されていてもう続けられない。
      return this.scene !== undefined;
    });
  }

  /** 繰り返しを止める。edgeRepeatedは離したときの判断に使うので、ここでは触らない。 */
  private cancelEdgeRepeat(): void {
    this.edgeRepeat.stop();
  }
}

/**
 * 中身の無い固定枠を示すカード。枠数を決めたスロット（cell_count、SlotSystem.md 3節）は空でも位置を
 * 保つため、枠だけを破線で描いて「ここは空いている」と分かるようにする。
 *
 * acceptsを渡すと、紙の代わりにその物のカードを薄く敷く。何を入れる枠なのかは、名前と絵が一番早く
 * 伝えるため。破線はどちらでも同じ濃さで重ねる——薄めると「まだ空いている」ことが読み取れなくなる。
 */
export class EmptyCard extends Phaser.GameObjects.Container {
  constructor(scene: Phaser.Scene, metrics: ScreenMetrics, x: number, y: number, accepts?: CardContent) {
    super(scene, x, y);

    const width = metrics.px(SIZE.cardWidth);
    const height = metrics.px(SIZE.cardHeight);

    if (accepts === undefined) {
      this.add(addFrame(scene, metrics, width, height, true));
    } else {
      this.add(new Card(scene, metrics, 0, 0, cardFace(accepts)).setAlpha(EMPTY_FRAME_ALPHA));
      this.add(emptyOutline(scene, metrics, width, height));
    }

    scene.add.existing(this);
  }
}

/**
 * 枠そのものを色で強調する縁（ScreenLayout.md 枠（セル）は一級の単位 節の1層目）。
 * **カードの矩形の外側を回る**ので、枠にカードが入っても隠れない（CELL_HIGHLIGHT_WIDTH参照）。
 */
export class CellHighlight extends Phaser.GameObjects.Graphics {
  constructor(scene: Phaser.Scene, metrics: ScreenMetrics, x: number, y: number, color: number) {
    super(scene, { x, y });

    const width = Math.max(1, metrics.px(CELL_HIGHLIGHT_WIDTH));
    // 線は経路の上に太さの半分ずつ広がるので、経路をカードの矩形から半分だけ外へ出すと、線は
    // カードに一切かからずその外側だけを埋める。角の丸みも紙の輪郭と同心になるよう外へ足す。
    const inset = width / 2;
    drawBox(
      this,
      {
        x: -inset,
        y: -inset,
        width: metrics.px(SIZE.cardWidth) + width,
        height: metrics.px(SIZE.cardHeight) + width,
      },
      {
        border: color,
        borderWidth: width,
        radius: metrics.px(FRAME_INSET + FRAME_RADIUS + CELL_HIGHLIGHT_WIDTH / 2),
      },
    );

    scene.add.existing(this);
  }
}

/**
 * 枠がカードの上へ重ねる短い文字（ScreenLayout.md 枠（セル）は一級の単位 節の3層目）。
 * **カードが入っていても隠れない**ことがこの層の役目なので、カードより手前へ置く（CardLane）。
 */
export class CellOverlay extends Phaser.GameObjects.Container {
  constructor(scene: Phaser.Scene, metrics: ScreenMetrics, x: number, y: number, overlay: string) {
    super(scene, x, y);

    const width = metrics.px(SIZE.cardWidth);
    const height = metrics.px(SIZE.cardHeight);
    this.add(this.makeBadge(scene, metrics, paperRect(metrics, width, height), overlay));

    scene.add.existing(this);
  }

  /**
   * 重ねる文字。**暗い板に明るい文字**を載せる——下に来るのは絵のあるカードとも空き枠とも決まって
   * いないので、地の明るさによらず読める組み合わせにする。板の幅は文字に合わせて決める。
   */
  private makeBadge(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    paper: Rect,
    overlay: string,
  ): Phaser.GameObjects.Container {
    const text = scene.add
      .text(0, 0, overlay, {
        fontFamily: FONT_FAMILY,
        fontSize: `${metrics.fontPx(CELL_OVERLAY_SIZE)}px`,
        fontStyle: 'bold',
        color: cssColor(COLOR.textOnDark),
      })
      .setOrigin(0.5);

    const padding = metrics.px(CELL_OVERLAY_PADDING);
    const badgeHeight = text.height + padding;
    const badgeWidth = text.width + padding * 2;
    const plate = scene.add.graphics();
    drawBox(
      plate,
      { x: -badgeWidth / 2, y: -badgeHeight / 2, width: badgeWidth, height: badgeHeight },
      { fill: COLOR.cellOverlayPlate, fillAlpha: CELL_OVERLAY_PLATE_ALPHA, radius: badgeHeight / 2 },
    );

    return scene.add.container(
      paper.x + paper.width / 2,
      paper.y + paper.height - metrics.px(CELL_OVERLAY_BOTTOM) - badgeHeight / 2,
      [plate, text],
    );
  }
}

/** 空き枠であることを示す破線。薄く敷いたもの（紙・受け入れる物のカード）の上へ、薄めずに重ねる。 */
function emptyOutline(
  scene: Phaser.Scene,
  metrics: ScreenMetrics,
  width: number,
  height: number,
): Phaser.GameObjects.Graphics {
  const outline = scene.add.graphics();
  const lineWidth = Math.max(1, metrics.px(2));
  const { rect, radius } = paperStroke(metrics, width, height, lineWidth);
  drawBox(outline, rect, {
    border: COLOR.cardBorder,
    borderWidth: lineWidth,
    radius,
    dashed: true,
  });
  return outline;
}

/**
 * カードの枠。画像（CARD_FRAME_TEXTURE）があればそれを矩形いっぱいに貼り、無ければ図形で描く。
 * 画像を差し替えたり用意しなかったりしても画面が成り立つよう、図形の描画は残してある。
 *
 * emptyは中身の無い枠（EmptyCard）。画像なら薄く敷き、図形なら破線で描く。
 */
function addFrame(
  scene: Phaser.Scene,
  metrics: ScreenMetrics,
  width: number,
  height: number,
  empty: boolean,
): Phaser.GameObjects.GameObject {
  if (scene.textures.exists(CARD_FRAME_TEXTURE)) {
    const image = scene.add.image(0, 0, CARD_FRAME_TEXTURE).setOrigin(0, 0).setDisplaySize(width, height);
    if (!empty) return image;

    // 空き枠は紙を薄く敷いたうえに破線を重ねる。薄いだけだと明るい下地（子ウィンドウの台紙）で
    // ほとんど見えず、「枠がいくつあるか」が伝わらないため。
    image.setAlpha(EMPTY_FRAME_ALPHA);
    return scene.add.container(0, 0, [image, emptyOutline(scene, metrics, width, height)]);
  }

  const face = scene.add.graphics();
  drawBox(face, paperRect(metrics, width, height), {
    fill: COLOR.cardFace,
    fillAlpha: empty ? 0.35 : 0.85,
    border: COLOR.cardBorder,
    borderWidth: Math.max(1, metrics.px(2)),
    radius: metrics.px(FRAME_RADIUS),
    dashed: empty,
  });
  return face;
}

/**
 * object_defの絵をカードの中央へ置く。
 *
 * 絵の大きさは画像そのものの寸法で決まる（CARD_ART_WIDTH参照）。小石は小さい画像、地形はカードと
 * 同じ縦横比の大きい画像で、どちらもこの一つの規則で正しい大きさになる。
 */
function placeArt(
  scene: Phaser.Scene,
  texture: string,
  width: number,
  height: number,
): Phaser.GameObjects.Image {
  const image = scene.add.image(width / 2, height / 2, texture).setOrigin(0.5);
  const scale = width / CARD_ART_WIDTH;
  return image.setDisplaySize(image.width * scale, image.height * scale);
}

/**
 * 名前の文字。中身は空で作り、何を出すかはshowNameが決める（殻だけを組み立てる、constructor参照）。
 * 折り返しの幅だけはカードの寸法で決まるのでここで与える。
 */
function createNameText(
  scene: Phaser.Scene,
  metrics: ScreenMetrics,
  width: number,
  height: number,
): Phaser.GameObjects.Text {
  const paper = paperRect(metrics, width, height);
  const margin = metrics.px(NAME_MARGIN);
  const stroke = Math.max(1, metrics.px(NAME_STROKE));
  const text = scene.add
    .text(paper.x + margin, 0, '', {
      fontFamily: FONT_FAMILY,
      fontSize: `${metrics.fontPx(30)}px`,
      fontStyle: 'bold',
      color: cssColor(COLOR.text),
      maxLines: NAME_MAX_LINES,
    })
    .setLineSpacing(metrics.px(2))
    .setStroke(cssColor(COLOR.cardFace), stroke);
  // 縁取りは文字の外側へ太さの半分だけ広がる。折り返し幅から引いて、右端の余白を左端と揃える。
  text.setWordWrapCallback(wrapByCharacter(paper.width - margin * 2 - stroke));
  return text;
}

/**
 * 道のカードの左下に出す矢印。**白い塗りに黒い縁**で、どんな絵の上でも輪郭が残るようにする。
 *
 * 線ではなく塗り潰した矢羽根にするのは、細い線だとカードを縮めて並べたときに何の形か読み取れなく
 * なるため。
 */
function createRoadArrow(
  scene: Phaser.Scene,
  metrics: ScreenMetrics,
  width: number,
  height: number,
): Phaser.GameObjects.Graphics {
  const paper = paperRect(metrics, width, height);
  const margin = metrics.px(ROAD_ARROW_MARGIN);
  const w = metrics.px(ROAD_ARROW_WIDTH);
  const h = metrics.px(ROAD_ARROW_HEIGHT);
  const left = paper.x + margin;
  const top = paper.y + paper.height - margin - h;

  // 軸の高さは矢印の高さの42%。残りを矢尻の張り出しに使う。
  const shaftTop = top + h * 0.29;
  const shaftBottom = top + h * 0.71;
  const headLeft = left + w * 0.55;
  const points = [
    [left, shaftTop],
    [headLeft, shaftTop],
    [headLeft, top],
    [left + w, top + h / 2],
    [headLeft, top + h],
    [headLeft, shaftBottom],
    [left, shaftBottom],
  ].map(([x, y]) => new Phaser.Math.Vector2(x, y));

  const arrow = scene.add.graphics();
  arrow.fillStyle(COLOR.cardFace, 1);
  arrow.lineStyle(Math.max(1, metrics.px(ROAD_ARROW_STROKE)), COLOR.cardBorder, 1);
  arrow.fillPoints(points, true);
  arrow.strokePoints(points, true);
  return arrow.setVisible(false);
}

/**
 * 製作中オブジェクトのカードにかぶせる青（IN_PROGRESS_VEIL_ALPHA参照）。紙の輪郭に合わせて角を
 * 丸め、枠の線の内側へ収める。
 */
function createInProgressVeil(
  scene: Phaser.Scene,
  metrics: ScreenMetrics,
  width: number,
  height: number,
): Phaser.GameObjects.Graphics {
  const veil = scene.add.graphics();
  drawBox(veil, paperRect(metrics, width, height), {
    fill: COLOR.cardInProgress,
    fillAlpha: IN_PROGRESS_VEIL_ALPHA,
    radius: metrics.px(FRAME_RADIUS),
  });
  return veil.setVisible(false);
}

/** 絵の代わりに出す絵文字（showArt参照）。 */
function createIconText(
  scene: Phaser.Scene,
  metrics: ScreenMetrics,
  icon: string,
  width: number,
  height: number,
): Phaser.GameObjects.Text {
  return scene.add
    .text(width / 2, height / 2, icon, {
      fontFamily: FONT_FAMILY,
      fontSize: `${metrics.fontPx(96)}px`,
    })
    .setOrigin(0.5)
    .setAlpha(0.95);
}

/** カードの矩形の中で、絵の紙が占める範囲（FRAME_INSET参照）。 */
function paperRect(metrics: ScreenMetrics, width: number, height: number): Rect {
  const inset = metrics.px(FRAME_INSET);
  return { x: inset, y: inset, width: width - inset * 2, height: height - inset * 2 };
}

/**
 * 紙の輪郭をなぞる線の経路と角の丸み。**線の外周が紙の縁とちょうど重なる**よう、経路を線の太さの
 * 半分だけ内側へ寄せる（角の丸みも同じだけ小さくして同心にする）。
 *
 * 絵の紙は縁からいきなり不透明で始まる（card_frame.pngの実測で、410px幅の絵の5px目でアルファが
 * 255になる＝FRAME_INSETの2.5u）。線は経路の上に太さの半分ずつ広がるので、経路を紙の縁そのものに
 * 置くと線の外半分が紙の外へ出て、輪郭が実物のカードより一回り大きく見える。塗り（inProgressVeil）は
 * 経路が縁そのものなので、こちらを通さない。
 */
function paperStroke(
  metrics: ScreenMetrics,
  width: number,
  height: number,
  lineWidth: number,
): { readonly rect: Rect; readonly radius: number } {
  const paper = paperRect(metrics, width, height);
  const inset = lineWidth / 2;
  return {
    rect: {
      x: paper.x + inset,
      y: paper.y + inset,
      width: paper.width - lineWidth,
      height: paper.height - lineWidth,
    },
    radius: Math.max(0, metrics.px(FRAME_RADIUS) - inset),
  };
}
