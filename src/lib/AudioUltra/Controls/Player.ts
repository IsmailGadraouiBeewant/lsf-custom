import { Destructable } from '../Common/Destructable';
import { WaveformAudio } from '../Media/WaveformAudio';
import { clamp } from '../Common/Utils';
import { Waveform } from '../Waveform';

export class Player extends Destructable {
  private audio?: WaveformAudio;
  private wf: Waveform;
  private timer!: number;
  private loop:  {start: number, end: number}|null = null;
  private timestamp = 0;
  private time = 0;
  private connected = false;
  private ended = false;
  private _rate = 1;

  playing = false;

  constructor(wf: Waveform) {
    super();

    this.wf = wf;
    this._rate = wf.params.rate ?? this._rate;
  }

  /**
   * Get current playback speed
   */
  get rate() {
    if (this.audio?.source?.playbackRate.value) {
      if (this.audio.source.playbackRate.value !== this._rate) {
        this.audio.source.playbackRate.value = this._rate; // restore the correct rate
      }
    }

    return this._rate;
  }

  /**
   * Set playback speed
   */
  set rate(value: number) {
    const rateChanged = this._rate !== value;

    this._rate = value;

    if (this.audio?.source) {
      this.audio.source.playbackRate.value = value;

      if (rateChanged) {
        this.wf.invoke('rateChanged', [value]);
      }
    }
  }

  get duration() {
    return this.audio?.buffer?.duration ?? 0;
  }

  get volume() {
    return this.audio?.gain?.gain.value ?? 1;
  }

  set volume(value: number) {
    if (this.audio) {

      const volumeChanged = this.volume !== value;

      this.audio.volume = value;

      if (volumeChanged) {
        this.wf.invoke('volumeChange', [value]);
      }
    }
  }

  get currentTime() {
    return this.time;
  }

  private set currentTime(value: number) {
    this.ended = false;
    this.setCurrentTime(value, true);
  }

  setCurrentTime(value: number, notify = false) {
    this.time = value;
    if (notify) {
      this.wf.invoke('seek', [this.time]);
    }
  }

  get muted() {
    return this.audio?.volume === 0;
  }

  set muted(muted: boolean) {
    if (!this.audio) return;

    if (this.audio.muted === muted) return;

    if (muted) {
      this.audio.mute();
    } else {
      this.audio.unmute();
    }

    this.wf.invoke('muted', [this.audio.muted]);
  }

  init(audio: WaveformAudio) {
    this.audio = audio;
  }

  seek(time: number) {
    const newTime = clamp(time, 0, this.duration);

    this.currentTime = newTime;

    if (this.playing) {
      this.updatePlayback();
    }
  }

  play(from?: number, to?: number) {
    if (this.isDestroyed || this.playing || !this.audio) return;
    if (this.ended) {
      this.currentTime = from ?? 0;
    }
    const { start, end } = this.playSelection(from, to);

    this.playRange(start, end);
  }

  handleEnded = () => {
    if (this.loop) return;
    this.ended = true;
    this.updateCurrentTime(true);
    this.pause();
    this.wf.invoke('playend');
  };

  pause() {
    if (this.isDestroyed || !this.playing || !this.audio) return;
    this.stopWatch();
    this.disconnectSource();
    this.playing = false;
    this.loop = null;
    this.wf.invoke('pause');
    this.wf.invoke('seek', [this.currentTime]);
  }

  stop() {
    if (this.isDestroyed) return;
    this.stopWatch();
    this.disconnectSource();
    this.playing = false;
    this.loop = null;
  }

  destroy() {
    this.stop();
    this.cleanupSource();
    super.destroy();
  }

  private updatePlayback() {
    const { start, end } = this.playSelection();

    this.playSource(start, end);
  }

  private playRange(start?: number, end?: number) {
    if (start) {
      this.currentTime = start;
    }
    this.playSource(start, end);
    this.wf.invoke('play');
  }

  private playSource(start?: number, duration?: number) {
    this.stopWatch();
    this.timestamp = performance.now();
    this.recreateSource();

    if (!this.audio?.source) return;

    this.playing = true;

    if (this.loop) {
      if (this.currentTime < this.loop.start || this.currentTime > this.loop.end) {
        this.currentTime = this.loop.start;
      }

      duration = clamp(this.loop.end, 0, this.duration);
      start = clamp(this.loop.start, 0, duration);
    }

    this.audio.source.start(0, start ?? 0, duration ?? this.duration);
    this.audio.source.addEventListener('ended', this.handleEnded);
    this.watch();
  }

  private playSelection(from?: number, to?: number) {
    const selected = this.wf.regions.selected;

    const looping = selected.length > 0;

    if (looping) {
      const regionsStart = Math.min(...selected.map(r => r.start));
      const regionsEnd = Math.max(...selected.map(r => r.end));

      const start = clamp(this.currentTime, regionsStart, regionsEnd);

      this.loop = { start: regionsStart, end: regionsEnd };

      return {
        start,
        end: regionsEnd,
      };
    } 
    const start = from ?? this.currentTime;
    const end = to !== undefined ? (to - start) : undefined;

    return { start, end };
  }

  private recreateSource() {
    if (this.connected) {
      this.disconnectSource();
    }
    this.connectSource();
  }

  private connectSource() {
    if (this.isDestroyed || !this.audio || this.connected) return;
    this.connected = true;
    this.audio.connect();
  }

  private disconnectSource() {
    if (this.isDestroyed || !this.audio || !this.connected) return;
    this.connected = false;
    this.audio.source?.removeEventListener('ended', this.handleEnded);
    this.audio.source?.stop(0);
    this.audio.disconnect();
  }

  private cleanupSource() {
    if (this.isDestroyed || !this.audio) return;
    this.disconnectSource();

    delete this.audio.source;
    delete this.audio;
  }


  private watch = () => {
    if (!this.playing) return;

    this.updateCurrentTime();
    this.updateLoop(this.time);

    this.timer = requestAnimationFrame(this.watch);
  };

  private updateLoop(time: number) {
    if (this.isDestroyed || !this.loop) return;
    if (time >= this.loop.end) {
      this.currentTime = this.loop.start;
      this.playing = false;
      this.play();
    }
  }

  private updateCurrentTime(forceTimeToEnd?: boolean) {
    const now = performance.now();
    const tick = (( now - this.timestamp) / 1000) * this.rate;

    this.timestamp = now;

    const end = this.loop?.end ?? this.duration;

    const newTime = forceTimeToEnd ? this.duration : clamp(this.time + tick, 0, end); 

    this.time = newTime;
    this.wf.invoke('playing', [this.time]);
  }

  private stopWatch() {
    cancelAnimationFrame(this.timer);
  }
}
