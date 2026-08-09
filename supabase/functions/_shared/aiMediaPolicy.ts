export const getTrustedAiInboundImageUrl = (_modelImageUrl: unknown) => {
  // Chat commands cannot prove that a model-provided URL belongs to the user.
  return '';
};
