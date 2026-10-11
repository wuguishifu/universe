export const systemPrompt = `You are a video clip editor. You receive a JSON transcript of a gaming or streaming session. Each entry has "speaker", "start", "end" (seconds, as floats), and "text". The transcript is auto-generated, so some text is garbled or mis-heard — infer the real meaning from context.

Speakers: "host" is the person who recorded the clip. "friend A", "friend B", and so on are the other people in voice chat. Those labels are worked out automatically from their voices, so one person may show up under more than one label, and a few words at the start or end of a line can be credited to the wrong person. "others" is voice chat that wasn't split by speaker, and "game" is game audio.

Your job: find the single best self-contained highlight — the moment the clip was made to capture (usually the funniest, most dramatic, or most surprising beat) — and return the time range to trim around it.

Rules for the range:
- start_seconds: the start of the earliest line needed as SETUP for the moment to land. Don't begin mid-payoff, but don't include unrelated chatter before it either. A joke or reaction needs its lead-in to make sense.
- end_seconds: the end of the line where the moment resolves — the punchline plus its immediate reaction/laughter. Don't trail into unrelated talk.
- Both values MUST be copied verbatim from "start"/"end" fields that actually appear in the transcript. end_seconds must be strictly greater than start_seconds.
- When uncertain how far back the setup begins, choose the EARLIER line. A few extra seconds of lead-in is fine; starting mid-exchange and omitting setup is a failure. Begin at the first line of the conversational thread that leads to the payoff, not partway through it.

Output ONLY a single JSON object — no markdown, no code fences, no prose before or after — in exactly this shape:
{
  "found": true,
  "reasoning": "<1-2 sentences: what the moment is and why these boundaries>",
  "quoteStart": "<the text of the transcript line you chose for start>",
  "quoteEnd": "<the text of the transcript line you chose for end>",
  "startSeconds": <number>,
  "endSeconds": <number>,
  "clipTitle": "<a title that describes the clip in a funny or ironic way>"
}

If no clearly clip-worthy moment exists, output only:
{"found": false, "reasoning": "<why>"}`;

export const exampleTranscripts = [
  [
    {
      startMs: 0,
      endMs: 28400,
      text: '[music]',
      speaker: 'host',
    },
    {
      startMs: 520,
      endMs: 680,
      text: 'Well,',
      speaker: 'friend A',
    },
    {
      startMs: 4320,
      endMs: 6360,
      text: 'drop from these three and then you can just tuck it bro.',
      speaker: 'friend A',
    },
    {
      startMs: 6720,
      endMs: 11740,
      text: "You guys look at go to Tommy's board and look at his like water landing You see he's simple on the left.",
      speaker: 'friend A',
    },
    {
      startMs: 12280,
      endMs: 12900,
      text: 'Yeah, this is',
      speaker: 'friend A',
    },
    {
      startMs: 12900,
      endMs: 19680,
      text: "four three or five five five That isn't saying",
      speaker: 'friend B',
    },
    {
      startMs: 19680,
      endMs: 20620,
      text: 'How do I?',
      speaker: 'friend C',
    },
    {
      startMs: 20920,
      endMs: 21460,
      text: 'Tricking donate.',
      speaker: 'friend A',
    },
    {
      startMs: 21940,
      endMs: 22840,
      text: "Oh, that's what the",
      speaker: 'friend A',
    },
    {
      startMs: 22840,
      endMs: 24460,
      text: "dying that's what the windows where I get it.",
      speaker: 'friend B',
    },
    {
      startMs: 25120,
      endMs: 48020,
      text: "Yeah, you have a sickness or something What do Patrick do I play the I'll play the Mallard I play the Mallard",
      speaker: 'friend A',
    },
    {
      startMs: 28400,
      endMs: 33480,
      text: 'Oh, I already trawled [music]',
      speaker: 'host',
    },
    {
      startMs: 33480,
      endMs: 39240,
      text: 'Ah, I double trawled. Okay. [laughing]',
      speaker: 'host',
    },
    {
      startMs: 39240,
      endMs: 58040,
      text: '[music]',
      speaker: 'host',
    },
    {
      startMs: 48020,
      endMs: 56580,
      text: 'You pick the card in your hand then it will tuck it after you give it the ALK',
      speaker: 'friend B',
    },
    {
      startMs: 56580,
      endMs: 57460,
      text: "It's Tommy guy, bro.",
      speaker: 'friend A',
    },
    {
      startMs: 58040,
      endMs: 60040,
      text: 'Oh for real man.',
      speaker: 'host',
    },
    {
      startMs: 58600,
      endMs: 58840,
      text: "It's hard.",
      speaker: 'friend A',
    },
    {
      startMs: 59080,
      endMs: 74600,
      text: "I can't play this game before It's kind of like do I click the checkbook or the x-book Why",
      speaker: 'friend A',
    },
    {
      startMs: 60040,
      endMs: 79800,
      text: '[music]',
      speaker: 'host',
    },
    {
      startMs: 74600,
      endMs: 77280,
      text: 'is it not taking my buried bro',
      speaker: 'friend C',
    },
    {
      startMs: 77280,
      endMs: 87080,
      text: "think Bo this zip does take a long time I'm stuck on go-round.",
      speaker: 'friend B',
    },
    {
      startMs: 79800,
      endMs: 84040,
      text: 'I am half downloaded with the total, with the entire thing.',
      speaker: 'host',
    },
    {
      startMs: 84040,
      endMs: 109040,
      text: '[music]',
      speaker: 'host',
    },
    {
      startMs: 87360,
      endMs: 91540,
      text: 'Crow be',
      speaker: 'friend B',
    },
    {
      startMs: 91540,
      endMs: 98900,
      text: "Well, I'm confused Did I did I do my turn wrong?",
      speaker: 'friend C',
    },
    {
      startMs: 98960,
      endMs: 101400,
      text: "Is that what it's not working you know read",
      speaker: 'friend C',
    },
    {
      startMs: 101400,
      endMs: 102220,
      text: 'whatever it says on the',
      speaker: 'friend A',
    },
    {
      startMs: 102220,
      endMs: 105320,
      text: 'bottom right just read it Bottom right.',
      speaker: 'friend C',
    },
    {
      startMs: 105960,
      endMs: 114840,
      text: 'It says choose a card then choose',
      speaker: 'friend C',
    },
    {
      startMs: 109040,
      endMs: 114040,
      text: "Oh my [laughing] That's crazy.",
      speaker: 'host',
    },
    {
      startMs: 114040,
      endMs: 118040,
      text: '[music]',
      speaker: 'host',
    },
    {
      startMs: 114840,
      endMs: 117560,
      text: "it Who's want to talk then it says choose a card",
      speaker: 'friend A',
    },
    {
      startMs: 118040,
      endMs: 120040,
      text: 'That is insane.',
      speaker: 'host',
    },
  ],
] as const;

export const exampleResponses = [
  {
    found: true,
    reasoning:
      "The comedic beat is one player being totally lost in the UI while another exasperatedly tells him to just read the on-screen prompt; it builds to the 'choose a card' / 'then choose a card!' exchange and laughter.",
    quoteStart: 'Did I do my turn, bro?',
    quoteEnd: '[laughing]',
    startSeconds: 91.54,
    endSeconds: 120.04,
    clipTitle: 'learning how to read instructions',
  },
  {
    found: true,
    reasoning: 'The funny moment in this clip is when ',
  },
] as const;

export const userPrompt = (transcript: string) => `Here is the transcript:
<transcript>
${transcript}
</transcript>`;
