import Phaser from 'phaser';
import type { WorldCodex } from '../domain/defs/WorldCodex';
import type { Localization } from '../locale/Localization';
import { loadLocalization } from '../locale/Localization';
import cardFrameUrl from '../assets/ui/card_frame.png';
import flipDigitUrl from '../assets/ui/flip_digit.png';
import slotButtonPaperUrl from '../assets/ui/slot_button_paper.png';
import dustPuffUrl from '../assets/ui/dust_puff.png';
import { CARD_FRAME_TEXTURE } from './ui/Card';
import { DUST_PUFF_TEXTURE } from './ui/DustPuff';
import { SLOT_BUTTON_PAPER_FRAME, SLOT_BUTTON_PAPER_TEXTURE } from './ui/Button';
import { FLIP_DIGIT_TEXTURE } from './ui/FlipCalendar';
import { INFORMATION_ART } from '../art/informationArt';
import { SEPARATOR_ART } from '../art/separatorArt';
import { ICON_ART } from '../art/iconArt';
import { WEATHER_ART } from '../art/weatherArt';
import { commonArtFiles, locationDefNames } from '../art/artFiles';
import { cssColor } from '../util/cssColor';
import { COLOR, FONT_FAMILY } from './looks/theme';
import { loadWorldCodex } from '../loader/loadWorldCodex';
import { installedAssetPack } from '../assetPack/install';

/** 組み立て済みWorldCodex・表示文字列をレジストリへ置くときのキー。 */
export const WORLD_CODEX_KEY = 'worldCodex';
export const LOCALIZATION_KEY = 'localization';

/**
 * 起動シーン。WorldCodexと表示文字列のYAMLを読み込んで組み立て、レジストリ経由で以降のシーンへ
 * 引き渡してからタイトル画面を開く。アセットパックは起動前に入っている（src/main.ts）ので、
 * ここでは同梱ぶんと同じように読むだけでよい。
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  preload(): void {
    // 読み込めなくてもカードは図形で描かれる（Card.addFrame）ため、失敗しても起動は止めない。
    this.load.image(CARD_FRAME_TEXTURE, cardFrameUrl);
    // 日時のフリップカードの紙。こちらも読み込めなければ図形で描かれる（FlipCalendar）。
    this.load.image(FLIP_DIGIT_TEXTURE, flipDigitUrl);
    // スロットボタンの地に敷く紙。ボタン1つぶんずつ縦に並んでいる（読めなければ地は平らな塗り）。
    this.load.spritesheet(SLOT_BUTTON_PAPER_TEXTURE, slotButtonPaperUrl, {
      frameWidth: SLOT_BUTTON_PAPER_FRAME.width,
      frameHeight: SLOT_BUTTON_PAPER_FRAME.height,
    });
    // 生まれた・壊れた札から散る砂埃の粒（読めなければ砂埃が立たないだけ、DustPuff）。
    this.load.image(DUST_PUFF_TEXTURE, dustPuffUrl);
    // 情報エリア（フィールドエリアの左／上）の背景。向きごとに1枚ずつ。
    for (const [texture, url] of INFORMATION_ART) this.load.image(texture, url);
    // エリアの境目に敷く帯。
    for (const [texture, url] of SEPARATOR_ART) this.load.image(texture, url);
    // 状況エリアに敷く空の絵。天気は土地と違って移動を待たずに変わるので、全部を起動時に読み切る。
    for (const [texture, url] of WEATHER_ART) this.load.image(texture, url);
    // 画面に固定で置かれるボタンのアイコン。
    for (const [texture, url] of ICON_ART) this.load.image(texture, url);
  }

  create(): void {
    let codex: WorldCodex;
    let localization: Localization;
    try {
      const pack = installedAssetPack();
      codex = loadWorldCodex(pack);
      localization = loadLocalization(pack);
    } catch (error) {
      this.showMessage(
        `定義ファイルのロードに失敗しました:\n${error instanceof Error ? error.message : error}`,
      );
      throw error;
    }

    this.registry.set(WORLD_CODEX_KEY, codex);
    this.registry.set(LOCALIZATION_KEY, localization);

    // 土地の絵はここではロードせず、プレイ中に必要になった土地からロードする（artFiles参照）。
    // それ以外の絵（キャラクター・アイテム・共通の背景）は開始時点の画面に出うるため、ここで読み切る。
    // どの絵が土地のものかはCodexが要る（locationタグ）ので、preloadではなくYAMLを読み終えた後に行う。
    for (const { key, url } of commonArtFiles(locationDefNames(codex))) this.load.image(key, url);
    this.load.once(Phaser.Loader.Events.COMPLETE, () => this.scene.start('title'));
    this.load.start();
  }

  private showMessage(text: string): void {
    this.add
      .text(this.scale.width / 2, this.scale.height / 2, text, {
        fontFamily: FONT_FAMILY,
        fontSize: '20px',
        color: cssColor(COLOR.textOnDark),
        align: 'center',
      })
      .setOrigin(0.5);
  }
}
