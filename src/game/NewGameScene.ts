import type { Rect } from './looks/ScreenMetrics';
import { ResponsiveScene } from './ResponsiveScene';
import { LOCALIZATION_KEY, WORLD_CODEX_KEY } from './BootScene';
import type { WorldCodex } from '../domain/defs/WorldCodex';
import type { Localization } from '../locale/Localization';
import { characterDefNames } from '../domain/generation/NewGame';
import { randomRng } from '../domain/runtime/Rng';
import { ISLAND_NAME_MAX_LENGTH, SEED_MAX } from '../save/SaveData';
import { SaveSlots } from '../save/SaveSlots';
import {
  createSaveData,
  normalizeIslandName,
  parseSeed,
  randomCharacter,
  randomIslandName,
  randomSeed,
} from '../save/newGameInput';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { characterCardContent } from './view/characterCard';
import { ModalDialog } from './ui/ModalDialog';
import { ScreenHeader } from './ui/ScreenHeader';
import { TextInput } from './ui/TextInput';
import { addLabel } from './ui/labels';
import { addPanel } from './ui/shapes';
import { wrapByCharacter } from './ui/textLayout';
import { COLOR, SIZE } from './looks/theme';

/** 本文の余白と項目間の間隔（StartScreen_Mock.htmlの.newgame-body）。横型は左右を広く取る。 */
const BODY_PADDING = 28;
const BODY_PADDING_LANDSCAPE_X = 96;
const FIELD_GAP = 32;
const LABEL_GAP = 10;

/** 入力欄・ランダムボタン・キャラクター選択肢・フッターボタンの寸法。 */
const INPUT_HEIGHT = 72;
const RANDOM_BUTTON_SIZE = 72;
const CHARACTER_OPTION_PADDING = 12;
const FOOTER_BUTTON_HEIGHT = 80;
const FOOTER_PADDING_Y = 20;

/**
 * 選んだ人物の説明の文字の大きさ（u単位）と、常に空けておく行数。
 * 高さを行数で固定しておくと、説明の長さが違う人物へ選び替えても札の位置が動かない。
 */
const CHARACTER_DESCRIPTION_SIZE = 26;
const CHARACTER_DESCRIPTION_LINES = 3;

/** 項目名（「島の名前」など）の文字の大きさ（u単位）。 */
const FIELD_LABEL_SIZE = 26;

/**
 * 左右に分けるときの列の間隔と、入力欄の列に要る最低幅（u単位）。
 * 札を原寸で並べたうえでこの幅が残らないなら、分けずに上から積む。
 */
const COLUMN_GAP = 40;
const FIELD_COLUMN_MIN_WIDTH = 440;

/** 新規ゲーム作成画面を開くときに渡す、書き込み先のスロット番号。 */
export interface NewGameSceneData {
  readonly slotIndex: number;
}

/**
 * 新規ゲーム作成画面（StartScreen.md 画面構成 3）。
 * 島の名前・乱数シード・キャラクターの3項目を入力し、ランダム入力ボタンは値を埋めるだけで
 * 手直しを妨げない。入力内容は画面の作り直し（向きの変更）をまたいで保持する。
 */
export class NewGameScene extends ResponsiveScene {
  private slotIndex = 0;
  private islandName = '';
  private seedText = '';
  private characterId: string | undefined;

  /** いずれもinitで必ず設定される（Phaserはinit→createの順に呼ぶ）。 */
  private locale!: Localization;
  private characters!: readonly string[];

  private nameInput: TextInput | undefined;
  private seedInput: TextInput | undefined;

  /** キャラクター選択肢は選択状態が変わるたびに描き直すため、置き場所と生成物を覚えておく。 */
  private characterOptionsOrigin: Rect = { x: 0, y: 0, width: 0, height: 0 };
  private characterOptions: Button[] = [];

  /** 選んだ人物の説明。選択肢と一緒に作り直す。 */
  private characterDescription: Phaser.GameObjects.Text | undefined;

  constructor() {
    super('newgame');
  }

  init(data: NewGameSceneData): void {
    this.locale = this.registry.get(LOCALIZATION_KEY) as Localization;
    this.characters = characterDefNames(this.registry.get(WORLD_CODEX_KEY) as WorldCodex);
    this.slotIndex = data.slotIndex;
    this.islandName = '';
    this.characterId = undefined;
    this.seedText = String(randomSeed(randomRng()));
  }

  protected build(): void {
    const { width, height } = this.metrics;
    addPanel(this, { x: 0, y: 0, width, height }, COLOR.screenBackground);
    new ScreenHeader(this, this.metrics, width, '新規ゲーム作成', () => this.scene.start('slots'));

    const paddingX = this.metrics.px(this.metrics.isLandscape ? BODY_PADDING_LANDSCAPE_X : BODY_PADDING);
    const contentWidth = width - paddingX * 2;
    const top = ScreenHeader.height(this.metrics) + this.metrics.px(BODY_PADDING);

    this.nameInput = undefined;
    this.seedInput = undefined;
    this.characterOptions = [];

    // 横が余って縦が足りない画面では、入力欄とキャラクター選択を左右へ分ける。分けるのは、札を原寸で
    // 並べたうえで入力欄に足る幅が残るときだけ——正方形に近い画面で無理に分けると札が原寸より小さくなる。
    const columnGap = this.metrics.px(COLUMN_GAP);
    const characterWidth = this.characterRowWidth();
    const fieldWidth = contentWidth - columnGap - characterWidth;
    if (this.metrics.isLandscape && fieldWidth >= this.metrics.px(FIELD_COLUMN_MIN_WIDTH)) {
      // 縦は逆に余るので、背の高い方の列に合わせて、ヘッダーとフッターの間の中央へ両方を置く。
      const band = height - this.footerHeight() - top - this.metrics.px(BODY_PADDING);
      const used = Math.max(this.textFieldsHeight(), this.characterFieldHeight(characterWidth));
      const y = top + Math.max(0, (band - used) / 2);
      this.addTextFields(paddingX, y, fieldWidth);
      this.addCharacterField(paddingX + fieldWidth + columnGap, y, characterWidth);
    } else {
      const used = this.addTextFields(paddingX, top, contentWidth);
      this.addCharacterField(paddingX, top + used + this.metrics.px(FIELD_GAP), contentWidth);
    }

    this.addFooter();
  }

  /** 島の名前と乱数シードを縦に並べ、占有した高さを返す。 */
  private addTextFields(x: number, y: number, width: number): number {
    let cursorY = y;
    cursorY += this.addTextField(x, cursorY, width, '島の名前', {
      value: this.islandName,
      placeholder: '例: 霧深い孤島',
      maxLength: ISLAND_NAME_MAX_LENGTH,
      onChange: (value) => {
        this.islandName = value;
      },
      keep: (input) => {
        this.nameInput = input;
      },
      onRandom: () => {
        this.islandName = randomIslandName(randomRng());
        this.nameInput?.setValue(this.islandName);
      },
    });

    cursorY += this.metrics.px(FIELD_GAP);
    cursorY += this.addTextField(x, cursorY, width, '乱数シード', {
      value: this.seedText,
      placeholder: '例: 1837462519',
      maxLength: String(SEED_MAX).length,
      numeric: true,
      onChange: (value) => {
        this.seedText = value;
      },
      keep: (input) => {
        this.seedInput = input;
      },
      onRandom: () => {
        this.seedText = String(randomSeed(randomRng()));
        this.seedInput?.setValue(this.seedText);
      },
    });

    return cursorY - y;
  }

  /** 札を原寸で並べたときのキャラクター選択の幅。左右に分けるときはこの幅をそのまま右の列に使う。 */
  private characterRowWidth(): number {
    const option = this.metrics.px(SIZE.cardWidth) + this.metrics.px(CHARACTER_OPTION_PADDING) * 2;
    return option * this.characters.length + this.metrics.px(SIZE.gap) * (this.characters.length - 1);
  }

  /** 入力欄2つぶんの高さ。 */
  private textFieldsHeight(): number {
    const row = this.labelHeight() + this.metrics.px(LABEL_GAP) + this.metrics.px(INPUT_HEIGHT);
    return row * 2 + this.metrics.px(FIELD_GAP);
  }

  /** キャラクター選択（ラベルの行・札の行・説明）の高さ。 */
  private characterFieldHeight(width: number): number {
    const optionWidth = this.characterOptionWidth(width);
    const padding = this.metrics.px(CHARACTER_OPTION_PADDING);
    const rowHeight =
      ((optionWidth - padding * 2) / this.metrics.px(SIZE.cardWidth)) * this.metrics.px(SIZE.cardHeight) +
      padding * 2;
    const lineSpacing = this.metrics.px(LABEL_GAP);
    return (
      this.metrics.px(RANDOM_BUTTON_SIZE) +
      lineSpacing +
      rowHeight +
      this.metrics.px(SIZE.gap) +
      this.characterDescriptionHeight(lineSpacing)
    );
  }

  /** 横幅だけで決まる選択肢1つの幅。札は原寸を上限に、全員が1行へ収まるところまで縮める。 */
  private characterOptionWidth(width: number): number {
    const padding = this.metrics.px(CHARACTER_OPTION_PADDING);
    return Math.min(
      this.metrics.px(SIZE.cardWidth) + padding * 2,
      (width - this.metrics.px(SIZE.gap) * (this.characters.length - 1)) / this.characters.length,
    );
  }

  /** 項目名1行の高さ。組み立てる前に列の高さを見積もるために測る。 */
  private labelHeight(): number {
    const sample = addLabel(this, this.metrics, 0, 0, 'あ', { size: FIELD_LABEL_SIZE, bold: true });
    const height = sample.height;
    sample.destroy();
    return height;
  }

  /** ラベル＋入力欄＋ランダムボタンの1項目を置き、占有した高さを返す。 */
  private addTextField(
    x: number,
    y: number,
    width: number,
    label: string,
    field: {
      value: string;
      placeholder: string;
      maxLength: number;
      numeric?: boolean;
      onChange: (value: string) => void;
      keep: (input: TextInput) => void;
      onRandom: () => void;
    },
  ): number {
    const labelText = addLabel(this, this.metrics, x, y, label, { size: FIELD_LABEL_SIZE, bold: true });
    const rowY = y + labelText.height + this.metrics.px(LABEL_GAP);
    const inputHeight = this.metrics.px(INPUT_HEIGHT);
    const buttonSize = this.metrics.px(RANDOM_BUTTON_SIZE);
    const inputWidth = width - buttonSize - this.metrics.px(SIZE.gap);

    field.keep(
      new TextInput(
        this,
        this.metrics,
        { x, y: rowY, width: inputWidth, height: inputHeight },
        {
          value: field.value,
          placeholder: field.placeholder,
          maxLength: field.maxLength,
          numeric: field.numeric,
          onChange: field.onChange,
        },
      ),
    );
    this.addRandomButton(x + inputWidth + this.metrics.px(SIZE.gap), rowY, field.onRandom);

    return labelText.height + this.metrics.px(LABEL_GAP) + inputHeight;
  }

  private addRandomButton(x: number, y: number, onTap: () => void): void {
    const size = this.metrics.px(RANDOM_BUTTON_SIZE);
    const button = new Button(
      this,
      { x, y, width: size, height: size },
      {
        fill: COLOR.randomButton,
        border: COLOR.buttonBorder,
        borderWidth: Math.max(1, this.metrics.px(2)),
        radius: this.metrics.px(SIZE.radius),
      },
      onTap,
    );
    button.addContent(addLabel(this, this.metrics, size / 2, size / 2, '🎲', { size: 32 }).setOrigin(0.5));
  }

  private addCharacterField(x: number, y: number, width: number): void {
    const buttonSize = this.metrics.px(RANDOM_BUTTON_SIZE);
    const labelText = addLabel(this, this.metrics, x, 0, 'キャラクター選択', {
      size: FIELD_LABEL_SIZE,
      bold: true,
    });
    labelText.setY(y + (buttonSize - labelText.height) / 2);
    this.addRandomButton(x + width - buttonSize, y, () => {
      this.characterId = randomCharacter(randomRng(), this.characters);
      this.refreshCharacterOptions();
    });

    this.characterOptionsOrigin = {
      x,
      y: y + buttonSize + this.metrics.px(LABEL_GAP),
      width,
      height: 0,
    };
    this.refreshCharacterOptions();
  }

  /** 選択中の枠線と説明だけが変わるので、選択肢は作り直して置き換える。 */
  private refreshCharacterOptions(): void {
    for (const option of this.characterOptions) option.destroy();

    const gap = this.metrics.px(SIZE.gap);
    const padding = this.metrics.px(CHARACTER_OPTION_PADDING);
    const cardWidth = this.metrics.px(SIZE.cardWidth);
    const cardHeight = this.metrics.px(SIZE.cardHeight);
    const lineSpacing = this.metrics.px(LABEL_GAP);
    const descriptionHeight = this.characterDescriptionHeight(lineSpacing);
    // 説明とフッターに使う分を除いた、選択肢の1行が使える高さ。
    const room =
      this.metrics.height - this.footerHeight() - descriptionHeight - gap - this.characterOptionsOrigin.y;
    // 横は原寸まで（characterOptionWidth）、縦は説明の下がフッターへ潜り込まないところまで縮める。
    const optionWidth = Math.min(
      this.characterOptionWidth(this.characterOptionsOrigin.width),
      ((room - padding * 2) / cardHeight) * cardWidth + padding * 2,
    );
    const cardScale = (optionWidth - padding * 2) / cardWidth;
    const height = cardHeight * cardScale + padding * 2;

    this.characterOptions = this.characters.map((character, index) =>
      this.addCharacterOption(
        this.characterOptionsOrigin.x + index * (optionWidth + gap),
        this.characterOptionsOrigin.y,
        optionWidth,
        height,
        character,
        cardScale,
      ),
    );
    this.refreshCharacterDescription(this.characterOptionsOrigin.y + height + gap, lineSpacing);
  }

  private addCharacterOption(
    x: number,
    y: number,
    width: number,
    height: number,
    character: string,
    cardScale: number,
  ): Button {
    const selected = character === this.characterId;
    const button = new Button(
      this,
      { x, y, width, height },
      {
        fill: selected ? COLOR.selectedOptionFace : COLOR.cardFace,
        border: selected ? COLOR.selectedOptionBorder : COLOR.cardFace,
        borderWidth: this.metrics.px(2),
        radius: this.metrics.px(SIZE.radius),
      },
      () => {
        this.characterId = character;
        this.refreshCharacterOptions();
      },
    );

    const padding = this.metrics.px(CHARACTER_OPTION_PADDING);
    const card = new Card(this, this.metrics, padding, padding, characterCardContent(character, this.locale));
    button.addContent(card.setScale(cardScale));
    return button;
  }

  /**
   * 選んでいる人物の説明を、選択肢の下へ出す。札には名前しか載らないので、どういう人物なのかは
   * ここで見せる。まだ選んでいない間は空にする。
   */
  private refreshCharacterDescription(y: number, lineSpacing: number): void {
    this.characterDescription?.destroy();

    const description =
      this.characterId === undefined ? '' : (this.locale.object(this.characterId).description ?? '');
    this.characterDescription = addLabel(this, this.metrics, this.characterOptionsOrigin.x, y, description, {
      size: CHARACTER_DESCRIPTION_SIZE,
    }).setLineSpacing(lineSpacing);
    this.characterDescription.setWordWrapCallback(wrapByCharacter(this.characterOptionsOrigin.width));
  }

  /** 説明のために常に空けておく高さ（CHARACTER_DESCRIPTION_LINES行ぶん）。 */
  private characterDescriptionHeight(lineSpacing: number): number {
    const sample = addLabel(this, this.metrics, 0, 0, 'あ', { size: CHARACTER_DESCRIPTION_SIZE });
    const height =
      sample.height * CHARACTER_DESCRIPTION_LINES + lineSpacing * (CHARACTER_DESCRIPTION_LINES - 1);
    sample.destroy();
    return height;
  }

  /** フッターの高さ。キャラクター欄がどこまで下を使えるかの計算にも要る。 */
  private footerHeight(): number {
    return this.metrics.px(FOOTER_BUTTON_HEIGHT) + this.metrics.px(FOOTER_PADDING_Y) * 2;
  }

  private addFooter(): void {
    const { width, height } = this.metrics;
    const buttonHeight = this.metrics.px(FOOTER_BUTTON_HEIGHT);
    const paddingX = this.metrics.px(BODY_PADDING);
    const paddingY = this.metrics.px(FOOTER_PADDING_Y);
    const footerHeight = this.footerHeight();
    addPanel(this, { x: 0, y: height - footerHeight, width, height: footerHeight }, COLOR.footerBar);

    const gap = this.metrics.px(16);
    const buttonWidth = (width - paddingX * 2 - gap) / 2;
    const y = height - footerHeight + paddingY;
    this.addFooterButton(paddingX, y, buttonWidth, buttonHeight, 'もどる', false, () =>
      this.scene.start('slots'),
    );
    this.addFooterButton(paddingX + buttonWidth + gap, y, buttonWidth, buttonHeight, 'はじめる', true, () =>
      this.startGame(),
    );
  }

  private addFooterButton(
    x: number,
    y: number,
    width: number,
    height: number,
    label: string,
    primary: boolean,
    onTap: () => void,
  ): void {
    const button = new Button(
      this,
      { x, y, width, height },
      {
        fill: primary ? COLOR.primaryButton : COLOR.button,
        border: COLOR.buttonBorder,
        borderWidth: Math.max(1, this.metrics.px(2)),
        radius: this.metrics.px(SIZE.radius),
      },
      onTap,
    );
    button.addContent(
      addLabel(this, this.metrics, width / 2, height / 2, label, { size: 28, bold: true }).setOrigin(0.5),
    );
  }

  private startGame(): void {
    const islandName = normalizeIslandName(this.islandName);
    if (islandName === undefined) {
      this.showNotice('島の名前を入力してください（ランダムボタンでも入力できます）');
      return;
    }

    const seed = parseSeed(this.seedText);
    if (seed === undefined) {
      this.showNotice(`乱数シードは0〜${SEED_MAX}の数字で入力してください`);
      return;
    }

    if (this.characterId === undefined) {
      this.showNotice('キャラクターを選択してください');
      return;
    }

    const save = createSaveData(islandName, seed, this.characterId, Date.now());
    new SaveSlots(localStorage).write(this.slotIndex, save);
    this.scene.start('play', { save, slotIndex: this.slotIndex });
  }

  private showNotice(body: string): void {
    new ModalDialog(this, this.metrics, {
      title: '入力を確認してください',
      body,
      actions: [{ label: 'OK', style: 'primary' }],
    });
  }
}
