import Phaser from 'phaser';
import { BootScene } from './game/BootScene';
import { TitleScene } from './game/TitleScene';
import { SlotSelectScene } from './game/SlotSelectScene';
import { NewGameScene } from './game/NewGameScene';
import { PlayScene } from './game/PlayScene';

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#101418',
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  // 新規ゲーム作成画面の文字入力欄はDOM要素で作る（TextInput参照）。
  dom: { createContainer: true },
  scene: [BootScene, TitleScene, SlotSelectScene, NewGameScene, PlayScene],
});
