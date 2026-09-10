import { it } from 'vitest';
import { compileOracleCard } from '../src/cards/oracle-parser.js';
it('probe', () => {
  for (const t of ['You may cast spells this turn as though they had flash.', 'Draw a card.', 'You may cast spells this turn as though they had flash.\nDraw a card.']) {
    const d = compileOracleCard({ name: 'Probe', manaCost: '{1}{U}', typeLine: 'Instant', colors: ['U'], oracleText: t } as any);
    console.log('##', JSON.stringify(t), d?.automation, JSON.stringify(d?.automationNotes ?? []), JSON.stringify(d?.spellEffect ?? null));
  }
});
