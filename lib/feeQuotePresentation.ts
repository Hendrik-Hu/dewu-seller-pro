export type FeeQuoteSource = 'scheme' | 'manual' | 'unknown';

export interface FeeQuotePresentation {
  source: FeeQuoteSource;
  message: string;
}

export function getFeeQuotePresentation(
  hasSelectedScheme: boolean,
  manualFeeEnabled: boolean,
): FeeQuotePresentation {
  if (manualFeeEnabled) {
    return {
      source: 'manual',
      message: '本次按手动总费用估算。',
    };
  }

  if (hasSelectedScheme) {
    return {
      source: 'scheme',
      message: '本次按所选费用方案估算。',
    };
  }

  return {
    source: 'unknown',
    message: '未选择费用方案且未填写手动费用，平台费用、到手与净利润保持未知。',
  };
}
