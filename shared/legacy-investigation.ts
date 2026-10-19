// Compatibility imports share the active creator schema and transfer rules.
export {
  creatorSchema as legacyInvestigationSchema,
  emptyPlan,
  remapPlan as remapLegacyInvestigation,
  type InvestigationPlan as LegacyInvestigation,
} from '../modules/investigation-creator/schema';
