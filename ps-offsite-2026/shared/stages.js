export function createStageManager(thresholds, onChange) {
  let stage = 1;

  function compute(score) {
    let s = 1;
    for (const t of thresholds) {
      if (score >= t) s += 1;
    }
    return s;
  }

  return {
    currentStage() { return stage; },
    update(score) {
      const next = compute(score);
      while (stage < next) {
        stage += 1;
        onChange(stage);
      }
    },
    reset() { stage = 1; }
  };
}
