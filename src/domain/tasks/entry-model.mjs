// Known low-cost Codex subscription candidates, cheapest first. Unknown models
// are never inferred to be cheap from their names or silently used as defaults.
export const entryModelCandidates=['gpt-6-luna','gpt-5.6-luna']
export function entryModel(models){
 for(const name of entryModelCandidates){
  const model=models.find(item=>item.model===name&&!item.hidden)
  if(model?.supportedReasoningEfforts?.some(item=>item.reasoningEffort==='low'))return name
 }
 throw Error('ENTRY_ROUTER_BUDGET_MODEL_UNAVAILABLE')
}
