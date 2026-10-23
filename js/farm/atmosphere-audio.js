// Quiet synthesized ambience avoids downloaded audio, looping files and autoplay.
export class AtmosphereAudio {
    async enable() {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) throw new Error('此瀏覽器不支援環境音');
        if (!this.context) {
            this.context = new AudioContext();
            const ctx = this.context;
            this.master = ctx.createGain(); this.master.gain.value = 0;
            this.master.connect(ctx.destination);
            const buffer = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
            const samples = buffer.getChannelData(0);
            let last = 0;
            for (let i = 0; i < samples.length; i++) { last = (last + (Math.random() * 2 - 1) * .025) / 1.025; samples[i] = last * 4; }
            this.wind = ctx.createBufferSource(); this.wind.buffer = buffer; this.wind.loop = true;
            this.filter = ctx.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = 450;
            this.wind.connect(this.filter); this.filter.connect(this.master); this.wind.start();
        }
        await this.context.resume();
    }
    update(state, audible) {
        if (!this.context || this.context.state === 'closed') return;
        const now = this.context.currentTime;
        this.master.gain.setTargetAtTime(audible ? .055 + state.weights.rain * .07 : 0, now, .6);
        this.filter.frequency.setTargetAtTime(350 + state.weights.rain * 2300 + state.weights.cloudy * 250, now, 2);
        if (!audible || state.weights.rain > .5 || now < (this.nextCall || 0)) return;
        this.nextCall = now + 5 + Math.random() * 7;
        const oscillator = this.context.createOscillator(), gain = this.context.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(state.night > .5 ? 3100 : 1800, now);
        oscillator.frequency.exponentialRampToValueAtTime(state.night > .5 ? 3500 : 2600, now + .13);
        gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(.08, now + .025); gain.gain.exponentialRampToValueAtTime(.0001, now + .24);
        oscillator.connect(gain); gain.connect(this.master); oscillator.start(); oscillator.stop(now + .25);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    }
    destroy() { if (this.context) { this.context.close().catch(() => {}); this.context = null; } }
}
