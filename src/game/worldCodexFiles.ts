/**
 * ゲーム本体に同梱されるWorldCodex定義YAML（public/world-codex/ 配下、ビルドでそのまま配信される）。
 *
 * ここに載せ忘れたファイルは、テストがディレクトリ全体を読むために気づけない。過不足は
 * bootSceneFiles.test.tsが検査する。BootSceneではなくこの独立したモジュールに置くのは、
 * 一覧を読むだけのテストがPhaserの読み込み（windowを要求する）に巻き込まれないようにするため。
 */
export const WORLD_CODEX_FILES = [
  'characters/player_character.yaml',
  'characters/captain.yaml',
  'characters/engineer.yaml',
  'characters/farmer.yaml',
  'characters/medic.yaml',
  'coconut.yaml',
  'containers.yaml',
  'core.yaml',
  'foods.yaml',
  'injuries.yaml',
  'liquid_containers.yaml',
  'locations.yaml',
  'terrain_generation.yaml',
  'tools.yaml',
  'treatments.yaml',
  'weaving.yaml',
];
