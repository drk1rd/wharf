import Anthropic from "@anthropic-ai/sdk";

// Operators can point this at a different model for cost/latency reasons; the
// default follows Anthropic's current guidance (use the strongest model unless
// told otherwise) rather than picking a "cheap enough" model ourselves.
// `||` (not `??`) deliberately: an empty string (e.g. an unset compose env var
// that still gets passed through as "") must fall back too, not become the model id.
const MODEL = process.env.WHARF_ASK_MODEL || "claude-opus-5";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

export function askEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export interface GeneratedQuery {
  query: string;
  explanation: string;
}

const GENERATE_QUERY_TOOL: Anthropic.Tool = {
  name: "generate_query",
  description: "Return the generated database query and a one-sentence plain-English explanation of what it does.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string" },
      explanation: { type: "string" },
    },
    required: ["query", "explanation"],
    additionalProperties: false,
  },
};

export type AskableEngine = "postgres" | "mysql" | "mongodb";

const SQL_DIALECT_NAME: Record<"postgres" | "mysql", string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
};

function systemPromptFor(engine: AskableEngine, schemaContext: string): string {
  const rules =
    engine === "postgres" || engine === "mysql"
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
  engine: AskableEngine,
  schemaContext: string,
  question: string
): Promise<GeneratedQuery> {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: systemPromptFor(engine, schemaContext),
    messages: [{ role: "user", content: question }],
    tools: [GENERATE_QUERY_TOOL],
    tool_choice: { type: "tool", name: "generate_query" },
  });

  const toolUse = response.content.find((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
  if (!toolUse) {
    throw new Error("the model did not return a query — try rephrasing the question");
  }
  const input = toolUse.input as { query: string; explanation: string };

  if (engine === "postgres" || engine === "mysql") {
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
