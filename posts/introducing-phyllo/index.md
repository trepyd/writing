---
title: "Project: Phyllo"
date: 2026-11-16
summary: "An exploration of live-coded music. Dynamic arrangement and improvisation for game experiences."
tags: [unreal, game audio, phyllo, strudel, ai assisted dev]
---

![The Phyllo leaf. Hairlines at scattered wave frequencies swell into seven stacked sheets, greens at the tip baking into pastry golds at the base, and the stalk grows out as the waves settle.](phyllo-leaf.mp4 "once")

Most adaptive music in games is a set of recordings plus rules for swapping and layering them. The composer writes the themes, and an arranger uses them as a template to write variations and transitions, and middleware controls how the parts layer in reaction to game state. The recorded material has to cover all situations in the game.

In 2010, I made my first 'generative' music machine in a program called [Max/MSP](https://cycling74.com/products/max) and works in a similar way to PCG, using rules and cached patterns. I wanted to revisit this old problem using the latest technology, where music remains code and is interpreted at runtime.

Phyllo is an Unreal Engine 5 plugin I've been building as a tool for composers and developers to explore reactive music. It's based on Strudel, the live coding language at strudel.cc, a JavaScript port of TidalCycles by Felix Roos, Alex McLean and a long list of contributors.

Before I dive in, I want to acknowledge that the FAQ takes [quite an anti-AI stance](https://strudel.cc/learn/faq/#can-i-use-strudel-with-aillm-tools), but licensing allows for usage in projects.

## The Stealth Demo

To set the scene, I built a classic espionage scene based off Lyra as the starting point. I used the Unreal MCP to build the scene and basic patrol points for two guards. Some basic NPC AI drives a stress value, with additional parameters:

- Proximity to each guard
- Player visible to guard
- Player inside room
- Player health
- Player ammo

![A capture of the Stealth Demo.](1117.mp4 "sound")

*Music that rewrites itself.*

The music has distinct phases and certain actions and states in the game have direct links with the music. We'll go into more depth on how this is achieved.

## Maintaining creative intent

### Systemic Mode

Phyllo can bind 'snippets' of code defined in data assets to events. Those snippets can be further manipulated by exposing variable controls and mapping game parameters to those controls. This effectively allows the game to morph targeted parts of the score in a specific way.

Control over how much a snippet can be manipulated by the game is set by the developer.

```strudel
const intensity = 0.5 // Adjust between 0 and 1 & Click Update
const bright = 0.6

$: s("bd*4").gain(0.9)
$: s("bd").struct("~ ~ ~ x ~ ~ x ~ ~ ~ ~ ~ ~ x ~ ~").degradeBy(1 - intensity).gain(0.6)
$: s("~ sd ~ sd").gain(0.8)
$: s("sd").struct("~ ~ ~ ~ ~ ~ ~ x ~ x ~ ~ ~ ~ ~ x").degradeBy(1 - intensity).gain(0.3)
$: s("hh*8").gain(0.45).lpf(1500 + bright * 8000)
$: s("[~ hh]*8").degradeBy(1 - intensity).gain(0.3).lpf(1500 + bright * 8000)
$: s("~ ~ ~ [~ oh]").mask(intensity > 0.7 ? 1 : 0).gain(0.4)
```

### Runtime Agent - Parametric Mode

In addition to the game systems changing the way music, Phyllo allows an agent to override changes the game is making, or moderate it. The developer specifies the constraints in the same way they would with game systems.

### Runtime Agent - Co-Composer Mode

For those who want to go further, Phyllo can create variations based upon existing snippets. I'm working on the ability to cache these generated snippets so they can be re-used later in the session. The developer provides rules on what and how snippets are generated, such as locking the key or notes. There's specific tools that it can be given such as generating inversions and retrogrades- these are algorithmic modifiers on the existing code.

If you're feeling particularly adventurous, you can allow the model to free-compose. It can already see the song code, and it can see game state. Novel motifs could be generated based upon the unique game state that the player finds themselves in. Maybe you're in the middle of combat, but a wild bear enters the scene. The bear could be given its own motif.

### Editor Agent - Assist Mode

It doesn't all have to be runtime. Editor tools allow developers to generate code and curate what gets included in the game. Again, empowering creative developers choose how much they want to use, or not want to use model output in their experiences.

## Splitting up the composition

Strudel runs in a hidden browser and is surfaced through a UE Editor panel. About a bar ahead, Unreal asks it for the next bar's events and plays every note through one MetaSound with a custom engine node: synths, samples, a reverb and a delay. In a sense, we're only using the sequencing logic like MIDI triggers.

The top-level song asset is a 'score'. It's Strudel code split into named slots such as drums, bass, pad, a few layers. Snippets are short Strudel parts held in data assets. Music states map slots to snippets, so Alert might mean the alert drums, a driving bass and string arpeggios. When the game sets a state, its slots swap on the next bar line and its stinger plays. By default a swapped-in part starts from its own top, so a four-bar phrase doesn't enter halfway through.

The score declares the game's events and values too. An event can switch the state, play a stinger, set a control or ask the agent. A game value like 'stress' drives controls through curve assets, whose output drives controls in code.

Harmonic progression is defined at the top of the score as the key and chords in Strudel's notation, like `<Cm7 Cm9 Ab^7 Fm7>`.

A part follows the chords with `n("0 2 4").set(chords.anchor("c4")).voicing()`: the numbers pick notes from whichever chord is sounding, and the anchor sets how high it sits. A music state can bring its own set of chords; in my stealth demo, Alert switches to C minor against Db. Parts written against the chords or the key follow on the next bar.

``` strudel
// Harmony: a key, and chords that change every bar
const key = "C:minor"
const chords = chord("<Cm7 Cm9 Ab^7 Fm7>")
// The alert's harmony: swap the line above for this one
// const chords = chord("<Cm Db>")

// Pad: four notes of whichever chord is sounding, just under C5
$: n("[0,1,2,3]").set(chords.anchor("c5")).voicing()
  .s("supersaw").attack(0.6).release(1.2).lpf(1400).room(0.5).gain(0.2)

// Bass: the root of each chord, near C2
$: n("0").set(chords.anchor("c2")).mode("root").voicing()
  .struct("x ~ ~ x ~ ~ x ~").s("sawtooth").lpf(600).gain(0.5)

// Melody: steps of the key, not the chords
$: n("0 2 4 2 3 4 6 4").scale(key).transpose(12)
  .s("triangle").clip(0.6).delay(0.3).gain(0.3)

// Drums: kick on 1 and 3, snare on 2 and 4, hats between
$: s("bd ~ ~ ~ ~ ~ ~ ~ bd ~ ~ ~ ~ ~ ~ ~")
$: s("~ ~ ~ ~ sd ~ ~ ~ ~ ~ ~ ~ sd ~ ~ ~")
$: s("~ ~ hh ~ ~ ~ hh ~ ~ ~ hh ~ ~ ~ hh ~").gain(0.5)
```

## The agent

The agent doesn't need to be involved for every decision, just for the bigger moments like a phase change. Its given a briefing of what the game says is happening, what each slot plays now, which snippets fit where. It has information on how far each control may move, and the exact timing of the next phrase.

It replies with structured actions. It can swap a part, move a control inside the range the composer set, mute a layer, ramp a value over several bars, or arm a different stinger for the game to fire later. It can bend a part with Strudel's own pattern methods: double time, thin it out, stutter, echo, reverse, transpose. As mentioned earlier- it can also compose a short part up to 900 characters, using the score's key and allowed sounds. Invalid actions are caught, dropped and logged. Examples include naming something that doesn't exist, or setting a value outside its limits. Each action carries a one-line why, shown next to the slot it changed.

I tried it with my stealth demo, and in the first live session the agent made 8 requests and 16 actions were applied, none rejected. The first change was audible 3-6  seconds after the request went out. As always, latency needs to be taken into consideration but it will depend on the model. Reactionary changes still need to be handled by systems at least for now. I'll be experimenting with a mixed-model approach in the future.

## Authoring experience

A composer has to be able to work without starting the game, so most of my recent time has gone into the Phyllo window. Outside play-in-editor it's a sandbox where you can pick a score, press Play, click its music states, stingers and events, with a slider for every game value and solo and mute on every slot. Its optimised for low-friction experimentation. If you edit a snippet, you hear it at the next bar without needing to save. During play-in-editor the same window becomes a read-only view into how the system is running.

The code view is Strudel's own editor. The notes that are sounding get a box, in time with Unreal's clock. Each slot is labeled with its snippet and who set it, the game or the agent, and a part the agent wrote says "composed by the AI".

Under it is the jam box. Type any Strudel, press Ctrl+Enter, and it plays over the score from the next bar, with the score's key and chords already defined. Solo plays only the jam while the score keeps time underneath. When a block is worth keeping, Promote turns it into a new snippet. It brings along the definitions the block uses, checks the code plays on its own, and asks for an agent note.

Agent notes are how the composer talks to the agent. A comment starting `// @ai:` says what a part sounds like and what it's for, and the agent reads it. Every other comment is the composer's and is stripped before the agent sees the code. My working notes stay mine.

The rules the agent follows today are the limits on every control, the checks on every action, and standing directives on the score written in plain words, which go into every briefing.

## What was hard

### Voices

The first implementation played each note as its own sound instance, and dense bars lost notes. The main cause was the voice limit was the audio quality level's 32, whatever the max channels setting said. I knew this would be a terrible approach but I wanted to just get it working first. Every note now renders inside the one engine MetaSound, and the whole score costs one mixer voice. The peak I measured was 74 notes at once, on 1 of 32 voices.

I'm yet to profile this, and I'm sure there's going to be a sweet spot between patch instances and monolithic processing.

![The MetaSound patch architecture to work around some voicing limitations](engine-patch.mp4)

*MetaSound's DSP capabilities are harnessed for effects and general playback of voices.*

### Timing

Every change has to start on a beat or a bar. Early on, Quartz quantized starts on a beat inside the current bar were being cancelled, and stingers lost between 18 and 43 notes a run. Moving stinger starts to the bar line took that to zero, at the cost of up to a bar of latency. The single engine fixed it properly. Each note goes in with its start time, and the node starts it on that exact frame. The measured error is 0.04 ms, and stingers start on the next beat again.

### Briefings

Before paying for live calls I built an offline harness. Each request saves its briefing to a file, another agent or I write the reply, and the game emulates how it would react. The first round parsed and applied, and it surfaced three things. The agents repeated the state switch the game had already queued, so the briefing now has an "Already coming" section. Each one read the bar offset differently, so the timing section now gives the exact value. And my own directive, "never silence the drums", stopped them resting anything, so it now allows a one or two bar rest. Every one of those was a gap in what I'd written for them.

## A Future Release?

Strudel is licensed under the AGPL v3, so I'll need to navigate what that means before I can release any of this for folks to try. I also want to be respectful of the community's stance on AI. Stay tuned on that, but for now it will remain a personal project and proof-of-concept.

## What's next

These are planned and either not built or not feature complete:

- Rules as assets, ticked per score and per snippet. Some get a check: stay in key, stay in range, no drum hit on a step another part already hits, keep the level within 20%. A composed part that fails would be taken back, and the agent told why in its next briefing.
- The in-editor assistant for variations.
- More of Strudel in the engine: high-pass, filter resonance and envelope, playback speed and choke groups are written by Strudel and ignored by Phyllo today.
- Scenarios: a timeline of game values and events that plays the same way every time, for tests and repeatable video takes.

And another demo.
