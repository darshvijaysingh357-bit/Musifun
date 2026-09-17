// Genre-specific Step 4 questions for the specification chatbot.
// Each genre has 4 targeted questions that resolve the ambiguity that
// actually matters for that style — not generic filler.
const GENRE_QUESTIONS = {
  'Lo-fi': [
    'Vinyl crackle or tape hiss in the background?',
    'Piano or guitar as the lead instrument?',
    'Any rain or ambient background sounds?',
    'Swung, off-beat drums, or straight timing?'
  ],
  'EDM': [
    'Build-up-and-drop structure, or a steady groove throughout?',
    'Any vocal chops or hooks?',
    'Heavy bass and sidechain pump, or lighter and melodic?',
    'Festival-energy, or more underground/club?'
  ],
  'Hip-Hop': [
    'Boom-bap (old-school) or trap-influenced hi-hats?',
    'Sample-based feel (soulful/jazzy), or fully synthesized?',
    'Aggressive and hard-hitting, or laid-back and smooth?',
    'Space left for vocals/rap, or a fuller instrumental?'
  ],
  'Cinematic': [
    'Orchestral (strings/brass), or modern hybrid/electronic?',
    'Building tension, or already at an emotional peak?',
    'Percussion-driven and epic, or sparse and atmospheric?',
    'A specific scene type — battle, romance, discovery, loss?'
  ],
  'Ambient': [
    'Textural/drone-based, or a subtle melody?',
    'Nature sounds woven in, like wind or water?',
    'Completely beatless, or a very slow pulse?',
    'Bright and airy, or darker and introspective?'
  ],
  'Trap': [
    '808 bass — heavy and distorted, or clean and punchy?',
    'Hi-hat rolls — fast and intricate, or simple?',
    'Dark and moody, or more melodic and emotional?',
    'Instrumental only, or space for a hook/vocal?'
  ],
  'Pop': [
    'Verse-chorus structure implied, or just a vibe/loop?',
    'Bright and radio-ready, or moodier alternative pop?',
    'A prominent hook/melody line, or more rhythm-driven?',
    'Any specific era feel — 80s synth, modern, 2000s?'
  ],
  'Rock': [
    'Guitar-driven riffs, or more rhythm-section-led?',
    'Raw/garage energy, or polished and produced?',
    'Aggressive and heavy, or melodic and anthemic?',
    'Acoustic elements, or fully electric?'
  ],
  'Jazz': [
    'Smooth/lounge feel, or upbeat swing?',
    'Piano-led, saxophone-led, or full ensemble?',
    'Improvisational/loose feel, or a tighter structure?',
    'Late-night mellow, or lively and bouncy?'
  ]
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GENRE_QUESTIONS };
}
