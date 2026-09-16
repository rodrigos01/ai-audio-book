import { generateText } from "../../llm/geminiClient";
import {
  buildAgentSystemInstruction,
  buildKickoffTurnPrompt,
  buildResponseTurnPrompt,
  type AgentContext,
} from "../../llm/prompts/hostPersona.prompts";
import { agentTurnSchema, type AgentTurn } from "../../schemas/agentTurn.schema";
import type { Speaker } from "./speakerSelection";

export class AgentSession {
  private readonly systemInstruction: string;

  constructor(
    private readonly speaker: Speaker,
    context: AgentContext,
  ) {
    this.systemInstruction = buildAgentSystemInstruction(speaker, context);
  }

  async kickoff(wordTarget: { min: number; max: number }): Promise<AgentTurn> {
    return generateText({
      systemInstruction: this.systemInstruction,
      prompt: buildKickoffTurnPrompt(wordTarget),
      schema: agentTurnSchema,
    });
  }

  async respond(
    transcriptSoFar: string,
    currentWordCount: number,
    wordTarget: { min: number; max: number },
  ): Promise<AgentTurn> {
    return generateText({
      systemInstruction: this.systemInstruction,
      prompt: buildResponseTurnPrompt(transcriptSoFar, currentWordCount, wordTarget),
      schema: agentTurnSchema,
    });
  }

  get name(): string {
    return this.speaker.name;
  }

  get isHost(): boolean {
    return this.speaker.isHost;
  }
}
