export function jsonOk<T>(body: T, init?: ResponseInit) {
  return Response.json(body, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...(init?.headers ?? {}),
    },
  });
}

export function jsonError(
  message: string,
  status = 500,
  details?: unknown,
) {
  return jsonOk(
    {
      error: message,
      details,
    },
    { status },
  );
}

export function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Ocurrió un error inesperado.";
}
