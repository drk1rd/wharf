// Ask-your-data runs through OpenRouter rather than calling Anthropic directly,
// so the operator (and, per-user, via defaultModel) can pick from OpenRouter's
// full model catalog instead of being locked to one provider.
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

export function askEnabled(): boolean {
  return Boolean(OPENROUTER_API_KEY);
}

export interface OpenRouterModel {
  id: string;
  name?: string;
  contextLength?: number;
}

let modelsCache: { fetchedAt: number; models: OpenRouterModel[] } | null = null;
const MODELS_CACHE_MS = 10 * 60 * 1000;

export async function listModels(): Promise<OpenRouterModel[]> {
  if (!OPENROUTER_API_KEY) return [];
  if (modelsCache && Date.now() - modelsCache.fetchedAt < MODELS_CACHE_MS) {
    return modelsCache.models;
  }
  const res = await fetch(`${OPENROUTER_BASE}/models`, {
    headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` },
  });
  if (!res.ok) {
    throw new Error(`failed to list models from OpenRouter (${res.status})`);
  }
  const body = (await res.json()) as { data?: { id: string; name?: string; context_length?: number }[] };
  const models = (body.data ?? [])
    .map((m) => ({ id: m.id, name: m.name, contextLength: m.context_length }))
    .sort((a, b) => a.id.localeCompare(b.id));
  modelsCache = { fetchedAt: Date.now(), models };
  return models;
}

export type AskableEngine = "postgres" | "mysql" | "clickhouse" | "mongodb";
type SqlEngine = "postgres" | "mysql" | "clickhouse";

function isSqlEngine(engine: AskableEngine): engine is SqlEngine {
  return engine === "postgres" || engine === "mysql" || engine === "clickhouse";
}

export interface GeneratedQuery {
  query: string;
  explanation: string;
}

const GENERATE_QUERY_TOOL = {
  type: "function",
  function: {
    name: "generate_query",
    description: "Return the generated database query and a one-sentence plain-English explanation of what it does.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        explanation: { type: "string" },
      },
      required: ["query", "explanation"],
      additionalProperties: false,
    },
  },
} as const;

const SQL_DIALECT_NAME: Record<SqlEngine, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
  clickhouse: "ClickHouse",
};

function systemPromptFor(engine: AskableEngine, schemaContext: string): string {
  const rules = isSqlEngine(engine)
    ? `You translate a plain-English question into a single read-only ${SQL_DIALECT_NAME[engine]} SELECT statement against the schema below. ` +
        "Never generate INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, or any statement that is not a SELECT. " +
        "Only reference tables and columns that appear in the schema. If the question can't be answered from this schema, " +
        "generate `SELECT 'unable to answer from this schema' AS error` instead of guessing at table/column names."
      : 'You translate a plain-English question into a MongoDB query against the schema below. The "query" field you return ' +
        'must be a JSON string of the exact form {"collection": "<name>", "filter": { ... }, "limit": <number, optional>}. ' +
        "Only reference collections and fields that appear in the schema. The filter must be a plain MongoDB query filter " +
        '(equality, $gt/$lt/$in/etc.) — never $where and never any operator that runs JavaScript. If the question can\'t be ' +
        'answered from this schema, return {"collection": "", "filter": {}} instead of guessing at a collection name.';

  return `${rules}\n\nSchema:\n${schemaContext}`;
}

export async function generateQuery(
  model: string,
  engine: AskableEngine,
  schemaContext: string,
  question: string
): Promise<GeneratedQuery> {
  if (!OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not set on the control plane");
  }
  if (!model) {
    throw new Error("no model selected — pick one in Settings or pass one explicitly");
  }

  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPromptFor(engine, schemaContext) },
        { role: "user", content: question },
      ],
      tools: [GENERATE_QUERY_TOOL],
      tool_choice: { type: "function", function: { name: "generate_query" } },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenRouter request failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const body = (await res.json()) as {
    choices?: { message?: { tool_calls?: { function?: { arguments?: string } }[] } }[];
    error?: { message?: string };
  };
  if (body.error) {
    throw new Error(body.error.message ?? "OpenRouter returned an error");
  }

  const argsJson = body.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!argsJson) {
    throw new Error("the model did not return a query — try rephrasing the question, or pick a different model");
  }

  let input: { query?: unknown; explanation?: unknown };
  try {
    input = JSON.parse(argsJson);
  } catch {
    throw new Error("the model returned malformed JSON — try a different model");
  }
  if (typeof input.query !== "string" || typeof input.explanation !== "string") {
    throw new Error("the model's response was missing query/explanation");
  }

  if (isSqlEngine(engine)) {
    const normalized = input.query.trim().replace(/;+\s*$/, "");
    if (!/^select\b/i.test(normalized)) {
      throw new Error("the generated query was not a read-only SELECT — refusing to run it");
    }
    return { query: normalized, explanation: input.explanation };
  }

  let parsed: { collection?: unknown };
  try {
    parsed = JSON.parse(input.query);
  } catch {
    throw new Error("the generated query was not valid JSON");
  }
  if (typeof parsed.collection !== "string" || !parsed.collection) {
    return { query: input.query, explanation: "Could not find a matching collection for this question." };
  }
  return { query: input.query, explanation: input.explanation };
}
