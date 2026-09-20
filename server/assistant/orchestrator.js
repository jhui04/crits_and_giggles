import { getConfig } from './config.js';
import { executeChatCompletion } from './llmClient.js';
import { searchVectorStore } from './vectorStore.js';
import { getAuthoritativeGameState, buildChatMessages, estimateTokenCount } from './contextBuilder.js';
import { ASSISTANT_TOOLS, executeTool } from './toolController.js';

/**
 * Handles the complete RAG + State + Tool Execution pipeline for user queries.
 */
export async function handleAssistantChat({
  query,
  campaignId = null,
  encounterId = null,
  model = null,
  mockResponse = false,
}) {
  if (!query || typeof query !== 'string') {
    throw new Error('Query must be a non-empty string');
  }

  const config = getConfig();
  const chosenModel = model || config.activeModel;

  // 1. Vector Search for Top-K passages
  const passages = await searchVectorStore(query, {
    campaignId,
    limit: config.topKPassages || 3,
  });

  // 2. Fetch Authoritative Game State
  const gameState = getAuthoritativeGameState({ campaignId, encounterId });

  // 3. Build Prompt Messages with Context
  const { messages, estimatedTokens } = buildChatMessages({
    query,
    passages,
    gameState,
    maxContextTokens: config.maxContextTokens,
  });

  if (mockResponse) {
    // Deterministic mock generation for unit tests / offline verification
    let answer = `[Oracle Answer for "${query}"]\n`;
    if (gameState && gameState.combatants && gameState.combatants.length > 0) {
      const top = gameState.combatants[0];
      answer += `Currently in ${gameState.activeEncounter || 'combat'}: ${top.name} has ${top.currentHp}/${top.maxHp} HP.\n`;
    }
    if (passages.length > 0) {
      answer += `According to ${passages[0].title}: ${passages[0].content.slice(0, 100)}...`;
    }

    return {
      answer,
      passages,
      gameState,
      toolCalls: [],
      modelUsed: chosenModel,
      estimatedTokens,
      metrics: {
        load_duration: 50000000,
        total_duration: 250000000,
        eval_count: 85,
        eval_duration: 200000000,
      },
    };
  }

  // 4. Call Local LLM via OpenAI abstraction with tools
  const executedToolCalls = [];

  try {
    let completionResult = await executeChatCompletion({
      messages,
      tools: ASSISTANT_TOOLS,
      model: chosenModel,
    });

    let currentResponse = completionResult.response;
    let assistantMessage = currentResponse.choices[0]?.message;

    // 5. Handle structured tool calls if the model invoked any
    let iterations = 0;
    const maxToolIterations = 3;

    while (assistantMessage?.tool_calls && assistantMessage.tool_calls.length > 0 && iterations < maxToolIterations) {
      iterations++;
      messages.push(assistantMessage);

      for (const toolCall of assistantMessage.tool_calls) {
        const fnName = toolCall.function?.name;
        const fnArgs = toolCall.function?.arguments;

        try {
          const toolResult = await executeTool(fnName, fnArgs, { campaignId, encounterId });
          executedToolCalls.push({
            toolName: fnName,
            args: fnArgs,
            result: toolResult,
          });

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(toolResult),
          });
        } catch (toolErr) {
          executedToolCalls.push({
            toolName: fnName,
            args: fnArgs,
            error: toolErr.message,
          });

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({ error: toolErr.message }),
          });
        }
      }

      // Re-invoke model with tool execution results
      completionResult = await executeChatCompletion({
        messages,
        tools: ASSISTANT_TOOLS,
        model: completionResult.modelUsed,
      });

      assistantMessage = completionResult.response.choices[0]?.message;
    }

    const finalAnswer = assistantMessage?.content || 'I could not generate a response.';

    return {
      answer: finalAnswer,
      passages,
      gameState,
      toolCalls: executedToolCalls,
      modelUsed: completionResult.modelUsed,
      isFallback: completionResult.isFallback || false,
      metrics: completionResult.metrics || completionResult.response?.metrics || null,
      estimatedTokens: messages.reduce((s, m) => s + estimateTokenCount(m.content || ''), 0),
    };
  } catch (err) {
    // If local Ollama connection fails, return helpful error response with retrieved passages & state
    console.warn('[Orchestrator] LLM invocation failed:', err.message);

    // Provide a graceful synthesized answer from retrieved RAG passages & authoritative state
    let gracefulAnswer = `**Oracle (Offline Mode)**: Could not connect to local LLM (${err.message}).\n\n`;
    if (gameState.combatants && gameState.combatants.length > 0) {
      gracefulAnswer += `### Current Encounter: ${gameState.activeEncounter || 'Active'}\n`;
      gameState.combatants.forEach((c) => {
        gracefulAnswer += `- **${c.name}**: ${c.currentHp}/${c.maxHp} HP${c.position ? ` at (${c.position.x}, ${c.position.y})` : ''}\n`;
      });
      gracefulAnswer += `\n`;
    }

    if (passages.length > 0) {
      gracefulAnswer += `### Relevant Rules & Lore:\n`;
      passages.forEach((p) => {
        gracefulAnswer += `#### ${p.title}\n${p.content}\n\n`;
      });
    }

    return {
      answer: gracefulAnswer,
      passages,
      gameState,
      toolCalls: executedToolCalls,
      modelUsed: chosenModel,
      isOffline: true,
      error: err.message,
      estimatedTokens,
    };
  }
}
