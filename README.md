# Muñeco Digital

Muñeco Digital is a Next.js MVP for AFISEC, a Colombian insurance broker. It helps commercial executives upload contract PDFs, extract contract data with Azure AI, review and correct the results, and store validated structured records in Supabase.

The MVP validates whether AI can reliably support contract pre-reading. It does not issue policies, calculate premiums, track commissions, manage otrosí workflows, integrate with Softseguros, export reports, or implement authentication.

## Stack

- Next.js App Router with TypeScript
- Tailwind CSS
- Supabase PostgreSQL and Supabase Storage
- Azure Document Intelligence for page-by-page OCR/text extraction
- Azure OpenAI for strict JSON extraction
- Zod validation for AI and API payloads
- Vercel-compatible route handlers and background processing

## Documentation

- [Arquitectura del repositorio](./docs/ARCHITECTURE.md): estructura de carpetas, responsabilidades, flujo de datos, endpoints, seguridad y criterios para extender el MVP.

## Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

## Environment Variables

All required variables are listed in `.env.example`.

Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are safe for browser use. Azure keys and `SUPABASE_SERVICE_ROLE_KEY` are used only in server route handlers.

Azure OpenAI deployments must be configured through:

- `AZURE_OPENAI_DEPLOYMENT_PRIMARY`
- `AZURE_OPENAI_DEPLOYMENT_FALLBACK`

No deployment name is hardcoded in the application.

## Supabase Requirements

The existing schema must contain these tables with RLS enabled and no public policies:

- `clientes`
- `contratos`
- `documentos`
- `amparos`
- `extracciones`
- `tasas_referencia`

Create a private Supabase Storage bucket named `contratos`. The app uploads PDFs to that bucket through the service role key and does not expose storage paths or signed URLs to the browser.

`tasas_referencia` is read-only in this MVP and is displayed during validation when amparo types match.

## Azure Requirements

Document Intelligence must be reachable through `AZURE_DOC_INTEL_ENDPOINT` and `AZURE_DOC_INTEL_KEY`.

Azure OpenAI must support JSON schema response formatting for the configured deployment. The app still validates every response with Zod, retries invalid JSON once, and marks the contract as `error` if validation fails twice.

If 3 or more extracted fields have `confianza: "baja"` by default, the app retries with `AZURE_OPENAI_DEPLOYMENT_FALLBACK`. Adjust this with `CONFIANZA_FALLBACK_THRESHOLD`.

## Processing Flow

1. Upload page creates or reuses a client.
2. It creates a `contratos` row with state `cargado`.
3. It uploads the PDF to Supabase Storage bucket `contratos`.
4. It creates a `documentos` row.
5. The frontend calls the processing endpoint.
6. Processing sets state `procesando`, downloads the PDF server-side, runs Azure Document Intelligence, runs Azure OpenAI, logs `extracciones`, saves fields and amparos, then sets state `pendiente_validacion`.
7. A human explicitly confirms validation before the contract can become `validado`.

On Vercel, processing uses `waitUntil()` from `@vercel/functions` so the endpoint can respond with `{ "status": "procesando" }` while work continues. In local development, processing runs synchronously as a safe fallback so the job does not silently die.

Long PDFs can still hit serverless execution limits. For production beyond this MVP, move processing to a durable queue or workflow worker.

## Extraction and Coverage Calculations

Azure Document Intelligence only extracts text from the PDF. Azure OpenAI reads that text and extracts rules, explicit fields and evidence fragments.

The full AI JSON is stored only in `extracciones.json_original`; `contratos.extraido_ia` is a boolean flag. The OpenAI context now sends the complete PDF text when it fits under the MVP context limit. For longer PDFs, it keeps the first three pages plus prioritized pages and neighbors around clauses that mention value, payment, term, guarantees, amparos, policy, validity or final acceptance evidence.

The processor estimates the PDF page count and compares it with the pages returned by Document Intelligence. If Azure returns only a small fraction of the document, processing stops with a clear error instead of saving a misleading partial extraction.

Before data reaches Supabase, explicit mappers in `lib/processing.ts` and reusable normalizers in `lib/normalizers.ts` convert flexible AI output into flat, database-safe values. Required fields such as `moneda` fall back to `COP`, boolean fields stay boolean, invalid dates become `null`, and `NaN` or nested objects are never sent to rigid contract columns.

OpenAI is not the final source for calculated coverage values. The backend calculates derived amparo values in `lib/coverage-calculations.ts`, including insured value and dates when the contract data is sufficient. If information is missing, ambiguous or low confidence, the amparo is marked for human review with `motivo_revision`.

Fallback extraction is triggered not only by low confidence, but also when critical MVP fields are missing: contract value, term, start date, end date or useful amparos.

Human validation is still mandatory before a contract can reach `validado`.

## Amparo Liquidation

Amparos are liquidated deterministically in `lib/coverage-calculations.ts`.

Formula:

```text
prima_neta = valor_asegurado * tasa * dias_vigencia / 365
impuesto = prima_neta * iva_porcentaje
prima_total = prima_neta + impuesto
```

`dias_adicionales` is the contractual rule extracted from the clause. `dias_vigencia` is the actual day count between `fecha_desde` and `fecha_hasta`, and is the value used for premium calculation. The default IVA is `0.19`.

Apply `docs/supabase-migrations/20260504_amparos_liquidacion_modificaciones.sql` before using the liquidation fields. It adds premium fields to `amparos` and proposes `modificaciones_contractuales` for future otrosí/prórroga/adición support.

## Security Notes

- Azure credentials never reach client components.
- `SUPABASE_SERVICE_ROLE_KEY` is only imported by server route handlers and server utilities.
- Client screens call `/api/*` endpoints for protected reads and writes.
- Database writes happen only server-side.
- PDF storage paths and signed URLs are not returned to the frontend.
- No authentication is included in this MVP by request.

## Scripts

```bash
npm run dev
npm run lint
npm run build
```

## Liquidación de responsabilidad civil

Responsabilidad Civil Extracontractual se guarda como un solo amparo principal. PLO queda como `subamparo` calculable y los demás subamparos del bloque se conservan como detalle informativo, sin prima individual. La migración propuesta agrega `amparos.subamparos` en `docs/supabase-migrations/20260504_amparos_liquidacion_modificaciones.sql`.
