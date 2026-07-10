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
import {
  aiExtractionSchema,
  amendmentExtractionSchema,
  type AIExtraction,
  type AmendmentExtraction,
} from "@/lib/schemas";

export type ExtractedPage = {
  pageNumber: number;
  text: string;
};

export type BaseDocumentType = "contrato_base" | "orden" | "orden_compra";

export type PdfPageCountAssessment = {
  pageCount: number | null;
  reliable: boolean;
  source: "catalog" | "page_objects" | "unavailable";
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
  { label: "ANTICIPO", weight: 50 },
  { label: "PAGO ANTICIPADO", weight: 45 },
  { label: "BUEN MANEJO", weight: 50 },
  { label: "CORRECTA INVERSION", weight: 50 },
  { label: "AMORTIZACION DEL ANTICIPO", weight: 50 },
  { label: "SIN INCLUIR IVA", weight: 45 },
  { label: "ANTES DE IVA", weight: 40 },
  { label: "SUBTOTAL", weight: 35 },
  { label: "PRECIO", weight: 20 },
  { label: "REMUNERACION", weight: 20 },
  { label: "DURACION", weight: 35 },
  { label: "PLAZO", weight: 35 },
  { label: "VIGENCIA", weight: 30 },
  { label: "FECHA DE INICIO", weight: 30 },
  { label: "FECHA DE TERMINACION", weight: 30 },
  { label: "SUSCRIPCION", weight: 25 },
  { label: "SUSCRIPCION DEL", weight: 35 },
  { label: "FECHA DE SUSCRIPCION", weight: 35 },
  { label: "CONTADO A PARTIR", weight: 35 },
  { label: "CONTADOS A PARTIR", weight: 35 },
  { label: "A PARTIR DE LA SUSCRIPCION", weight: 40 },
  { label: "A PARTIR DEL ACTA DE INICIO", weight: 40 },
  { label: "UN ANO CONTADO", weight: 35 },
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
  "ANTICIPO",
  "BUEN MANEJO",
  "CORRECTA INVERSION",
  "DURACION",
  "PLAZO",
  "CONTADO A PARTIR",
  "CONTADOS A PARTIR",
  "A PARTIR DE LA SUSCRIPCION",
  "A PARTIR DEL ACTA DE INICIO",
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

export type OpenAIAmendmentExtractionResult = {
  deployment: string;
  extraction: AmendmentExtraction;
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
  return inspectPdfPageCount(pdf).pageCount;
}

export function inspectPdfPageCount(
  pdf: ArrayBuffer,
): PdfPageCountAssessment {
  const pdfText = Buffer.from(pdf).toString("latin1");
  const catalogPageCount = findCatalogPageCount(pdfText);

  if (catalogPageCount !== null) {
    return {
      pageCount: catalogPageCount,
      reliable: true,
      source: "catalog",
    };
  }

  const pageMatches = pdfText.match(/\/Type\s*\/Page\b/g);
  const count = pageMatches?.length ?? 0;

  return count > 0
    ? {
        pageCount: count,
        reliable: false,
        source: "page_objects",
      }
    : {
        pageCount: null,
        reliable: false,
        source: "unavailable",
      };
}

function findCatalogPageCount(pdfText: string) {
  const objects = new Map<string, string>();
  const objectPattern = /(\d+)\s+(\d+)\s+obj\b([\s\S]*?)endobj/g;

  for (const match of pdfText.matchAll(objectPattern)) {
    objects.set(`${match[1]}:${match[2]}`, match[3]);
  }

  const catalogs = Array.from(objects.values()).filter((body) =>
    /\/Type\s*\/Catalog\b/.test(body),
  );

  for (const catalog of catalogs.reverse()) {
    const pagesReference = catalog.match(/\/Pages\s+(\d+)\s+(\d+)\s+R\b/);

    if (!pagesReference) {
      continue;
    }

    const pagesObject = objects.get(
      `${pagesReference[1]}:${pagesReference[2]}`,
    );
    const countMatch =
      pagesObject && /\/Type\s*\/Pages\b/.test(pagesObject)
        ? pagesObject.match(/\/Count\s+(\d+)\b/)
        : null;
    const count = countMatch ? Number(countMatch[1]) : 0;

    if (Number.isInteger(count) && count > 0) {
      return count;
    }
  }

  return null;
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
function buildExtractionPrompt(
  extractedText: string,
  retrying: boolean,
  documentType: BaseDocumentType,
) {
  const retryInstruction = retrying
    ? "La respuesta anterior no cumplió el esquema. Corrige el JSON y respeta exactamente la estructura solicitada."
    : "Devuelve solamente JSON valido que cumpla el esquema.";

  return [
    retryInstruction,
    getBaseDocumentTypeInstruction(documentType),
    "Analiza el texto completo por paginas. No te limites a las primeras paginas.",
    "Extrae numero de contrato, tipo, partes, objeto, valor total, moneda, fechas, plazo y garantias/amparos.",
    "Incluye resumen_documento en 4 a 6 frases objetivas para el comercial. Usa solo datos extraidos del documento: tipo documental, objeto, partes, tipo contractual, valor o base relevante, plazo y principales garantias. Omite datos no identificados y no incluyas confianza, paginas, JSON, prompts ni conceptos juridicos.",
    "Para valor_contrato usa el valor total del contrato. Si aparecen presupuesto mensual, IVA, valor mensual y valor total, extrae el valor total final e incluye el fragmento fuente.",
    "Si no hay valor total explicito, pero hay valor mensual, precio mensual, canon o costo periodico y una duracion clara, distingue valor_contrato_total, valor_unitario_periodico, periodicidad_valor, numero_periodos, explicacion_calculo_valor y requiere_revision_valor. Calcula valor_contrato_total = valor unitario periodico x numero de periodos solo cuando los periodos sean claros.",
    "Para fechas del contrato, extrae fecha_inicio y fecha_fin si son explicitas o si se derivan sin ambiguedad de una fecha base y un plazo contractual. Si la derivacion es ambigua, usa null, conserva plazo y agrega alerta.",
    "Si el texto dice 'un año contado a partir de la suscripcion del 02 de febrero de 2024', extrae fecha_inicio 2024-02-02, plazo 'un año contado a partir de la suscripcion' y fecha_fin derivada. Agrega alerta indicando que fecha_fin fue derivada si no aparece literal.",
    "Si el plazo dice que corre desde Acta de Inicio y no aparece la fecha real del acta, extrae fecha de firma, suscripcion o perfeccionamiento como fecha_inicio provisional para cotizacion si aparece, deriva fecha_fin con el plazo y agrega alerta indicando que debe ajustarse manualmente cuando exista el acta.",
    "Busca expresiones equivalentes: fecha de suscripcion, suscripcion del contrato, acta de inicio, contados a partir de, a partir de la suscripcion, a partir del acta de inicio, fecha de terminacion y vigencia.",
    "Para plazo, conserva la frase contractual, por ejemplo 'un año contado a partir de la suscripcion'.",
    "Busca especificamente clausulas de valor, forma de pago, duracion, plazo, vigencia, garantias, garantia unica, polizas y amparos.",
    "En amparos extrae cada garantia real con evidencia textual: cumplimiento, salarios y prestaciones sociales, calidad del servicio, responsabilidad civil, accidentes personales, gastos medicos, auxilio funerario, equipos y maquinaria u otras que aparezcan.",
    "Si aparece buen manejo de anticipo, buen manejo y correcta inversion del anticipo, amortizacion del anticipo o expresiones equivalentes, usa tipo_amparo buen_manejo_anticipo. Para ese amparo, conserva en fuente_texto la clausula de anticipo y la clausula de garantia cuando sea posible.",
    "Para anticipo busca porcentaje o valor del anticipo, si la base es sin IVA o incluido IVA, subtotal, valor antes de IVA y valor estimado. No calcules valor asegurado final; extrae la evidencia completa para que el backend calcule.",
    "Para Responsabilidad Civil Extracontractual, conserva subamparos en subamparos cuando el contrato liste coberturas adicionales. Si el contrato dice que cada subamparo tiene un porcentaje del PLO, guarda porcentaje_sublimite decimal, origen contrato y calculable false para esos subamparos informativos.",
    "Si un amparo tiene porcentaje, entrega porcentaje decimal: 0.30 significa 30% y 0.10 significa 10%.",
    "Si un amparo tiene cuantia fija explicita, entrega esa cuantia en cuantia_fija. Si es por empleado, por persona o por evento, conserva esa condicion en fuente_texto y agrega alerta.",
    "Si una vigencia dice vigencia igual al termino, plazo, duracion o ejecucion del contrato y X dias/meses/años mas, usa tipo_vigencia contractual, base_vigencia fecha_fin_contrato y dias_adicionales equivalentes, preservando la frase fuente.",
    "Solo usa tipo_vigencia post_contractual si la cobertura inicia claramente despues de terminar el contrato, por ejemplo desde la terminacion, liquidacion, acta de recibo final o posterior a la terminacion.",
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
  documentType: BaseDocumentType,
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
            "Si un dato no aparece de forma explícita, usa null y agrega una alerta cuando sea importante, excepto fechas del contrato derivables sin ambiguedad desde fecha base y plazo contractual.",
            "Si el plazo depende del Acta de Inicio y no hay fecha real del acta, usa fecha de firma, suscripcion o perfeccionamiento como fecha_inicio provisional para cotizacion cuando aparezca, conserva la fuente y alerta que debe ajustarse al acta real.",
            "Los porcentajes deben entregarse como decimal: 0.30 significa 30%.",
            "Para amparos, no calcules valor asegurado, fecha desde ni fecha hasta finales. Extrae únicamente reglas, datos explícitos y evidencia textual.",
            "Para garantias, extrae tipo_amparo, porcentaje, cuantia_fija, tipo_vigencia, base_vigencia, dias_adicionales, fechas explícitas si aparecen, fuente_texto, fuente_pagina y confianza.",
            "Genera resumen_documento como texto comercial breve basado solamente en campos y evidencias del documento.",
            "Para responsabilidad civil, si hay subamparos adicionales, extraelos dentro de subamparos. Solo PLO puede ser calculable=true; los demas subamparos deben ser calculable=false.",
            "Para buen manejo de anticipo, usa tipo_amparo buen_manejo_anticipo y conserva evidencia de anticipo, IVA y garantia en fuente_texto.",
            "base_vigencia solo puede ser fecha_inicio_contrato, fecha_fin_contrato, acta_recibo_final, firma_contrato, otra o null.",
            "valor_asegurado debe ser null salvo que el contrato lo indique explícitamente como cuantía; nunca lo calcules desde porcentaje por valor del contrato.",
            "La fuente debe ser una cita textual legible tomada del contrato, idealmente la frase o cláusula completa relevante, y la pagina debe corresponder a esa cita.",
          ].join(" "),
        },
        {
          role: "user",
          content: buildExtractionPrompt(
            extractedText,
            attempt > 1,
            documentType,
          ),
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

function getBaseDocumentTypeInstruction(documentType: BaseDocumentType) {
  const labels: Record<BaseDocumentType, string> = {
    contrato_base: "contrato base",
    orden: "orden de servicio",
    orden_compra: "orden de compra",
  };

  return [
    `El usuario clasificó el documento como ${labels[documentType]}.`,
    "Trátalo como documento base contractual y extrae los mismos campos del contrato base.",
    "No lo interpretes como otrosí ni como modificación de una póliza emitida.",
  ].join(" ");
}

function buildAmendmentExtractionPrompt(extractedText: string, retrying: boolean) {
  const retryInstruction = retrying
    ? "La respuesta anterior no cumplió el esquema. Corrige el JSON y respeta exactamente la estructura solicitada."
    : "Devuelve solamente JSON valido que cumpla el esquema.";

  return [
    retryInstruction,
    "Analiza este documento como otrosí o modificación contractual de un contrato base existente.",
    "Extrae solo el delta: numero_modificacion, tipo_modificacion, contrato afectado, fecha de firma, valor anterior, valor de adicion, valor acumulado del contrato, fecha fin anterior, nueva fecha de terminacion, dias de prorroga, cambio de objeto y ajuste de garantias.",
    "Para valores de adicion distingue valor_adicion_total, valor_adicion_unitario, periodicidad_valor_adicion, numero_periodos_adicionados, periodos_adicionados, requiere_multiplicacion y explicacion_calculo_valor_adicion. Si el documento trae valor mensual o unitario por varios meses/periodos, no lo reportes como total: calcula o explica total = unitario x periodos. Si trae un total explicito, usa ese total.",
    "Busca expresiones como otrosi, modificacion, adicion, prorroga, plazo, nueva fecha de terminacion, valor acumulado, fecha de firma, objeto, garantias, polizas y amparos.",
    "Si el otrosí modifica garantias o crea amparos, extraelos en garantias usando las mismas reglas del contrato base. No inventes datos faltantes.",
    "Si aparece impuesto de timbre, reportalo en impuesto_timbre y alertas como dato informativo. Nunca lo mezcles con primas de poliza.",
    "RCE/PLO debe tratarse como linea principal calculable; subamparos son informativos y no generan prima individual.",
    "Si no encuentras un campo, usa null y agrega una alerta cuando sea importante.",
    "Texto extraido por pagina:",
    extractedText,
  ].join("\n\n");
}

export async function extractStructuredAmendment(
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
            "Eres un analista experto en contratos colombianos y otrosíes para una corredora de seguros.",
            "Debes extraer datos estrictamente desde el texto entregado.",
            "Nunca inventes fechas, valores, porcentajes, partes, prórrogas o amparos.",
            "Para modificaciones, conserva trazabilidad con fuente textual y página.",
          ].join(" "),
        },
        {
          role: "user",
          content: buildAmendmentExtractionPrompt(extractedText, attempt > 1),
        },
      ],
      response_format: zodResponseFormat(
        amendmentExtractionSchema,
        "muneco_digital_amendment_extraction",
      ),
    });

    lastRawContent = completion.choices[0]?.message.content ?? "";

    try {
      const rawJson = JSON.parse(lastRawContent);
      const extraction = amendmentExtractionSchema.parse(rawJson);

      return {
        deployment,
        extraction,
        rawJson,
        rawContent: lastRawContent,
        usage: {
          promptTokens: completion.usage?.prompt_tokens ?? null,
          completionTokens: completion.usage?.completion_tokens ?? null,
        },
      } satisfies OpenAIAmendmentExtractionResult;
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
    `Azure OpenAI devolvió JSON de otrosí inválido: ${lastValidationError ?? "sin detalle"}`,
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
