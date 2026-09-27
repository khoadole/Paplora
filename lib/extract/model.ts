/**
 * Model selection and AI availability.
 *
 * Precedence: OPENAI_MODEL, then OPENAI_LESSON_MODEL (compatibility alias from the
 * owner's existing configuration), then nothing.
 *
 * There is deliberately no built-in default model. The requested default,
 * `gpt-5.6-terra`, was checked against OpenAI's published model list on
 * 2026-09-27 (developers.openai.com/api/docs/models) and is NOT a model the API
 * offers; the closest name there is `gpt-5.6-cyber`, a security-research model.
 * Substituting a different model silently would make the app lie about what
 * produced an answer, so live extraction stays off until a model is named
 * explicitly. See README, "Live extraction".
 */

export interface AiConfig {
  configured: boolean;
  model: string | null;
  hasKey: boolean;
  /** User-facing explanation of why live extraction is unavailable. */
  reason?: string;
}

export function selectModel(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = env.OPENAI_MODEL?.trim();
  if (explicit) return explicit;
  const alias = env.OPENAI_LESSON_MODEL?.trim();
  if (alias) return alias;
  return null;
}

export function readAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  const hasKey = Boolean(env.OPENAI_API_KEY?.trim());
  const model = selectModel(env);
  if (!hasKey && !model) {
    return {
      configured: false,
      model: null,
      hasKey: false,
      reason:
        "Automatic extraction is off. Set OPENAI_API_KEY and OPENAI_MODEL in .env.local to turn it on. Everything else — uploading, reading, manual cells, export — works without it.",
    };
  }
  if (!hasKey) {
    return {
      configured: false,
      model,
      hasKey: false,
      reason: "A model is set but OPENAI_API_KEY is empty, so no request can be made.",
    };
  }
  if (!model) {
    return {
      configured: false,
      model: null,
      hasKey: true,
      reason:
        "A key is set but no model is named. Set OPENAI_MODEL to a model your account can call. Paplora does not guess a default, because an unverified model name would silently change what produced your answers.",
    };
  }
  return { configured: true, model, hasKey: true };
}
