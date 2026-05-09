// audio/index.js – pelin äänijärjestelmä: SFX + taustamusiikki.
//
// Eksportit:
//   SOUND_THEMES   – synth-/effektin sound-design "modern" vs "off"
//   MUSIC_TRACKS   – 4 taustamusiikkikappaletta (id, name, nameFi)
//   useSounds(theme) – React-hook joka palauttaa play*-callbackit
//   useMusic(trackId) – React-hook { start, stop, restart }
//
// Kaikki Tone.js-objektit ovat hookkien sisällä useRefissä, jotta ne
// elävät komponentin unmountiin asti ja niiden dispose hoidetaan oikein.

import { useRef, useCallback, useMemo } from "react";
import * as Tone from "tone";

// ============================================================================
// SOUND EFFECTS
// ============================================================================

export const SOUND_THEMES = {
  modern: {
    synth: { oscillator: { type: "triangle" }, envelope: { attack: 0.02, decay: 0.2, sustain: 0.08, release: 0.25 }, volume: -16 },
    bass: { oscillator: { type: "sawtooth4" }, envelope: { attack: 0.02, decay: 0.25, sustain: 0.1, release: 0.3 }, volume: -14 },
    btn: { noise: { type: "white" }, envelope: { attack: 0.002, decay: 0.03, sustain: 0, release: 0.02 }, volume: -26 },
    btnFilter: 500,
    notes: {
      find3: n => [["D5", "16n", n]],
      find4: n => [["F5", "16n", n], ["A5", "16n", n + 0.06]],
      find5: n => ({ synth: [["D5", "16n", n], ["F5", "16n", n + 0.05], ["A5", "8n", n + 0.1]], bass: [["D3", "8n", n + 0.08]] }),
      find6: n => ({ synth: [["D5", "16n", n], ["F5", "16n", n + 0.04], ["A5", "16n", n + 0.08], ["D6", "8n", n + 0.12]], bass: [["D2", "4n", n], ["A2", "8n", n + 0.1]] }),
      find7: n => ({ synth: [["D5", "16n", n], ["F5", "16n", n + 0.03], ["A5", "16n", n + 0.06], ["D6", "16n", n + 0.09], ["F6", "16n", n + 0.12], ["A6", "4n", n + 0.16]], bass: [["D2", "4n", n], ["A1", "2n", n + 0.1]] }),
      find8: n => ({ synth: [["D5", "16n", n], ["F5", "16n", n + 0.03], ["A5", "16n", n + 0.06], ["D6", "16n", n + 0.09], ["F6", "16n", n + 0.12], ["A6", "16n", n + 0.15], ["D7", "4n", n + 0.19]], bass: [["D2", "4n", n], ["A1", "4n", n + 0.1], ["D2", "2n", n + 0.2]] }),
      find10: n => ({ synth: [["D5", "16n", n], ["F5", "16n", n + 0.025], ["A5", "16n", n + 0.05], ["D6", "16n", n + 0.075], ["F6", "16n", n + 0.1], ["A6", "16n", n + 0.125], ["D7", "16n", n + 0.15], ["F7", "8n", n + 0.2], ["A7", "4n", n + 0.3]], bass: [["D1", "2n", n], ["A1", "4n", n + 0.15], ["D2", "2n", n + 0.3]] }),
      combo3: n => [["D5", "8n"], ["F5", "8n"], ["A5", "8n"], ["D6", "8n"]],
      combo5: n => [["D5", "8n"], ["F5", "8n"], ["A5", "8n"], ["C#6", "8n"], ["E6", "8n"]],
      wrong: n => [["F3", "16n", n], ["E3", "8n", n + 0.08]],
      tick: n => [["F#5", "32n", n], ["A5", "32n", n + 0.05]],
      countdown: n => [["A4", "16n", n]],
      go: n => [["D5", "16n", n], ["F5", "16n", n + 0.05], ["A5", "8n", n + 0.1]],
      ending: n => ({ bass: [["F2", "8n", n], ["D2", "8n", n + 0.15], ["A1", "4n", n + 0.3]] }),
      chomp: n => [["A3", "32n", n]],
      btnBass: n => [["D3", "32n", n]],
    },
  },
};

export function useSounds(soundTheme) {
  const synthRef = useRef(null);
  const bassRef = useRef(null);
  const btnNoiseRef = useRef(null);
  const initRef = useRef(false);
  const themeRef = useRef(soundTheme);
  themeRef.current = soundTheme;
  const lastInitTheme = useRef(null);

  const init = useCallback(async () => {
    const st = SOUND_THEMES[themeRef.current] || SOUND_THEMES.modern;
    if (initRef.current && lastInitTheme.current === themeRef.current) return;
    // Android: isompi buffer vähentää särinää (default 128 on liian pieni joillekin laitteille)
    if (/android/i.test(navigator.userAgent) && Tone.context?.rawContext?.sampleRate) {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "playback" });
        Tone.setContext(new Tone.Context(ctx));
      } catch {}
    }
    await Tone.start();
    if (initRef.current) {
      try { synthRef.current?.dispose(); } catch {}
      try { bassRef.current?.dispose(); } catch {}
      try { btnNoiseRef.current?.dispose(); } catch {}
    }
    initRef.current = true;
    lastInitTheme.current = themeRef.current;
    synthRef.current = new Tone.PolySynth(Tone.Synth, { maxPolyphony: 8, ...st.synth }).toDestination();
    bassRef.current = new Tone.Synth(st.bass).toDestination();
    const btnFilter = new Tone.Filter({ frequency: st.btnFilter, type: "lowpass" }).toDestination();
    btnNoiseRef.current = new Tone.NoiseSynth(st.btn).connect(btnFilter);
  }, []);

  const reinit = useCallback(async () => {
    if (!initRef.current) return;
    lastInitTheme.current = null;
    await init();
  }, [init]);

  const lastPlayRef = useRef(0);
  const playSynthNotes = useCallback((notesFn) => {
    if (!synthRef.current) return;
    const n = Tone.now();
    // Vapauta vanhat äänet jos edellisestä soitosta <150ms (nopea peräkkäinen soitto)
    if (n - lastPlayRef.current < 0.15) {
      try { synthRef.current.releaseAll(n); } catch {}
    }
    lastPlayRef.current = n;
    const result = notesFn(n);
    if (Array.isArray(result)) {
      result.forEach(args => synthRef.current.triggerAttackRelease(...args));
    } else if (result) {
      if (result.synth) result.synth.forEach(args => synthRef.current.triggerAttackRelease(...args));
      if (result.bass && bassRef.current) result.bass.forEach(args => bassRef.current.triggerAttackRelease(...args));
    }
  }, []);

  const getNotes = useCallback(() => (SOUND_THEMES[themeRef.current] || SOUND_THEMES.modern).notes, []);

  const playByLength = useCallback((len) => {
    const notes = getNotes();
    if (len <= 3) playSynthNotes(notes.find3);
    else if (len === 4) playSynthNotes(notes.find4);
    else if (len === 5) playSynthNotes(notes.find5);
    else if (len === 6) playSynthNotes(notes.find6);
    else if (len === 7) playSynthNotes(notes.find7);
    else if (len < 10) playSynthNotes(notes.find8);
    else {
      playSynthNotes(notes.find10);
      if (btnNoiseRef.current) {
        const n = Tone.now();
        btnNoiseRef.current.triggerAttackRelease("4n", n + 0.2, 0.6);
        btnNoiseRef.current.triggerAttackRelease("8n", n + 0.5, 0.3);
      }
    }
  }, [playSynthNotes, getNotes]);

  const playCombo = useCallback((combo) => {
    if (!synthRef.current) return;
    const n = Tone.now();
    const notes = getNotes();
    const arr = combo >= 5 ? notes.combo5(n) : notes.combo3(n);
    arr.forEach((args, i) => synthRef.current.triggerAttackRelease(args[0], args[1], n + i * 0.04));
    if (bassRef.current && combo >= 3) bassRef.current.triggerAttackRelease("C2", "8n", n);
  }, [getNotes]);

  const playWrong = useCallback(() => { playSynthNotes(getNotes().wrong); }, [playSynthNotes, getNotes]);

  const playTick = useCallback((remaining) => {
    const notes = getNotes();
    if (remaining !== undefined && remaining <= 5) {
      const pitch = ["C6", "D6", "E6", "F#6", "G#6"][5 - remaining] || "G#6";
      playSynthNotes(n => [["E5", "32n", n], [pitch, "32n", n + 0.08]]);
    } else {
      playSynthNotes(notes.tick);
    }
  }, [playSynthNotes, getNotes]);

  const playCountdown = useCallback(() => { playSynthNotes(getNotes().countdown); }, [playSynthNotes, getNotes]);
  const playGo = useCallback(() => { playSynthNotes(getNotes().go); }, [playSynthNotes, getNotes]);

  const playEnding = useCallback(() => {
    const notes = getNotes();
    const n = Tone.now();
    const result = notes.ending(n);
    if (result.bass && bassRef.current) result.bass.forEach(args => bassRef.current.triggerAttackRelease(...args));
    else if (Array.isArray(result) && synthRef.current) result.forEach(args => synthRef.current.triggerAttackRelease(...args));
  }, [getNotes]);

  const playChomp = useCallback(() => { playSynthNotes(getNotes().chomp); }, [playSynthNotes, getNotes]);

  const playBtn = useCallback(() => {
    if (!btnNoiseRef.current || !bassRef.current) return;
    const n = Tone.now();
    const notes = getNotes();
    btnNoiseRef.current.triggerAttackRelease("32n");
    notes.btnBass(n).forEach(args => bassRef.current.triggerAttackRelease(...args));
  }, [getNotes]);

  // Stone slide sound for rotate mode
  const playSlide = useCallback(() => {
    if (!btnNoiseRef.current || !bassRef.current) return;
    const n = Tone.now();
    btnNoiseRef.current.triggerAttackRelease("8n", n);
    bassRef.current.triggerAttackRelease("E1", "8n", n, 0.3);
    bassRef.current.triggerAttackRelease("G1", "16n", n + 0.08, 0.2);
  }, []);

  // Chess piece move sound – short wooden "clack" like a real chess move
  const playChessMove = useCallback(() => {
    if (!synthRef.current || !bassRef.current) return;
    const n = Tone.now();
    synthRef.current.triggerAttackRelease("G5", "32n", n, 0.25);
    synthRef.current.triggerAttackRelease("D5", "32n", n + 0.02, 0.15);
    bassRef.current.triggerAttackRelease("G2", "16n", n, 0.4);
    if (btnNoiseRef.current) btnNoiseRef.current.triggerAttackRelease("64n", n);
  }, []);

  // Chess piece place sound – deeper thud when placing on board
  const playChessPlace = useCallback(() => {
    if (!synthRef.current || !bassRef.current) return;
    const n = Tone.now();
    synthRef.current.triggerAttackRelease("E4", "16n", n, 0.3);
    bassRef.current.triggerAttackRelease("C2", "8n", n, 0.5);
    if (btnNoiseRef.current) btnNoiseRef.current.triggerAttackRelease("32n", n);
  }, []);

  return useMemo(() => ({
    init, reinit, playByLength, playCombo, playWrong, playTick,
    playCountdown, playGo, playEnding, playChomp, playBtn, playSlide,
    playChessMove, playChessPlace,
  }), [init, reinit, playByLength, playCombo, playWrong, playTick,
       playCountdown, playGo, playEnding, playChomp, playBtn, playSlide,
       playChessMove, playChessPlace]);
}

// ============================================================================
// BACKGROUND MUSIC – Two Dots / Monument Valley ambient
// 4 kappaletta, kaikki kappaleet käyttävät samaa Tone.Transportia
// ============================================================================

export const MUSIC_TRACKS = [
  { id: "neon-pulse", name: "Neon Pulse", nameFi: "Neonin syke" },
  { id: "word-away", name: "Word Away", nameFi: "Sana pois" },
  { id: "vapor-tail", name: "Vapor Tail", nameFi: "Höyryvanajälki" },
  { id: "neon-obxa", name: "Neon Pulse OB-Xa", nameFi: "Neonin syke (OB-Xa)" },
];

function startNeonPulse(rev, del) {
  Tone.Transport.bpm.value = 120;
  const seqF = new Tone.Filter({ frequency: 800, type: "lowpass", rolloff: -24, Q: 4 }).connect(rev);
  const seq = new Tone.Synth({ oscillator: { type: "sawtooth" }, envelope: { attack: 0.005, decay: 0.12, sustain: 0.08, release: 0.1 }, volume: -12 }).connect(seqF);
  let filterPhase = 0;
  const leadF = new Tone.Filter({ frequency: 3000, type: "lowpass", rolloff: -12 }).connect(del);
  const lead = new Tone.Synth({ oscillator: { type: "sawtooth" }, envelope: { attack: 0.08, decay: 0.5, sustain: 0.5, release: 1.2 }, volume: -17 }).connect(leadF);
  const padF = new Tone.Filter({ frequency: 1500, type: "lowpass", rolloff: -12 }).connect(rev);
  const pad = new Tone.PolySynth(Tone.Synth, { oscillator: { type: "sawtooth" }, envelope: { attack: 1.0, decay: 1.5, sustain: 0.5, release: 2.5 }, volume: -26 }).connect(padF);
  const kick = new Tone.MembraneSynth({ volume: -10, pitchDecay: 0.05, octaves: 5, envelope: { attack: 0.005, decay: 0.3, sustain: 0, release: 0.2 } }).toDestination();
  const hihat = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.02 }, volume: -22 }).toDestination();
  const snare = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.002, decay: 0.15, sustain: 0, release: 0.1 }, volume: -16 }).toDestination();
  const seqPats = [
    ["A1","A1","A2","A1","A1","A2","A1","A2","A1","A1","A2","A1","E2","A1","A2","A1"],
    ["F1","F1","F2","F1","F1","F2","F1","F2","F1","F1","F2","F1","C2","F1","F2","F1"],
    ["C2","C2","C3","C2","C2","C3","C2","C3","C2","C2","C3","C2","G2","C2","C3","C2"],
    ["G1","G1","G2","G1","G1","G2","G1","G2","G1","G1","G2","G1","D2","G1","G2","G1"],
  ];
  const padCh = [["A3","C4","E4"], ["F3","A3","C4"], ["C3","E3","G3"], ["G3","B3","D4"]];
  const melA = ["E5",null,null,"A5",null,"G5",null,"E5",null,"C5",null,"D5","E5",null,null,null,"G5",null,null,"E5",null,"D5",null,"C5",null,"B4",null,"C5","D5",null,null,null];
  const melB = ["A5",null,null,"C6",null,"B5",null,"A5",null,"G5",null,"A5","B5",null,null,null,"C6",null,"B5","A5",null,"G5",null,"E5",null,"D5",null,"E5",null,null,null,null];
  let ss = 0, sc = 0, pc = 0, ls = 0, beat = 0, useB = false;
  const seqLoop = new Tone.Loop(t => { const n = seqPats[sc % 4][ss % 16]; seq.triggerAttackRelease(n, "32n", t); filterPhase += 0.015; seqF.frequency.setValueAtTime(800 + Math.sin(filterPhase) * 600, t); ss++; if (ss % 16 === 0) sc++; }, "16n");
  const padLoop = new Tone.Loop(t => { pad.triggerAttackRelease(padCh[pc % 4], "1m", t); pc++; }, "1m");
  const leadLoop = new Tone.Loop(t => { const m = useB ? melB : melA; const n = m[ls % 32]; if (n) lead.triggerAttackRelease(n, "4n", t); ls++; if (ls % 32 === 0) useB = !useB; }, "4n");
  const drumLoop = new Tone.Loop(t => { const p = beat % 16; if (p % 4 === 0) kick.triggerAttackRelease("C1", "8n", t); if (p === 4 || p === 12) snare.triggerAttackRelease("16n", t); if (p % 2 === 0) hihat.triggerAttackRelease("32n", t); beat++; }, "16n");
  seqLoop.start(0); drumLoop.start("4m"); padLoop.start("4m"); leadLoop.start("8m");
  return { seq, seqF, lead, leadF, pad, padF, kick, hihat, snare, seqLoop, padLoop, leadLoop, drumLoop };
}

function startWordAway(rev, del) {
  Tone.Transport.bpm.value = 100;
  const chorus = new Tone.Chorus({ frequency: 0.5, delayTime: 6, depth: 0.5, wet: 0.3 }).connect(rev).start();
  const arpF = new Tone.Filter({ frequency: 3500, type: "lowpass", rolloff: -12 }).connect(del);
  const arp = new Tone.Synth({ oscillator: { type: "sawtooth" }, envelope: { attack: 0.005, decay: 0.3, sustain: 0.04, release: 0.45 }, volume: -18 }).connect(arpF);
  const arpB = new Tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.003, decay: 0.35, sustain: 0.02, release: 0.4 }, volume: -25 }).connect(del);
  const strF = new Tone.Filter({ frequency: 2400, type: "lowpass", rolloff: -12 }).connect(chorus);
  const str = new Tone.PolySynth(Tone.Synth, { oscillator: { type: "sawtooth" }, envelope: { attack: 1.5, decay: 2.0, sustain: 0.6, release: 3.0 }, volume: -21 }).connect(strF);
  const leadVib = new Tone.Vibrato({ frequency: 5, depth: 0.1, wet: 0.55 }).connect(del);
  const lead = new Tone.Synth({ oscillator: { type: "sawtooth" }, envelope: { attack: 0.15, decay: 0.8, sustain: 0.5, release: 2.0 }, volume: -17 }).connect(leadVib);
  const bassF = new Tone.Filter({ frequency: 300, type: "lowpass", rolloff: -24 }).connect(rev);
  const bass = new Tone.Synth({ oscillator: { type: "sawtooth" }, envelope: { attack: 0.04, decay: 0.5, sustain: 0.35, release: 0.6 }, volume: -14 }).connect(bassF);
  const kick = new Tone.MembraneSynth({ volume: -12, pitchDecay: 0.06, octaves: 4, envelope: { attack: 0.005, decay: 0.35, sustain: 0, release: 0.25 } }).toDestination();
  const hihat = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.035, sustain: 0, release: 0.025 }, volume: -25 }).toDestination();
  const snare = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.002, decay: 0.16, sustain: 0, release: 0.1 }, volume: -18 }).connect(rev);
  const arpN = { G: ["G3","B3","D4","G4","D4","B3","G3","D4","B3","G4","D4","B3","G3","B3","D4","G4"], "D/F#": ["F#3","A3","D4","F#4","D4","A3","F#3","D4","A3","F#4","D4","A3","F#3","A3","D4","F#4"], Em7: ["E3","G3","B3","D4","B3","G3","E3","B3","G3","D4","B3","G3","E3","G3","B3","D4"], Am: ["A2","C3","E3","A3","E3","C3","A2","E3","C3","A3","E3","C3","A2","C3","E3","A3"], D: ["D3","F#3","A3","D4","A3","F#3","D3","A3","F#3","D4","A3","F#3","D3","F#3","A3","D4"], C: ["C3","E3","G3","C4","G3","E3","C3","G3","E3","C4","G3","E3","C3","E3","G3","C4"] };
  const strV = { G: ["G2","B2","D3"], "D/F#": ["F#2","A2","D3"], Em7: ["E2","G2","B2","D3"], Am: ["A1","C2","E2"], D: ["D2","F#2","A2"], C: ["C2","E2","G2"] };
  const bassN = { G: "G1", "D/F#": "F#1", Em7: "E1", Am: "A1", D: "D1", C: "C1" };
  const song = ["G","D/F#","Em7","D/F#","G","D/F#","Em7","D/F#","G","D/F#","Em7","D/F#","G","D/F#","Em7","D/F#","Am","Am","D","D","G","D/F#","C","D","G","D/F#","C","D","G","D/F#","C","D"];
  const melV = ["B4",null,null,"D5","A4",null,null,"F#4","G4",null,"B4",null,"A4",null,null,null,"B4",null,"D5",null,"E5",null,"D5",null,"B4",null,null,"A4",null,null,null,null,"C5",null,null,"E5","D5",null,"C5",null,"D5",null,null,null,"F#5",null,null,null,"G5",null,null,"F#5","E5",null,"D5",null,"C5",null,"D5",null,null,null,null,null];
  const melC = ["B5",null,"A5","G5","F#5",null,"E5",null,"E5",null,"D5",null,"D5","E5","F#5",null,"B5",null,"A5","G5","F#5",null,"E5","D5","E5",null,null,null,null,null,null,null];
  let as2 = 0, ab = 0, sb = 0, bb = 0, bh = 0, ls2 = 0, lsb = 0, beat = 0, fp = 0;
  const arpLoop = new Tone.Loop(t => { const ch = song[ab % song.length]; const ns = arpN[ch] || arpN.G; arp.triggerAttackRelease(ns[as2 % 16], "32n", t); arpB.triggerAttackRelease(ns[as2 % 16], "32n", t); fp += 0.007; arpF.frequency.setValueAtTime(2800 + Math.sin(fp) * 1200, t); as2++; if (as2 % 16 === 0) ab++; }, "16n");
  const strLoop = new Tone.Loop(t => { const ch = song[sb % song.length]; str.triggerAttackRelease(strV[ch] || strV.G, "1m", t); sb++; }, "1m");
  const bassLoop = new Tone.Loop(t => { const ch = song[bb % song.length]; bass.triggerAttackRelease(bassN[ch] || "G1", "4n", t); bh++; if (bh % 2 === 0) bb++; }, "2n");
  const leadLoop = new Tone.Loop(t => { const sb2 = lsb % song.length; const isChorus = sb2 >= 24; const m = isChorus ? melC : melV; const idx = isChorus ? (ls2 % 32) : (ls2 % 64); const n = m[idx]; if (n) lead.triggerAttackRelease(n, "4n.", t); ls2++; if (ls2 % (isChorus ? 32 : 64) === 0) lsb++; }, "4n");
  const drumLoop = new Tone.Loop(t => { const p = beat % 16; if (p === 0 || p === 8) kick.triggerAttackRelease("C1", "8n", t); if (p === 4 || p === 12) snare.triggerAttackRelease("16n", t); if (p % 2 === 0) hihat.triggerAttackRelease("32n", t); beat++; }, "16n");
  arpLoop.start(0); strLoop.start("4m"); bassLoop.start("4m"); drumLoop.start("4m"); leadLoop.start("8m");
  return { arp, arpF, arpB, str, strF, lead, leadVib, bass, bassF, kick, hihat, snare, chorus, arpLoop, strLoop, bassLoop, leadLoop, drumLoop };
}

function startVaporTail(rev, del) {
  Tone.Transport.bpm.value = 82;
  const chorus = new Tone.Chorus({ frequency: 0.3, delayTime: 8, depth: 0.7, wet: 0.4 }).connect(rev).start();
  const del2 = new Tone.FeedbackDelay({ delayTime: "2n", feedback: 0.2, wet: 0.18 }).connect(rev);
  const chF = new Tone.Filter({ frequency: 2000, type: "lowpass", rolloff: -12 }).connect(chorus);
  const chord = new Tone.PolySynth(Tone.Synth, { oscillator: { type: "sawtooth" }, envelope: { attack: 0.08, decay: 1.2, sustain: 0.3, release: 2.5 }, volume: -18 }).connect(chF);
  const shimF = new Tone.Filter({ frequency: 4000, type: "lowpass", rolloff: -12 }).connect(del);
  const shim = new Tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.004, decay: 0.4, sustain: 0.02, release: 0.5 }, volume: -24 }).connect(shimF);
  const padF = new Tone.Filter({ frequency: 900, type: "lowpass", rolloff: -24, Q: 2 }).connect(chorus);
  const pad = new Tone.PolySynth(Tone.Synth, { oscillator: { type: "sawtooth" }, envelope: { attack: 3.0, decay: 3.0, sustain: 0.7, release: 5.0 }, volume: -25 }).connect(padF);
  const bassF2 = new Tone.Filter({ frequency: 250, type: "lowpass", rolloff: -24 }).connect(rev);
  const bass = new Tone.Synth({ oscillator: { type: "sawtooth" }, envelope: { attack: 0.1, decay: 0.8, sustain: 0.4, release: 1.2 }, volume: -16 }).connect(bassF2);
  const leadVib = new Tone.Vibrato({ frequency: 4, depth: 0.12, wet: 0.6 }).connect(del2);
  const lead = new Tone.Synth({ oscillator: { type: "sawtooth" }, envelope: { attack: 0.2, decay: 1.0, sustain: 0.45, release: 2.5 }, volume: -19 }).connect(leadVib);
  const kick = new Tone.MembraneSynth({ volume: -15, pitchDecay: 0.07, octaves: 3.5, envelope: { attack: 0.008, decay: 0.4, sustain: 0, release: 0.3 } }).toDestination();
  const rim = new Tone.NoiseSynth({ noise: { type: "pink" }, envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.025 }, volume: -24 }).connect(rev);
  const chV = [["F3","A3","C4","E4"], ["A3","C4","E4","G4"], ["D3","F3","A3","C4"], ["Bb2","D3","F3","A3"]];
  const padCh = [["F2","C3","E3"], ["A2","E3","G3"], ["D2","A2","C3"], ["Bb1","F2","A2"]];
  const bN = ["F1","A1","D1","Bb0"];
  const shimP = [["E5",null,null,"C5",null,null,"A4",null], ["G5",null,null,"E5",null,null,"C5",null], ["C5",null,null,"A4",null,null,"F4",null], ["A4",null,null,"F4",null,null,"D4",null]];
  const melA = ["A5",null,null,null,"G5",null,null,null,"F5",null,null,"E5",null,null,null,null,null,null,"D5",null,null,"C5",null,null,null,null,null,null,null,null,null,null];
  const melB = ["C6",null,null,null,"Bb5",null,null,null,"A5",null,null,"G5",null,null,"F5",null,null,null,"E5",null,"F5",null,"G5",null,"A5",null,null,null,null,null,null,null];
  let cc = 0, pc2 = 0, bc = 0, shs = 0, shc = 0, ls3 = 0, beat = 0, useB = false, cfp = 0;
  let chBt = 0;
  const chLoop = new Tone.Loop(t => { const p = chBt % 8; if (p === 0 || p === 3 || p === 6) { chord.triggerAttackRelease(chV[cc % 4], "4n", t); cfp += 0.15; chF.frequency.setValueAtTime(1200 + Math.sin(cfp) * 800, t); } chBt++; if (chBt % 8 === 0) cc++; }, "8n");
  const padLoop = new Tone.Loop(t => { pad.triggerAttackRelease(padCh[pc2 % 4], "2m", t); pc2++; }, "2m");
  const bassLoop = new Tone.Loop(t => { bass.triggerAttackRelease(bN[bc % 4], "1m", t); bc++; }, "1m");
  const shimLoop = new Tone.Loop(t => { const n = shimP[shc % 4][shs % 8]; if (n) shim.triggerAttackRelease(n, "8n", t); shs++; if (shs % 8 === 0) shc++; }, "8n");
  const leadLoop = new Tone.Loop(t => { const m = useB ? melB : melA; const n = m[ls3 % 32]; if (n) lead.triggerAttackRelease(n, "2n", t); ls3++; if (ls3 % 32 === 0) useB = !useB; }, "4n");
  const drumLoop = new Tone.Loop(t => { const p = beat % 32; if (p === 0 || p === 16) kick.triggerAttackRelease("C1", "4n", t); if (p % 8 === 4) rim.triggerAttackRelease("32n", t); beat++; }, "16n");
  chLoop.start(0); padLoop.start("2m"); shimLoop.start("4m"); bassLoop.start("4m"); drumLoop.start("6m"); leadLoop.start("10m");
  return { chord, chF, shim, shimF, pad, padF, bass, bassF: bassF2, lead, leadVib, kick, rim, chorus, del2, chLoop, padLoop, bassLoop, shimLoop, leadLoop, drumLoop };
}

function startLaserSilk(rev, del) {
  // OB-Xa-tyylinen Neon Pulse: paksut detunatut fatsawtoothit, lowpass-resonance,
  // brass-tyylinen lead + filter-envelope, warm-string pad ja vibrato leadissä.
  Tone.Transport.bpm.value = 120;

  const bassF = new Tone.Filter({ frequency: 900, type: "lowpass", rolloff: -24, Q: 6 }).connect(rev);
  const bass = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "fatsawtooth", count: 2, spread: 18 },
    envelope: { attack: 0.005, decay: 0.18, sustain: 0.10, release: 0.10 },
    volume: -10,
  }).connect(bassF);
  let bassPhase = 0;

  const leadVib = new Tone.Vibrato({ frequency: 5.4, depth: 0.05, wet: 0.5 }).connect(del);
  const leadF = new Tone.Filter({ frequency: 1950, type: "lowpass", rolloff: -24, Q: 3 }).connect(leadVib);
  const lead = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "fatsawtooth", count: 2, spread: 22 },
    envelope: { attack: 0.18, decay: 0.6, sustain: 0.65, release: 1.0 },
    volume: -14,
  }).connect(leadF);
  const leadEnv = new Tone.FrequencyEnvelope({
    attack: 0.04, decay: 0.5, sustain: 0.45, release: 0.9,
    baseFrequency: 600, octaves: 2.4, exponent: 2,
  }).connect(leadF.frequency);

  const padF = new Tone.Filter({ frequency: 1300, type: "lowpass", rolloff: -12 }).connect(rev);
  const pad = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "fatsawtooth", count: 3, spread: 28 },
    envelope: { attack: 1.4, decay: 1.6, sustain: 0.7, release: 3.0 },
    volume: -22,
  }).connect(padF);

  const kick = new Tone.MembraneSynth({ volume: -10, pitchDecay: 0.05, octaves: 5,
    envelope: { attack: 0.005, decay: 0.3, sustain: 0, release: 0.2 } }).toDestination();
  const snare = new Tone.NoiseSynth({ noise: { type: "white" },
    envelope: { attack: 0.002, decay: 0.15, sustain: 0, release: 0.1 }, volume: -18 }).connect(rev);
  const hihat = new Tone.NoiseSynth({ noise: { type: "white" },
    envelope: { attack: 0.001, decay: 0.025, sustain: 0, release: 0.02 }, volume: -26 }).toDestination();

  // Sama Neon Pulse melodia ja sointukulku kuin startNeonPulse:ssa
  const seqPats = [
    ["A1","A1","A2","A1","A1","A2","A1","A2","A1","A1","A2","A1","E2","A1","A2","A1"],
    ["F1","F1","F2","F1","F1","F2","F1","F2","F1","F1","F2","F1","C2","F1","F2","F1"],
    ["C2","C2","C3","C2","C2","C3","C2","C3","C2","C2","C3","C2","G2","C2","C3","C2"],
    ["G1","G1","G2","G1","G1","G2","G1","G2","G1","G1","G2","G1","D2","G1","G2","G1"],
  ];
  const padCh = [["A3","C4","E4"], ["F3","A3","C4"], ["C3","E3","G3"], ["G3","B3","D4"]];
  const melA = ["E5",null,null,"A5",null,"G5",null,"E5",null,"C5",null,"D5","E5",null,null,null,"G5",null,null,"E5",null,"D5",null,"C5",null,"B4",null,"C5","D5",null,null,null];
  const melB = ["A5",null,null,"C6",null,"B5",null,"A5",null,"G5",null,"A5","B5",null,null,null,"C6",null,"B5","A5",null,"G5",null,"E5",null,"D5",null,"E5",null,null,null,null];

  let ss = 0, sc = 0, pc = 0, ls = 0, beat = 0, useB = false;

  const seqLoop = new Tone.Loop(t => {
    const n = seqPats[sc % 4][ss % 16];
    bass.triggerAttackRelease(n, "32n", t);
    bassPhase += 0.018;
    bassF.frequency.setValueAtTime(700 + Math.sin(bassPhase) * 350, t);
    ss++; if (ss % 16 === 0) sc++;
  }, "16n");
  const padLoop = new Tone.Loop(t => { pad.triggerAttackRelease(padCh[pc % 4], "1m", t); pc++; }, "1m");
  const leadLoop = new Tone.Loop(t => {
    const m = useB ? melB : melA;
    const n = m[ls % 32];
    if (n) {
      lead.triggerAttackRelease(n, "4n", t);
      leadEnv.triggerAttackRelease("4n", t);
    }
    ls++; if (ls % 32 === 0) useB = !useB;
  }, "4n");
  const drumLoop = new Tone.Loop(t => {
    const p = beat % 16;
    if (p % 4 === 0) kick.triggerAttackRelease("C1", "8n", t);
    if (p === 4 || p === 12) snare.triggerAttackRelease("16n", t);
    if (p % 2 === 0) hihat.triggerAttackRelease("32n", t);
    beat++;
  }, "16n");

  seqLoop.start(0);
  drumLoop.start("4m");
  padLoop.start("4m");
  leadLoop.start("8m");

  return { bass, bassF, lead, leadF, leadEnv, leadVib, pad, padF, kick, snare, hihat, seqLoop, padLoop, leadLoop, drumLoop };
}

export function useMusic(trackId) {
  const partsRef = useRef(null);
  const startedRef = useRef(false);
  const trackRef = useRef(trackId);
  trackRef.current = trackId;

  const stop = useCallback(() => {
    if (!startedRef.current) return;
    startedRef.current = false;
    const p = partsRef.current;
    if (p) {
      try { Tone.Transport.stop(); Tone.Transport.cancel(); } catch {}
      setTimeout(() => {
        Object.values(p).forEach(v => { try { if (v.stop) v.stop(); if (v.dispose) v.dispose(); } catch {} });
      }, 500);
      partsRef.current = null;
    }
  }, []);

  const start = useCallback(async () => {
    if (startedRef.current) return;
    await Tone.start();
    startedRef.current = true;
    const rev = new Tone.Reverb({ decay: 3, wet: 0.2 }).toDestination();
    const del = new Tone.FeedbackDelay({ delayTime: "8n", feedback: 0.18, wet: 0.12 }).connect(rev);
    const tid = trackRef.current || 0;
    let trackParts;
    if (tid === 1) trackParts = startWordAway(rev, del);
    else if (tid === 2) trackParts = startVaporTail(rev, del);
    else if (tid === 3) trackParts = startLaserSilk(rev, del);
    else trackParts = startNeonPulse(rev, del);
    Tone.Transport.start();
    partsRef.current = { ...trackParts, rev, del };
  }, []);

  const restart = useCallback(async () => {
    stop();
    await new Promise(r => setTimeout(r, 600));
    startedRef.current = false;
    await start();
  }, [stop, start]);

  return useMemo(() => ({ start, stop, restart }), [start, stop, restart]);
}
