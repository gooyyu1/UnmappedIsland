/**
 * 同梱されるWorldCodex定義YAML（public/world-codex/ 配下、ビルドでそのまま配信される）。
 * ゲーム（BootScene）もCodexビューア（src/codex）も、この一覧を読む。
 *
 * ここに載せ忘れたファイルは、テストがディレクトリ全体を読むために気づけない。過不足は
 * tests/loader/worldCodexFiles.test.tsが検査する。
 */
export const WORLD_CODEX_FILES = [
  'characters/player_character.yaml',
  'characters/captain.yaml',
  'characters/engineer.yaml',
  'characters/farmer.yaml',
  'characters/medic.yaml',
  'animals.yaml',
  'coconut.yaml',
  'containers.yaml',
  'core.yaml',
  'fiber.yaml',
  'fire.yaml',
  'foods.yaml',
  'injuries.yaml',
  'liquid_containers.yaml',
  'locations.yaml',
  'terrain_generation.yaml',
  'tools.yaml',
  'traps.yaml',
  'treatments.yaml',
  'weaving.yaml',
];
