import { join } from 'node:path';
import { typesMissingCardArt, typesShowingOwnArtOnCard } from '../../src/analysis/cardArt';
import type { YamlReportSection } from '../support/generatedReport';
import {
  describeDocumentedSections,
  describeReportFreshness,
  describeYamlReportRegeneration,
  formatYamlReport,
} from '../support/generatedReport';
import { bundledCodex } from '../support/worldCodexFiles';

/**
 * 札に自分の絵を映す型のうち、絵がまだ無いものを並べ（`src/analysis/cardArt.ts`）、
 * `stats/card_art.yaml`へ書き出す。
 *
 * **絵が揃っていないことを赤にしない。** 揃うまでは`main`が赤いままになるので、ここは数を出すだけで、
 * 減っていくことが進捗になる。**型を足したのに絵が無いままのとき**は、下の鮮度が赤くなって作り直しを
 * 求めるので、その型はこの一覧へ現れる。
 *
 * **書き出すのは一覧だけ。** 何を数えたか・数えていない型は、手書きの`docs/diagnostics/CardArtStats.md`
 * が持つ。型を足した・絵を足した後に再生成する: `npm run stats:card-art`。再生成と鮮度の形は
 * `tests/support/generatedReport.ts` が持つ。
 */

const REPORT_PATH = join('stats', 'card_art.yaml');
const DOC_PATH = join('docs', 'diagnostics', 'CardArtStats.md');

function buildReportFromDefinitions(): string {
  const codex = bundledCodex();
  const shown = typesShowingOwnArtOnCard(codex);
  const missing = typesMissingCardArt(codex);

  const sections: readonly YamlReportSection[] = [
    {
      key: 'meta',
      records: [{ types: shown.length, drawn: shown.length - missing.length, missing: missing.length }],
    },
    { key: 'missing', records: missing.map((def) => ({ object: def.name, art: def.artName })) },
  ];
  return formatYamlReport(
    [
      '札に自分の絵を映す型のうち、絵（src/assets/objects/<絵の名前>.png）がまだ無いもの。',
      '生成物。手で書き換えず、npm run stats:card-art で作り直す。',
      '何を数えて何を数えていないかは docs/diagnostics/CardArtStats.md。',
    ],
    sections,
  );
}

const DOCUMENTED_SECTIONS = describeDocumentedSections(DOC_PATH, REPORT_PATH);

describeYamlReportRegeneration(
  REPORT_PATH,
  'RUN_CARD_ART_STATS',
  buildReportFromDefinitions,
  DOCUMENTED_SECTIONS.required,
);

describeReportFreshness(REPORT_PATH, 'npm run stats:card-art', buildReportFromDefinitions);
