export const EXECUTIVES = ["Carolina Barragán", "Viviana Clavijo"] as const;

export const DEFAULT_EXECUTIVE = EXECUTIVES[0];

export type ExecutiveContact = {
  nombre: string;
  cargo: string;
  correo: string;
  telefono: string;
  sitio_web: string;
  direccion: string;
};

export const EXECUTIVE_CONTACTS = {
  "Carolina Barragán": {
    nombre: "Carolina Barragán",
    cargo: "Ejecutiva de Cuenta",
    correo: "cbarragan@afisec.co",
    telefono: "(+57) 320 893 2376",
    sitio_web: "https://afisec.co",
    direccion: "Calle 93 B No 13-44 Piso 5",
  },
  "Viviana Clavijo": {
    nombre: "Viviana Clavijo Fonseca",
    cargo: "Ejecutiva de Cuenta",
    correo: "kclavijo@afisec.co",
    telefono: "(+57) 320 890 1021",
    sitio_web: "https://afisec.co",
    direccion: "Calle 93 B No 13-44 Piso 5",
  },
} satisfies Record<(typeof EXECUTIVES)[number], ExecutiveContact>;

export function getExecutiveContact(value: string | null | undefined) {
  const normalized = normalizeExecutiveName(value);
  const executive = EXECUTIVES.find(
    (candidate) => normalizeExecutiveName(candidate) === normalized,
  );

  return executive ? EXECUTIVE_CONTACTS[executive] : null;
}

export const DOCUMENT_TYPES = [
  "contrato_base",
  "orden",
  "orden_compra",
  "otrosi",
] as const;

export const CONTRACT_STATES = [
  "cargado",
  "procesando",
  "procesado_ia",
  "pendiente_validacion",
  "validado",
  "error",
] as const;

export const PROMPT_VERSION = "afisec-v0.4.1";

export const APP_RELEASE_LABEL = "";

export const STORAGE_BUCKET = "contratos";

export const EXPIRATION_WINDOW_DAYS = 30;

export const DEFAULT_IVA_PERCENTAGE = 0.19;

export const DEFAULT_COVERAGE_RATE = 0.002;

export const DEFAULT_RCE_RATE = 0.0025;

export type Executive = (typeof EXECUTIVES)[number];
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export type ContractState = (typeof CONTRACT_STATES)[number];

function normalizeExecutiveName(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
