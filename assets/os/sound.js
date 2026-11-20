/* Atlas After Hours — a locally synthesized 16-bar cue at 74 BPM. */
(() => {
  'use strict';
  let context;
  let bus;
  let voice;
  let rendering;
  let level = 0.42;
  let generation = 0;
  const bpm = 74;
  const beat = 60 / bpm;
  const hz = note => 440 * 2 ** ((note - 69) / 12);

  function compose() {
    const sampleRate = 24000;
    const duration = 64 * beat;
    const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const score = new Offline(2, Math.round(duration * sampleRate), sampleRate);
    const color = score.createBiquadFilter();
    color.type = 'lowpass';
    color.frequency.value = 3500;
    color.Q.value = 0.45;
    color.connect(score.destination);
    const echo = score.createDelay(1);
    echo.delayTime.value = beat * 0.75;
    const send = score.createGain();
    send.gain.value = 0.16;
    echo.connect(send).connect(color);

    let seed = 137;
    function random() {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    }
    function tone(at, length, pitch, volume, timbre, pan = 0, delaySend = false) {
      const oscillator = score.createOscillator();
      oscillator.type = timbre;
      oscillator.frequency.value = hz(pitch);
      const envelope = score.createGain();
      envelope.gain.setValueAtTime(0.00001, at);
      envelope.gain.exponentialRampToValueAtTime(volume, at + 0.015);
      envelope.gain.exponentialRampToValueAtTime(volume * 0.4, at + length * 0.42);
      envelope.gain.exponentialRampToValueAtTime(0.00001, at + length);
      const placement = score.createStereoPanner();
      placement.pan.value = pan;
      oscillator.connect(envelope).connect(placement).connect(color);
      if (delaySend) placement.connect(echo);
      oscillator.start(at);
      oscillator.stop(at + length + 0.01);
    }
    const noiseBuffer = score.createBuffer(1, sampleRate, sampleRate);
    const samples = noiseBuffer.getChannelData(0);
    for (let n = 0; n < samples.length; n++) samples[n] = random() * 2 - 1;
    function brush(at, volume, length, frequency) {
      const sample = score.createBufferSource();
      sample.buffer = noiseBuffer;
      const filter = score.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = frequency;
      filter.Q.value = 0.7;
      const envelope = score.createGain();
      envelope.gain.setValueAtTime(0.00001, at);
      envelope.gain.linearRampToValueAtTime(volume, at + 0.008);
      envelope.gain.exponentialRampToValueAtTime(0.00001, at + length);
      sample.connect(filter).connect(envelope).connect(color);
      sample.start(at, random() * 0.5, length);
    }
    function kick(at, level) {
      const osc = score.createOscillator();
      const env = score.createGain();
      osc.frequency.setValueAtTime(110, at);
      osc.frequency.exponentialRampToValueAtTime(46, at + 0.13);
      env.gain.setValueAtTime(0.0001, at);
      env.gain.linearRampToValueAtTime(level, at + 0.006);
      env.gain.exponentialRampToValueAtTime(0.0001, at + 0.25);
      osc.connect(env).connect(color);
      osc.start(at);
      osc.stop(at + 0.26);
    }

    // Open voicings leave room for a second phrase answering the first.
    const harmony = [
      [50, 57, 60, 64, 65], [43, 55, 59, 62, 65], [48, 55, 59, 62, 64], [45, 55, 59, 60, 64],
      [53, 57, 60, 64, 67], [40, 55, 59, 62, 65], [45, 55, 59, 60, 64], [45, 55, 58, 61, 64]
    ];
    const melody = [[72,69], [71,67], [67,64], [null,67], [69,72], [71,68], [72,69], [null,70]];
    for (let bar = 0; bar < 16; bar++) {
      const start = bar * beat * 4;
      const chord = harmony[bar % 8];
      const bass = chord[0] - 12;
      for (const hit of [0.055, 2.57]) {
        chord.slice(1).forEach((pitch, i) => {
          const t = start + hit * beat + i * 0.019;
          const duration = hit < 1 ? 1.48 * beat : 0.97 * beat;
          tone(t, duration, pitch, 0.053 * (0.91 + 0.13 * random()), 'triangle', (i-1.5)*0.12, true);
          tone(t, duration * 0.31, pitch + 12, 0.012, 'sine', 0.1);
        });
      }
      tone(start, 1.37 * beat, bass, 0.155, 'sine', -0.04);
      tone(start + 2.48 * beat, 0.74 * beat, bass + (bar % 4 === 3 ? 10 : 7), 0.085, 'triangle', -0.04);
      const motif = melody[bar % 8];
      motif.forEach((pitch, i) => {
        if (pitch === null || (bar < 4 && i === 1)) return;
        const t = start + (i ? 3.12 : 1.54) * beat;
        tone(t, beat * 0.68, pitch + (bar > 11 && i ? 12 : 0), 0.043, 'sine', 0.22, true);
      });
      kick(start + 0.015, 0.14);
      if (bar % 4 !== 3) kick(start + beat * 2.54, 0.11);
      brush(start + beat * 1.04, 0.12, 0.13, 1550);
      brush(start + beat * 3.045, 0.115, 0.14, 1400);
      for (let half = 0; half < 8; half++) {
        if (half === 6 && bar % 2 === 1) continue;
        brush(start + (half * 0.5 + (half % 2) * 0.061) * beat,
          half % 2 ? 0.032 : 0.047, 0.06 + random() * 0.03, 4500);
      }
    }
    return score.startRendering();
  }

  async function start() {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) throw new Error('Web Audio');
    if (!context) {
      context = new Audio();
      bus = context.createGain();
      bus.gain.value = 0;
      bus.connect(context.destination);
    }
    const token = ++generation;
    await context.resume();
    if (!rendering) rendering = compose().catch(err => { rendering = undefined; throw err; });
    const buffer = await rendering;
    if (token !== generation) return;
    if (!voice) {
      voice = context.createBufferSource();
      voice.buffer = buffer;
      voice.loop = true;
      voice.connect(bus);
      voice.start();
    }
    setVolume(level);
  }
  function stop() {
    generation++;
    if (!voice) return;
    const prior = voice;
    voice = undefined;
    const fade = context.createGain();
    prior.disconnect();
    prior.connect(fade).connect(context.destination);
    fade.gain.setValueAtTime(bus.gain.value, context.currentTime);
    fade.gain.setTargetAtTime(0, context.currentTime, 0.035);
    prior.stop(context.currentTime + 0.19);
    prior.onended = () => { prior.disconnect(); fade.disconnect(); };
  }
  function setVolume(value) {
    level = Math.min(1, Math.max(0, Number(value) || 0));
    if (context && bus) bus.gain.setTargetAtTime(level, context.currentTime, 0.055);
  }
  window.AtlasSound = Object.freeze({ start, stop, setVolume });
})();
