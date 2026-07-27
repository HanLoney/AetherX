(function exposeMoodHeartbeat(global) {
  const ECG_SECONDS_ACROSS = 2.8;
  const RHYTHM_LABELS = Object.freeze({
    resting: "舒缓",
    steady: "平稳",
    lively: "轻快",
    alert: "微快"
  });

  class AetherMoodHeartbeat {
    constructor({ canvas, bpmElement, rhythmElement }) {
      this.canvas = canvas;
      this.context = canvas?.getContext("2d") || null;
      this.bpmElement = bpmElement;
      this.rhythmElement = rhythmElement;
      this.targetBpm = 67;
      this.displayBpm = 67;
      this.rhythm = "steady";
      this.initialized = false;
      this.frame = 0;
      this.lastFrameAt = 0;
      this.trace = [];
      this.tracePhase = 0;
      this.traceCarryMs = 0;
      this.traceElapsedSeconds = 0;
      this.tick = this.tick.bind(this);
    }

    setSnapshot(snapshot = {}) {
      const physiology = snapshot.state?.state?.physiology || {};
      this.targetBpm = clamp(Number(physiology.heartRateBpm) || 67, 54, 108);
      if (!this.initialized) {
        this.displayBpm = this.targetBpm;
        this.initialized = true;
      }
      this.rhythm = RHYTHM_LABELS[physiology.rhythm]
        ? physiology.rhythm
        : "steady";
      this.updateLabels();
      this.start();
    }

    start() {
      if (!this.context || this.frame) return;
      this.lastFrameAt = performance.now();
      this.frame = requestAnimationFrame(this.tick);
    }

    stop() {
      if (this.frame) cancelAnimationFrame(this.frame);
      this.frame = 0;
    }

    destroy() {
      this.stop();
      this.context?.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    tick(now) {
      const elapsed = Math.min(80, Math.max(0, now - this.lastFrameAt));
      this.lastFrameAt = now;
      const easing = 1 - Math.exp(-elapsed / 900);
      this.displayBpm += (this.targetBpm - this.displayBpm) * easing;
      this.updateLabels(now);
      this.draw(elapsed);
      this.frame = requestAnimationFrame(this.tick);
    }

    updateLabels(now = performance.now()) {
      const naturalVariation = Math.sin(now / 4300) * .7 + Math.sin(now / 1700) * .25;
      if (this.bpmElement) {
        this.bpmElement.textContent = String(Math.round(this.displayBpm + naturalVariation));
      }
      if (this.rhythmElement) {
        this.rhythmElement.textContent = RHYTHM_LABELS[this.rhythm] || "平稳";
      }
    }

    draw(elapsed) {
      const rect = this.canvas.getBoundingClientRect();
      const ratio = Math.max(1, Math.min(2, global.devicePixelRatio || 1));
      const width = Math.max(1, Math.round(rect.width * ratio));
      const height = Math.max(1, Math.round(rect.height * ratio));
      const traceLength = Math.max(160, Math.round(rect.width * 3));
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
      }
      if (this.trace.length !== traceLength) {
        this.trace = createEcgTrace({
          sampleCount: traceLength,
          bpm: this.displayBpm,
          secondsAcross: ECG_SECONDS_ACROSS,
          endPhase: this.tracePhase
        });
        this.traceCarryMs = 0;
      }
      this.advanceTrace(elapsed, traceLength);
      const context = this.context;
      context.clearRect(0, 0, width, height);
      context.lineWidth = 1.12 * ratio;
      context.lineJoin = "round";
      context.lineCap = "round";
      context.strokeStyle = getComputedStyle(this.canvas).color;
      context.shadowColor = context.strokeStyle;
      context.shadowBlur = 1.6 * ratio;
      const baseline = height * .55;
      const amplitude = height * .34;
      context.beginPath();
      this.trace.forEach((sample, index) => {
        const x = index / (this.trace.length - 1) * width;
        const y = baseline - sample * amplitude;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.stroke();
      context.shadowBlur = 0;
    }

    advanceTrace(elapsed, traceLength) {
      const sampleIntervalMs = ECG_SECONDS_ACROSS * 1000 / (traceLength - 1);
      this.traceCarryMs += elapsed;
      while (this.traceCarryMs >= sampleIntervalMs) {
        this.traceCarryMs -= sampleIntervalMs;
        this.traceElapsedSeconds += sampleIntervalMs / 1000;
        const naturalBpm = clamp(
          this.displayBpm
            + Math.sin(this.traceElapsedSeconds / 3.7) * .34
            + Math.sin(this.traceElapsedSeconds / 8.3) * .18,
          54,
          108
        );
        this.tracePhase = positiveModulo(
          this.tracePhase + sampleIntervalMs / 1000 * naturalBpm / 60,
          1
        );
        const baselineDrift = Math.sin(this.traceElapsedSeconds * .72) * .008;
        this.trace.push(ecgWave(this.tracePhase) + baselineDrift);
        this.trace.shift();
      }
    }
  }

  function createEcgTrace({ sampleCount, bpm, secondsAcross, endPhase = 0 }) {
    const count = Math.max(2, Math.round(sampleCount));
    const safeBpm = clamp(Number(bpm) || 67, 54, 108);
    return Array.from({ length: count }, (_, index) => {
      const secondsAgo = (1 - index / (count - 1)) * secondsAcross;
      const phase = positiveModulo(endPhase - secondsAgo * safeBpm / 60, 1);
      return ecgWave(phase);
    });
  }

  function ecgWave(phase) {
    return gaussian(phase, .18, .035) * .1
      - gaussian(phase, .36, .016) * .16
      + gaussian(phase, .4, .011) * 1.05
      - gaussian(phase, .44, .018) * .34
      + gaussian(phase, .7, .075) * .22;
  }

  function gaussian(value, center, width) {
    const distance = cyclicDistance(value, center);
    return Math.exp(-(distance * distance) / (2 * width * width));
  }

  function cyclicDistance(left, right) {
    const distance = Math.abs(left - right);
    return Math.min(distance, 1 - distance);
  }

  function positiveModulo(value, divisor) {
    return ((value % divisor) + divisor) % divisor;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  global.AetherMoodHeartbeat = AetherMoodHeartbeat;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      AetherMoodHeartbeat,
      ECG_SECONDS_ACROSS,
      createEcgTrace,
      ecgWave
    };
  }
})(typeof window === "undefined" ? globalThis : window);
