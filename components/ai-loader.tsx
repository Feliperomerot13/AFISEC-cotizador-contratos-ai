import { Sparkles } from "lucide-react";

type AiLoaderProps = {
  title: string;
  description?: string;
};

export function AiLoader({ title, description }: AiLoaderProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="relative overflow-hidden rounded-xl border border-[#d25b30]/20 bg-gradient-to-br from-[#fff7f3] via-white to-[#fbf4ff] p-5 shadow-[var(--shadow-soft)]"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-[#d25b30]/15 blur-3xl"
      />
      <div className="relative flex items-center gap-4">
        <span className="relative inline-flex h-12 w-12 shrink-0 items-center justify-center">
          <span
            aria-hidden
            className="absolute inset-0 rounded-full border border-[#d25b30]/40 animate-ai-ring"
          />
          <span
            aria-hidden
            className="absolute inset-0 rounded-full border border-[#d25b30]/30 animate-ai-ring [animation-delay:0.6s]"
          />
          <span className="relative inline-flex h-12 w-12 items-center justify-center rounded-full bg-[#d25b30]/12 text-[#d25b30] animate-ai-glow">
            <Sparkles className="h-5 w-5" aria-hidden />
          </span>
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-neutral-900">{title}</p>
            <span className="flex items-center gap-1" aria-hidden>
              <span className="h-1.5 w-1.5 rounded-full bg-[#d25b30] animate-ai-dot" />
              <span className="h-1.5 w-1.5 rounded-full bg-[#d25b30] animate-ai-dot [animation-delay:0.2s]" />
              <span className="h-1.5 w-1.5 rounded-full bg-[#d25b30] animate-ai-dot [animation-delay:0.4s]" />
            </span>
          </div>
          {description ? (
            <p className="mt-1 text-sm leading-6 text-neutral-600">
              {description}
            </p>
          ) : null}
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[#d25b30]/10">
            <span
              aria-hidden
              className="block h-full w-1/3 rounded-full bg-gradient-to-r from-[#d25b30]/40 via-[#d25b30] to-[#d25b30]/40 animate-ai-shimmer"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
