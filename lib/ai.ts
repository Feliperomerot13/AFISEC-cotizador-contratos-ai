import DocumentIntelligence, {
  getLongRunningPoller,
  isUnexpected,
  type AnalyzeOperationOutput,
} from "@azure-rest/ai-document-intelligence";
import { AzureKeyCredential } from "@azure/core-auth";
import { AzureOpenAI } from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { ZodError } from "zod";
import { getServerEnv } from "@/lib/env";
import { aiExtractionSchema, type AIExtraction } from "@/lib/schemas";

export type ExtractedPage = {
  pageNumber: number;
  text: string;
};

export type ContractExtractionContext = {
  text: string;
  pageNumbers: number[];
  pageDetails: PageSelectionDetail[];
  truncated: boolean;
};

export type PageSelectionDetail = {
  pageNumber: number;
  reasons: string[];
  keywords: string[];
  priorityScore: number;
  charLength: number;
};

const EXTRACTION_KEYWORDS: Array<{ label: string; weight: number }> = [
  { label: "VALOR", weight: 25 },
  { label: "VALOR Y FORMA DE PAGO", weight: 45 },
  { label: "VALOR TOTAL", weight: 45 },
  { label: "PRESUPUESTO MENSUAL", weight: 35 },
  { label: "PROCEDIMIENTO DE PAGO", weight: 30 },
  { label: "FORMA DE PAGO", weight: 30 },
  { label: "PRECIO", weight: 20 },
  { label: "REMUNERACION", weight: 20 },
  { label: "DURACION", weight: 35 },
  { label: "PLAZO", weight: 35 },
  { label: "VIGENCIA", weight: 30 },
  { label: "FECHA DE INICIO", weight: 30 },
  { label: "FECHA DE TERMINACION", weight: 30 },
  { label: "SUSCRIPCION", weight: 25 },
  { label: "GARANTIA", weight: 50 },
  { label: "GARANTIA UNICA", weight: 55 },
  { label: "GARANTIAS", weight: 50 },
  { label: "AMPARO", weight: 50 },
  { label: "POLIZA", weight: 45 },
  { label: "CUMPLIMIENTO", weight: 45 },
  { label: "SALARIOS", weight: 40 },
  { label: "PRESTACIONES SOCIALES", weight: 40 },
  { label: "CALIDAD DEL SERVICIO", weight: 40 },
  { label: "RESPONSABILIDAD CIVIL", weight: 45 },
  { label: "ACCIDENTES PERSONALES", weight: 35 },
  { label: "EQUIPOS Y MAQUINARIA", weight: 35 },
  { label: "ACTA DE INICIO", weight: 35 },
  { label: "ACTA DE RECIBO FINAL", weight: 45 },
  { label: "LIQUIDACION", weight: 20 },
  { label: "CUANTIA", weight: 35 },
  { label: "VALOR ASEGURADO", weight: 45 },
  { label: "PORCENTAJE", weight: 30 },
  { label: "VIGENCIA IGUAL AL PLAZO", weight: 55 },
  { label: "DIAS ADICIONALES", weight: 35 },
  { label: "TREINTA POR CIENTO", weight: 45 },
  { label: "DIEZ POR CIENTO", weight: 45 },
  { label: "30%", weight: 35 },
  { label: "10%", weight: 35 },
  { label: "CLAUSULA CUARTA", weight: 55 },
  { label: "CLAUSULA SEXTA", weight: 50 },
  { label: "CLAUSULA SEPTIMA", weight: 60 },
];

const CONTINUATION_KEYWORDS = new Set([
  "VALOR",
  "VALOR Y FORMA DE PAGO",
  "VALOR TOTAL",
  "DURACION",
  "PLAZO",
  "GARANTIA",
  "GARANTIAS",
  "AMPARO",
  "POLIZA",
  "CUMPLIMIENTO",
  "RESPONSABILIDAD CIVIL",
  "ACCIDENTES PERSONALES",
  "ACTA DE RECIBO FINAL",
  "CLAUSULA CUARTA",
  "CLAUSULA SEXTA",
  "CLAUSULA SEPTIMA",
]);

const MAX_EXTRACTION_CONTEXT_CHARS = 120_000;

export type OpenAIExtractionResult = {
  deployment: string;
  extraction: AIExtraction;
  rawJson: unknown;
  rawContent: string;
  usage: {
    promptTokens: number | null;
    completionTokens: number | null;
  };
};

export class InvalidAIJsonError extends Error {
  rawContent: string | null;

  constructor(message: string, rawContent: string | null) {
    super(message);
    this.name = "InvalidAIJsonError";
    this.rawContent = rawContent;
  }
}

export async function extractPdfTextByPage(pdf: ArrayBuffer) {
  const env = getServerEnv();
  const client = DocumentIntelligence(
    env.AZURE_DOC_INTEL_ENDPOINT,
    new AzureKeyCredential(env.AZURE_DOC_INTEL_KEY),
  );

  const initialResponse = await client
    .path("/documentModels/{modelId}:analyze", "prebuilt-read")
    .post({
      contentType: "application/json",
      body: {
        base64Source: Buffer.from(pdf).toString("base64"),
      },
    });

  if (isUnexpected(initialResponse)) {
    throw new Error(
      `Document Intelligence rechazó el PDF: ${initialResponse.body.error?.message ?? initialResponse.status}`,
    );
  }

  const poller = getLongRunningPoller(client, initialResponse);
  const response = (await poller.pollUntilDone()).body as AnalyzeOperationOutput;

  if (response.status !== "succeeded" || !response.analyzeResult) {
    throw new Error(
      `Document Intelligence no pudo analizar el documento: ${response.error?.message ?? response.status}`,
    );
  }

  const result = response.analyzeResult;
  const pages = result.pages.map((page) => {
    const textFromSpans = page.spans
      .map((span) => result.content.slice(span.offset, span.offset + span.length))
      .join("\n")
      .trim();

    const textFromLines = page.lines?.map((line) => line.content).join("\n") ?? "";

    return {
      pageNumber: page.pageNumber,
      text: textFromSpans || textFromLines,
    };
  });

  if (!pages.some((page) => page.text.trim().length > 0)) {
    throw new Error("Document Intelligence no encontró texto legible en el PDF.");
  }

  return pages;
}

export function stringifyPages(pages: ExtractedPage[]) {
  return pages
    .map((page) => `--- Página ${page.pageNumber} ---\n${page.text}`)
    .join("\n\n");
}

export function estimatePdfPageCount(pdf: ArrayBuffer) {
  const pdfText = Buffer.from(pdf).toString("latin1");
  const pageMatches = pdfText.match(/\/Type\s*\/Page\b/g);
  const count = pageMatches?.length ?? 0;

  return count > 0 ? count : null;
}

export function buildContractExtractionContext(
  pages: ExtractedPage[],
): ContractExtractionContext {
  const readablePages = pages.filter((page) => page.text.trim().length > 0);
  const analyses = new Map(
    readablePages.map((page) => [page.pageNumber, analyzePage(page)]),
  );
  const fullText = stringifyPages(readablePages);

  if (fullText.length <= MAX_EXTRACTION_CONTEXT_CHARS) {
    const pageDetails = readablePages.map((page) => {
      const analysis = analyses.get(page.pageNumber) ?? analyzePage(page);
      const reasons = ["documento_completo_bajo_limite"];

      if (page.pageNumber <= 3) {
        reasons.push("primeras_3_paginas");
      }

      if (analysis.keywords.length > 0) {
        reasons.push("keywords_criticas");
      }

      return toPageSelectionDetail(page, reasons, analysis);
    });

    return {
      text: fullText,
      pageNumbers: readablePages.map((page) => page.pageNumber),
      pageDetails,
      truncated: false,
    };
  }

  const selected = new Map<
    number,
    { page: ExtractedPage; reasons: Set<string> }
  >();

  function selectPage(page: ExtractedPage | undefined, reason: string) {
    if (!page) {
      return;
    }

    const current = selected.get(page.pageNumber);

    if (current) {
      current.reasons.add(reason);
      return;
    }

    selected.set(page.pageNumber, {
      page,
      reasons: new Set([reason]),
    });
  }

  for (const page of readablePages.slice(0, 3)) {
    selectPage(page, "primeras_3_paginas");
  }

  for (const page of readablePages) {
    const analysis = analyses.get(page.pageNumber) ?? analyzePage(page);

    if (analysis.keywords.length > 0) {
      selectPage(page, "keywords_criticas");
    }

    if (analysis.keywords.some((keyword) => CONTINUATION_KEYWORDS.has(keyword))) {
      selectPage(
        readablePages.find((candidate) => candidate.pageNumber === page.pageNumber - 1),
        `contexto_previo_pagina_${page.pageNumber}`,
      );
      selectPage(
        readablePages.find((candidate) => candidate.pageNumber === page.pageNumber + 1),
        `continuacion_pagina_${page.pageNumber}`,
      );
    }
  }

  const selectedPages = Array.from(selected.values()).sort(
    (left, right) => left.page.pageNumber - right.page.pageNumber,
  );
  const allSelectedText = stringifyPages(
    selectedPages.map((selection) => selection.page),
  );

  if (allSelectedText.length <= MAX_EXTRACTION_CONTEXT_CHARS) {
    const orderedSelections = selectedPages.map((selection) => {
      const analysis =
        analyses.get(selection.page.pageNumber) ?? analyzePage(selection.page);

      return toPageSelectionDetail(
        selection.page,
        Array.from(selection.reasons),
        analysis,
      );
    });

    return {
      text: allSelectedText,
      pageNumbers: orderedSelections.map((page) => page.pageNumber),
      pageDetails: orderedSelections,
      truncated: true,
    };
  }

  const requiredFirstPages = selectedPages.filter(
    (selection) => selection.page.pageNumber <= 3,
  );
  const remainingPages = selectedPages.filter(
    (selection) => selection.page.pageNumber > 3,
  );
  const prioritizedPages = [...remainingPages].sort((left, right) => {
    const leftScore =
      analyses.get(left.page.pageNumber)?.priorityScore ?? getPagePriorityScore(left.page);
    const rightScore =
      analyses.get(right.page.pageNumber)?.priorityScore ?? getPagePriorityScore(right.page);

    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }

    return left.page.pageNumber - right.page.pageNumber;
  });

  const truncatedSelections = [...requiredFirstPages];
  let currentLength = stringifyPages(
    requiredFirstPages.map((selection) => selection.page),
  ).length;

  for (const selection of prioritizedPages) {
    const pageText = stringifyPages([selection.page]);
    const separatorLength = truncatedSelections.length > 0 ? 2 : 0;

    if (
      truncatedSelections.length > 0 &&
      currentLength + separatorLength + pageText.length >
        MAX_EXTRACTION_CONTEXT_CHARS
    ) {
      continue;
    }

    selection.reasons.add("prioridad_por_truncamiento");
    truncatedSelections.push(selection);
    currentLength += separatorLength + pageText.length;
  }

  const orderedSelections = truncatedSelections.sort(
    (left, right) => left.page.pageNumber - right.page.pageNumber,
  );
  const pageDetails = orderedSelections.map((selection) => {
    const analysis =
      analyses.get(selection.page.pageNumber) ?? analyzePage(selection.page);

    return toPageSelectionDetail(
      selection.page,
      Array.from(selection.reasons),
      analysis,
    );
  });

  return {
    text: stringifyPages(orderedSelections.map((selection) => selection.page)),
    pageNumbers: pageDetails.map((page) => page.pageNumber),
    pageDetails,
    truncated: true,
  };
}

function analyzePage(page: ExtractedPage) {
  const normalized = normalizeForSearch(page.text);
  const matchedKeywords = EXTRACTION_KEYWORDS.filter((keyword) =>
    normalized.includes(keyword.label),
  );
  const priorityScore =
    matchedKeywords.reduce((score, keyword) => score + keyword.weight, 0) +
    (page.pageNumber <= 3 ? 5 : 0);

  return {
    keywords: matchedKeywords.map((keyword) => keyword.label),
    priorityScore,
  };
}

function toPageSelectionDetail(
  page: ExtractedPage,
  reasons: string[],
  analysis: ReturnType<typeof analyzePage>,
) {
  return {
    pageNumber: page.pageNumber,
    reasons,
    keywords: analysis.keywords,
    priorityScore: analysis.priorityScore,
    charLength: page.text.length,
  };
}

function getPagePriorityScore(page: ExtractedPage) {
  return analyzePage(page).priorityScore;
}

function normalizeForSearch(text: string) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

/*
 * Keep this below the context builder so the extraction prompt remains easy to
 * read. It is deliberately verbose because incomplete clauses are the riskiest
 * part of the MVP.
 */
function buildExtractionPrompt(extractedText: string, retrying: boolean) {
  const retryInstruction = retrying
    ? "La respuesta anterior no cumplió el esquema. Corrige el JSON y respeta exactamente la estructura solicitada."
    : "Devuelve solamente JSON valido que cumpla el esquema.";

  return [
    retryInstruction,
    "Analiza el texto completo por paginas. No te limites a las primeras paginas.",
    "Extrae numero de contrato, tipo, partes, objeto, valor total, moneda, fechas, plazo y garantias/amparos.",
    "Para valor_contrato usa el valor total del contrato. Si aparecen presupuesto mensual, IVA, valor mensual y valor total, extrae el valor total final e incluye el fragmento fuente.",
    "Para fechas del contrato, extrae fecha_inicio y fecha_fin si son explicitas o si se derivan sin ambiguedad de una fecha base y un plazo contractual. Si la derivacion es ambigua, usa null, conserva plazo y agrega alerta.",
    "Para plazo, conserva la frase contractual, por ejemplo 'un año contado a partir de la suscripcion'.",
    "Busca especificamente clausulas de valor, forma de pago, duracion, plazo, vigencia, garantias, garantia unica, polizas y amparos.",
    "En amparos extrae cada garantia real con evidencia textual: cumplimiento, salarios y prestaciones sociales, calidad del servicio, responsabilidad civil, accidentes personales, gastos medicos, auxilio funerario, equipos y maquinaria u otras que aparezcan.",
    "Si un amparo tiene porcentaje, entrega porcentaje decimal: 0.30 significa 30% y 0.10 significa 10%.",
    "Si un amparo tiene cuantia fija explicita, entrega esa cuantia en cuantia_fija. Si es por empleado, por persona o por evento, conserva esa condicion en fuente_texto y agrega alerta.",
    "Si una vigencia dice plazo + 30 dias, usa tipo_vigencia post_contractual, base_vigencia fecha_fin_contrato y dias_adicionales 30.",
    "Si una vigencia dice plazo + 3 años, usa tipo_vigencia post_contractual, base_vigencia fecha_fin_contrato y dias_adicionales 1095, preservando la frase fuente.",
    "Si una vigencia se cuenta desde Acta de Recibo Final, usa base_vigencia acta_recibo_final y no inventes fecha_desde ni fecha_hasta.",
    "No calcules valor asegurado desde porcentaje por valor del contrato. valor_asegurado debe ser null salvo que el contrato indique una cuantia asegurada explicita; en ese caso pon la cuantia en cuantia_fija.",
    "No inventes amparos: si no tienes fuente_texto o pagina, no crees una garantia de baja confianza; agrega una alerta en su lugar.",
    "Para contratos estatales o particulares usa solamente estatal, particular o null.",
    "No conviertas textos inciertos en datos estructurados. Si hay duda, usa confianza baja y conserva la fuente.",
    "Texto extraido por pagina:",
    extractedText,
  ].join("\n\n");
}

export function countLowConfidenceFields(extraction: AIExtraction) {
  const confidences = [
    extraction.numero_contrato.confianza,
    extraction.tipo_contrato.confianza,
    extraction.contratante.confianza,
    extraction.contratista.confianza,
    extraction.objeto.confianza,
    extraction.valor_contrato.confianza,
    extraction.fecha_inicio.confianza,
    extraction.fecha_fin.confianza,
    extraction.plazo.confianza,
    ...extraction.garantias.map((garantia) => garantia.confianza),
  ];

  return confidences.filter((confidence) => confidence === "baja").length;
}

export async function extractStructuredContract(
  deployment: string,
  extractedText: string,
) {
  let lastRawContent: string | null = null;
  let lastValidationError: string | null = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const completion = await getAzureOpenAIClient(deployment).chat.completions.create({
      model: deployment,
      temperature: 0,
      messages: [
        {
          role: "system",
          content: [
            "Eres un analista experto en contratos colombianos para una corredora de seguros.",
            "Debes extraer datos estrictamente desde el texto entregado.",
            "Nunca inventes fechas, valores, NIT, porcentajes, partes o vigencias.",
            "Si un dato no aparece de forma explícita, usa null y agrega una alerta cuando sea importante.",
            "Los porcentajes deben entregarse como decimal: 0.30 significa 30%.",
            "Para amparos, no calcules valor asegurado, fecha desde ni fecha hasta finales. Extrae únicamente reglas, datos explícitos y evidencia textual.",
            "Para garantias, extrae tipo_amparo, porcentaje, cuantia_fija, tipo_vigencia, base_vigencia, dias_adicionales, fechas explícitas si aparecen, fuente_texto, fuente_pagina y confianza.",
            "base_vigencia solo puede ser fecha_inicio_contrato, fecha_fin_contrato, acta_recibo_final, firma_contrato, otra o null.",
            "valor_asegurado debe ser null salvo que el contrato lo indique explícitamente como cuantía; nunca lo calcules desde porcentaje por valor del contrato.",
            "La fuente debe ser una cita textual legible tomada del contrato, idealmente la frase o cláusula completa relevante, y la pagina debe corresponder a esa cita.",
          ].join(" "),
        },
        {
          role: "user",
          content: buildExtractionPrompt(extractedText, attempt > 1),
        },
      ],
      response_format: zodResponseFormat(
        aiExtractionSchema,
        "muneco_digital_contract_extraction",
      ),
    });

    lastRawContent = completion.choices[0]?.message.content ?? "";

    try {
      const rawJson = JSON.parse(lastRawContent);
      const extraction = aiExtractionSchema.parse(rawJson);

      return {
        deployment,
        extraction,
        rawJson,
        rawContent: lastRawContent,
        usage: {
          promptTokens: completion.usage?.prompt_tokens ?? null,
          completionTokens: completion.usage?.completion_tokens ?? null,
        },
      } satisfies OpenAIExtractionResult;
    } catch (error) {
      lastValidationError =
        error instanceof ZodError
          ? error.issues.map((issue) => issue.message).join("; ")
          : error instanceof Error
            ? error.message
            : "JSON inválido.";
    }
  }

  throw new InvalidAIJsonError(
    `Azure OpenAI devolvió JSON inválido: ${lastValidationError ?? "sin detalle"}`,
    lastRawContent,
  );
}

function getAzureOpenAIClient(deployment: string) {
  const env = getServerEnv();

  return new AzureOpenAI({
    apiKey: env.AZURE_OPENAI_KEY,
    apiVersion: env.AZURE_OPENAI_API_VERSION,
    endpoint: env.AZURE_OPENAI_ENDPOINT,
    deployment,
    maxRetries: 1,
  });
}
