type RequiredServerEnv =
  | "NEXT_PUBLIC_SUPABASE_URL"
  | "NEXT_PUBLIC_SUPABASE_ANON_KEY"
  | "SUPABASE_SERVICE_ROLE_KEY"
  | "AZURE_DOC_INTEL_ENDPOINT"
  | "AZURE_DOC_INTEL_KEY"
  | "AZURE_OPENAI_ENDPOINT"
  | "AZURE_OPENAI_KEY"
  | "AZURE_OPENAI_DEPLOYMENT_PRIMARY"
  | "AZURE_OPENAI_DEPLOYMENT_FALLBACK"
  | "AZURE_OPENAI_API_VERSION";

function readRequired(name: RequiredServerEnv) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Falta configurar la variable de entorno ${name}.`);
  }

  return value;
}

export function getServerEnv() {
  return {
    NEXT_PUBLIC_SUPABASE_URL: readRequired("NEXT_PUBLIC_SUPABASE_URL"),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: readRequired("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    SUPABASE_SERVICE_ROLE_KEY: readRequired("SUPABASE_SERVICE_ROLE_KEY"),
    AZURE_DOC_INTEL_ENDPOINT: readRequired("AZURE_DOC_INTEL_ENDPOINT"),
    AZURE_DOC_INTEL_KEY: readRequired("AZURE_DOC_INTEL_KEY"),
    AZURE_OPENAI_ENDPOINT: readRequired("AZURE_OPENAI_ENDPOINT"),
    AZURE_OPENAI_KEY: readRequired("AZURE_OPENAI_KEY"),
    AZURE_OPENAI_DEPLOYMENT_PRIMARY: readRequired(
      "AZURE_OPENAI_DEPLOYMENT_PRIMARY",
    ),
    AZURE_OPENAI_DEPLOYMENT_FALLBACK: readRequired(
      "AZURE_OPENAI_DEPLOYMENT_FALLBACK",
    ),
    AZURE_OPENAI_API_VERSION: readRequired("AZURE_OPENAI_API_VERSION"),
    CONFIANZA_FALLBACK_THRESHOLD: Number(
      process.env.CONFIANZA_FALLBACK_THRESHOLD ?? "3",
    ),
  };
}
