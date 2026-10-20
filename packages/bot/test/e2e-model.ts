import { strict as assert } from "node:assert";
import { Schema } from "effect";
import type { Action } from "../src/actions/catalog.ts";

const tools = [
  "discord_send_message",
  "discord_edit_message",
  "discord_delete_message",
  "discord_add_reaction",
  "discord_remove_reaction",
  "discord_create_thread",
  "discord_list_channels",
  "discord_read_messages",
  "discord_search_messages",
  "discord_get_member",
  "discord_typing",
];
const inputSchema = Schema.Struct({
  tools: Schema.Array(Schema.Struct({ function: Schema.Struct({ name: Schema.String }) })),
  messages: Schema.Array(
    Schema.Struct({
      role: Schema.String,
      content: Schema.optional(Schema.Json),
      tool_call_id: Schema.optional(Schema.String),
    }),
  ),
});

export interface Step {
  action: Action;
  check: (result: string) => void | Promise<void>;
}

export class ScriptedModel {
  private turn = 0;
  private steps: Step[] = [];
  private error: Error | undefined;
  private checked = 0;
  private briefing = "";
  private readonly completed = new Set<string>();

  start(steps: Step[]) {
    this.turn = 0;
    this.steps = steps;
    this.error = undefined;
    this.checked = 0;
    this.briefing = "";
  }

  async respond(request: Request) {
    const turn = this.turn++;
    let step: Step | undefined;
    try {
      const input = Schema.decodeUnknownSync(inputSchema)(await request.json());
      const names = input.tools.map((tool) => tool.function.name);
      assert(!names.includes("question"), "question must never reach the model");
      assert.deepEqual(
        names.filter((name) => name.startsWith("discord_")).toSorted(),
        tools.toSorted(),
      );
      if (turn === 0)
        this.briefing = JSON.stringify(input.messages.filter((item) => item.role === "user"));
      const previous = this.steps[turn - 1];
      if (previous) {
        const result = input.messages.find(
          (item) => item.role === "tool" && item.tool_call_id === `call_${turn - 1}`,
        );
        assert(result, `Missing result for ${previous.action.name}`);
        assert.equal(typeof result.content, "string", JSON.stringify(result));
        assert(typeof result.content === "string");
        await previous.check(result.content);
        this.checked++;
        this.completed.add(previous.action.name);
      }
      step = this.steps[turn];
    } catch (error) {
      this.error = error instanceof Error ? error : new Error(String(error));
    }
    const chunk = {
      id: `chatcmpl_${turn}`,
      object: "chat.completion.chunk",
      created: 1,
      model: "scripted",
      choices: [
        {
          index: 0,
          delta: step
            ? {
                role: "assistant",
                tool_calls: [
                  {
                    index: 0,
                    id: `call_${turn}`,
                    type: "function",
                    function: {
                      name: step.action.name,
                      arguments: JSON.stringify(step.action.args),
                    },
                  },
                ],
              }
            : { role: "assistant", content: "This plain answer must never reach Discord." },
          finish_reason: step ? "tool_calls" : "stop",
        },
      ],
    };
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
      headers: { "content-type": "text/event-stream" },
    });
  }

  finish() {
    if (this.error) throw this.error;
    assert.equal(this.checked, this.steps.length, "Every Action must return a checked tool result");
    assert.equal(this.turn, this.steps.length + 1, "The model must finish with a plain answer");
    assert.match(this.briefing, /Server: Our server/);
    assert.match(this.briefing, /Channel: #general/);
    assert.match(this.briefing, /Earlier conversation/);
    assert.match(this.briefing, /Mention:/);
  }

  finishSuite() {
    assert.deepEqual(
      [...this.completed].toSorted(),
      tools.toSorted(),
      "Exercise all eleven Actions",
    );
  }
}
