const assert = require("node:assert/strict");
const test = require("node:test");
const {
  AetherMoodHeartbeat,
  ECG_SECONDS_ACROSS,
  createEcgTrace,
  ecgWave
} = require("../mood-heartbeat");

test("心电波形包含清晰的 QRS 主峰和恢复波", () => {
  assert.ok(ecgWave(.4) > .8);
  assert.ok(ecgWave(.36) < 0);
  assert.ok(ecgWave(.7) > .1);
});

test("心率展示读取 Hub 保存的心率和节律", () => {
  const bpmElement = { textContent: "" };
  const rhythmElement = { textContent: "" };
  const heartbeat = new AetherMoodHeartbeat({
    canvas: { getContext: () => null },
    bpmElement,
    rhythmElement
  });
  heartbeat.setSnapshot({
    state: {
      state: {
        physiology: { heartRateBpm: 82, rhythm: "lively" }
      }
    }
  });
  assert.equal(heartbeat.targetBpm, 82);
  assert.equal(bpmElement.textContent, "82");
  assert.equal(rhythmElement.textContent, "轻快");
});

test("心电窗口保持接近三秒，不会挤入过多快速闪动的心搏", () => {
  assert.ok(ECG_SECONDS_ACROSS >= 2.6 && ECG_SECONDS_ACROSS <= 3.1);
  const trace = createEcgTrace({
    sampleCount: 320,
    bpm: 66,
    secondsAcross: ECG_SECONDS_ACROSS,
    endPhase: .55
  });
  let peaks = 0;
  for (let index = 1; index < trace.length - 1; index += 1) {
    if (trace[index] > .75
      && trace[index] > trace[index - 1]
      && trace[index] >= trace[index + 1]) {
      peaks += 1;
    }
  }
  assert.ok(peaks >= 2 && peaks <= 4);
});
