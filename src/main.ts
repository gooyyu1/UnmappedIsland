import Phaser from 'phaser';
import { DeviceScreen } from './game/DeviceScreen';
import { installErrorReport } from './game/errorReport';
import { BootScene } from './game/BootScene';
import { TitleScene } from './game/TitleScene';
import { SlotSelectScene } from './game/SlotSelectScene';
import { NewGameScene } from './game/NewGameScene';
import { ScenarioSelectScene } from './game/ScenarioSelectScene';
import { PlayScene } from './game/PlayScene';
import { COLOR, cssColor } from './game/looks/theme';

// ゲームを組み立てる前に張る（組み立ての最中に投げられたものも受けたい）。
installErrorReport();

DeviceScreen.startGame('game', {
  type: Phaser.AUTO,
  backgroundColor: cssColor(COLOR.outsideScreen),
  // 新規ゲーム作成画面の文字入力欄はDOM要素で作る（TextInput参照）。
  dom: { createContainer: true },
  scene: [BootScene, TitleScene, SlotSelectScene, NewGameScene, ScenarioSelectScene, PlayScene],
});
