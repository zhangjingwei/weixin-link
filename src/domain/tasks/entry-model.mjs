// Explicit routing policy, independent of the project execution model.
// Missing Terra never silently selects a different cost or capability tier.
export const entryModelCandidates=['gpt-6.1-terra']
export function entryModel(models){
 const model=models.find(item=>item.model===entryModelCandidates[0]&&!item.hidden)
 if(model?.supportedReasoningEfforts?.some(item=>item.reasoningEffort==='medium'))return model.model
 throw Error('ENTRY_ROUTER_MODEL_UNAVAILABLE')
}
