// 采样策略：默认「固定采样」；--early-stop 时先跑 min 次，只在结论含糊/噪声高时补采样到 max。
//
// 为什么只看「未校正的原始变化率」：噪声校正本身依赖采样估计，用校正后效应决定是否继续
// 采样会形成循环反馈（校正值 → 采样 → 校正值），放大选择偏倚。豆包在 v1.4 评审中也明确
// 建议「决策只用未校正的原始统计量，校正只在最终汇总阶段做」。
//
// 阈值提前固定、不事后调整；报告必须披露策略与提前终止情况（见 report.mjs）。

// 原始变化率落在 (0.1, 0.7) 视为「含糊」：可能够到 20% 的部分影响线，也可能够到 50% 的决定性线。
export const AMBIGUOUS_LOW = 0.1;
export const AMBIGUOUS_HIGH = 0.7;

// 噪声地板 ≥15% 时，少采样得出的原始变化率本身不可靠，值得补采样。
export const NOISE_EXTEND_THRESHOLD = 0.15;

/** 是否需要把该改动块的采样从 minSamples 补到 maxSamples */
export function shouldExtendSampling({ rawEffect, noiseFloor, minSamples, maxSamples }) {
  if (!(maxSamples > minSamples)) return false;
  if (!Number.isFinite(rawEffect)) return false;
  const noisy = Number.isFinite(noiseFloor) && noiseFloor >= NOISE_EXTEND_THRESHOLD;
  const ambiguous = rawEffect > AMBIGUOUS_LOW && rawEffect < AMBIGUOUS_HIGH;
  return noisy || ambiguous;
}

/** 报告与 README 共用的策略说明（固定文案，便于审计） */
export function describeSamplingPolicy({ earlyStop, samples, minSamples }) {
  const min = earlyStop ? minSamples : samples;
  if (!earlyStop) return `固定采样：每探针每版本 ${samples} 次`;
  return (
    `自适应采样（先测后补）：先跑 ${min} 次；若未校正的原始变化率位于 (${AMBIGUOUS_LOW}, ${AMBIGUOUS_HIGH}) ` +
    `或噪声地板 ≥ ${NOISE_EXTEND_THRESHOLD}，补采样到 ${samples} 次，否则提前停止。` +
    `停止判断只用原始变化率，噪声校正在采样决策之后进行。`
  );
}
