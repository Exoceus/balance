// src/shared/keywords.js — default keyword rules (Tier 3 of the classifier).
// Each rule: { pattern: regex source, lane, weight }. Matched case-insensitively against
// "title + description". Signals, not verdicts — weights are summed per lane in classify.js.

export const DEFAULT_KEYWORD_RULES = [
  // 🔴 Drift-leaning — algorithmic / low-effort bait
  {
    pattern: '\\b(reaction|reacts? to|tier ?list|drama|exposed|gone wrong|clickbait|' +
             'compilation|memes?|cringe|ranking every|i tried|24 ?hours|prank|' +
             'tier maker|rage ?bait|you won\'t believe|caught on camera)\\b',
    lane: 'drift',
    weight: 2,
  },

  // 🟢 Enrich-leaning — technical / educational / inspiring
  {
    pattern: '\\b(interview|fireside|how i built|deep ?dive|lecture|seminar|whitepaper|' +
             'architecture|post[- ]?mortem|case study|from scratch|explained|q&?a with|' +
             'keynote|conference talk|tutorial|build(ing)? a|under the hood|first principles|' +
             'research|engineering|algorithm)\\b',
    lane: 'enrich',
    weight: 2,
  },

  // 🟡 Recharge-leaning — deliberate entertainment you might seek out
  {
    pattern: '\\b(highlights|full match|full game|recap|extended|official trailer|' +
             'goals|press conference|documentary)\\b',
    lane: 'recharge',
    weight: 1,
  },
];
