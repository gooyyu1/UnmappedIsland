import Phaser from 'phaser';
import { installSampleAssetPack } from './asset-pack/install';
import { Settings } from './save/Settings';
import { DeviceScreen } from './game/DeviceScreen';
import { installErrorReport } from './game/errorReport';
import { BootScene } from './game/BootScene';
import { TitleScene } from './game/TitleScene';
import { SettingsScene } from './game/SettingsScene';
import { SlotSelectScene } from './game/SlotSelectScene';
import { NewGameScene } from './game/NewGameScene';
import { ScenarioSelectScene } from './game/ScenarioSelectScene';
import { ShelfScene } from './game/ShelfScene';
import { PlayScene } from './game/PlayScene';
import { parseLaunchSeed, setLaunchSeed } from './game/launchSeed';
import { cssColor } from './util/cssColor';
import { setLabelDefaults } from './ui/labels';
import { COLOR, FONT_FAMILY, SHAPE_LOOK } from './game/looks/theme';
import { setShapeDefaults } from './ui/shapes';

// ゲームを組み立てる前に張る（組み立ての最中に投げられたものも受けたい）。
installErrorReport();

// 汎用の部品は意匠を知らないので、この画面の書体・文字色と、図形の影・破線の刻みをここで入れる
// （src/ui/labels・src/ui/shapes）。
setLabelDefaults({ fontFamily: FONT_FAMILY, color: COLOR.text });
setShapeDefaults(SHAPE_LOOK);

// URLの `?seed=` は新規ゲームの種を固定する（launchSeed）。読むのは起動時の1度だけで、以降は
// 画面を作り直しても同じ値が出る。
setLaunchSeed(parseLaunchSeed(location.search));

// アセットパックは、定義も絵も読み込まれる前に入れる（AssetPack.md 4節）。読むかどうかはスタート
// 画面の設定が決める（StartScreen.md 画面構成 4）。取得に失敗したら起動しない——あるはずの物が
// 無い世界で遊ぶことになるため、報告（errorReport）に出して止める。
if (new Settings(localStorage).loadsAssetPack) await installSampleAssetPack();

DeviceScreen.startGame('game', {
  type: Phaser.AUTO,
  backgroundColor: cssColor(COLOR.outsideScreen),
  // 新規ゲーム作成画面の文字入力欄はDOM要素で作る（TextInput参照）。
  dom: { createContainer: true },
  scene: [
    BootScene,
    TitleScene,
    SettingsScene,
    SlotSelectScene,
    NewGameScene,
    ScenarioSelectScene,
    ShelfScene,
    PlayScene,
  ],
});
