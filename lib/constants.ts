export const EXECUTIVES = ["Diana", "Carolina"] as const;

export const DOCUMENT_TYPES = ["contrato_base", "otrosi", "otro"] as const;

export const CONTRACT_STATES = [
  "cargado",
  "procesando",
  "procesado_ia",
  "pendiente_validacion",
  "validado",
  "error",
] as const;

export const PROMPT_VERSION = "muneco-digital-v1";

export const STORAGE_BUCKET = "contratos";

export const EXPIRATION_WINDOW_DAYS = 30;

export const DEFAULT_IVA_PERCENTAGE = 0.19;

export const DEFAULT_RCE_RATE = 0.0025;

export type Executive = (typeof EXECUTIVES)[number];
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export type ContractState = (typeof CONTRACT_STATES)[number];
