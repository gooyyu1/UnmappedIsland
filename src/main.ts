import Phaser from 'phaser';
import { DeviceScreen } from './game/DeviceScreen';
import { BootScene } from './game/BootScene';
import { TitleScene } from './game/TitleScene';
import { SlotSelectScene } from './game/SlotSelectScene';
import { NewGameScene } from './game/NewGameScene';
import { ScenarioSelectScene } from './game/ScenarioSelectScene';
import { PlayScene } from './game/PlayScene';

DeviceScreen.startGame('game', {
  type: Phaser.AUTO,
  backgroundColor: '#101418',
  // 新規ゲーム作成画面の文字入力欄はDOM要素で作る（TextInput参照）。
  dom: { createContainer: true },
  scene: [BootScene, TitleScene, SlotSelectScene, NewGameScene, ScenarioSelectScene, PlayScene],
});
