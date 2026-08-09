interface PlanActionLike {
  type?: unknown;
}

interface PlanPreviewLike {
  status?: unknown;
}

export const isExecutablePlan = (
  actions: PlanActionLike[],
  previews: PlanPreviewLike[],
) =>
  actions.length > 0 &&
  previews.length === actions.length &&
  actions.every((action) => action.type === "inbound" || action.type === "outbound") &&
  previews.every((preview) => preview.status === "planned");
