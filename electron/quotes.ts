import { existsSync, readFileSync, writeFileSync } from 'node:fs'

// Built-in quotes and shayari. Only public-domain works are bundled (authors who died long
// enough ago, or old public-domain translations). Users add anything else, such as modern
// poets still under copyright, to their own quotes file.

export interface Quote {
  text: string
  author: string
  kind: 'Shayari' | 'Doha' | 'Quote'
}

export const BUILT_IN: Quote[] = [
  { kind: 'Shayari', author: 'Mirza Ghalib', text: 'Hazaaron khwahishen aisi ke har khwahish pe dam nikle\nBahut nikle mere armaan lekin phir bhi kam nikle' },
  { kind: 'Shayari', author: 'Mirza Ghalib', text: 'Dil-e-naadaan tujhe hua kya hai\nAakhir is dard ki dawa kya hai' },
  { kind: 'Shayari', author: 'Mirza Ghalib', text: 'Ishq ne Ghalib nikamma kar diya\nVarna hum bhi aadmi the kaam ke' },
  { kind: 'Shayari', author: 'Mirza Ghalib', text: 'Hum ko maaloom hai jannat ki haqeeqat lekin\nDil ke khush rakhne ko Ghalib ye khayal achha hai' },
  { kind: 'Shayari', author: 'Mirza Ghalib', text: 'Rekhte ke tumhin ustaad nahin ho Ghalib\nKehte hain agle zamane mein koi Mir bhi tha' },
  { kind: 'Shayari', author: 'Mir Taqi Mir', text: 'Patta patta boota boota haal hamara jaane hai\nJaane na jaane gul hi na jaane baagh to saara jaane hai' },
  { kind: 'Shayari', author: 'Allama Iqbal', text: 'Khudi ko kar buland itna ke har taqdeer se pehle\nKhuda bande se khud pooche bata teri raza kya hai' },
  { kind: 'Shayari', author: 'Allama Iqbal', text: 'Sitaron se aage jahan aur bhi hain\nAbhi ishq ke imtihan aur bhi hain' },
  { kind: 'Doha', author: 'Kabir', text: 'Dheere dheere re mana, dheere sab kuch hoye\nMaali seenche sau ghada, ritu aaye phal hoye' },
  { kind: 'Doha', author: 'Kabir', text: 'Kaal kare so aaj kar, aaj kare so ab\nPal mein parlay hoyegi, bahuri karega kab' },
  { kind: 'Doha', author: 'Kabir', text: 'Bura jo dekhan main chala, bura na milya koye\nJo dil khoja aapna, mujhse bura na koye' },
  { kind: 'Quote', author: 'Rabindranath Tagore, Stray Birds', text: 'If you shed tears when you miss the sun, you also miss the stars.' },
  { kind: 'Quote', author: 'Swami Vivekananda', text: 'Arise, awake, and stop not till the goal is reached.' },
  { kind: 'Quote', author: 'Mahatma Gandhi', text: 'Strength does not come from physical capacity. It comes from an indomitable will.' },
  { kind: 'Quote', author: 'Seneca, Letters to Lucilius', text: 'While we are postponing, life speeds by.' },
  { kind: 'Quote', author: 'Marcus Aurelius, Meditations', text: 'No longer talk at all about the kind of man that a good man ought to be, but be such.' },
  { kind: 'Quote', author: 'Lao Tzu, Tao Te Ching', text: 'The journey of a thousand li commences with a single step.' },
  { kind: 'Quote', author: 'Confucius, Analects', text: 'Is it not pleasant to learn with a constant perseverance and application?' },
]

const TEMPLATE = `# Your own quotes and shayari for Nexo.
# Separate entries with a blank line. Put the author on the last line starting with "-- ".
# Lines starting with # are ignored. Save the file; Nexo picks it up on the next notice.
#
# Example:
#
# Line one of the sher
# Line two of the sher
# -- Poet name
`

/** Parse the user's quotes file (creating it with instructions if missing). */
export function loadUserQuotes(file: string): Quote[] {
  if (!existsSync(file)) {
    writeFileSync(file, TEMPLATE)
    return []
  }
  const lines = readFileSync(file, 'utf8').replace(/\r/g, '').split('\n')
  const blocks = lines
    .filter((l) => !l.trimStart().startsWith('#'))
    .join('\n')
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean)
  return blocks.map((b) => {
    const parts = b.split('\n')
    const last = parts[parts.length - 1]
    const hasAuthor = /^(--|—|-)\s*/.test(last) && parts.length > 1
    return {
      kind: 'Shayari',
      author: hasAuthor ? last.replace(/^(--|—|-)\s*/, '') : '',
      text: (hasAuthor ? parts.slice(0, -1) : parts).join('\n'),
    }
  })
}
