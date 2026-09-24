import { getConfig } from './config.js';
import { executeChatCompletion, separateThinkingAndContent } from './llmClient.js';
import { searchVectorStore } from './vectorStore.js';
import { EmbeddingUnavailableError } from './embedder.js';
import { getAuthoritativeGameState, buildChatMessages, estimateTokenCount, estimateToolTokens } from './contextBuilder.js';
import { executeTool, ASSISTANT_TOOLS } from './toolController.js';
import { resolveProfile, getToolsForProfile, getProfileToolNames } from './contextProfiles.js';

/** Chat-log reply for a turn that was short-circuited because the embedding model is unavailable. */
function embeddingUnavailableResult(err, modelUsed, gameState = null, profile = null) {
  console.warn('[Orchestrator] Embedding model unavailable:', err.message);
  return {
    answer: `**Oracle could not search its knowledge base.**

${err.message}

Once the model is installed, ask again.`,
    proposals: [],
    passages: [],
    gameState,
    toolCalls: [],
    executedTools: [],
    modelUsed,
    isOffline: true,
    embeddingUnavailable: true,
    error: err.message,
    contextProfile: profile?.id ?? 'general',
    screen: profile?.screen ?? null,
  };
}

/**
 * Handles the complete RAG + State + Tool Execution pipeline for user queries.
 */
export async function handleAssistantChat({
  query,
  campaignId = null,
  encounterId = null,
  chapterId = null,
  chapterName = null,
  worldId = null,
  worldName = null,
  screen = null,
  model = null,
  mockResponse = false,
}) {
  if (!query || typeof query !== 'string') {
    throw new Error('Query must be a non-empty string');
  }

  const config = getConfig();
  const chosenModel = model || config.activeModel;

  // Screen-aware context profile. `screen` is untrusted client input: it is allow-list
  // validated (unknown -> general) and only ever SUBTRACTS tools / narrows the prompt.
  const profile = resolveProfile(config.contextProfilesEnabled === false ? null : screen);
  const profileTools = getToolsForProfile(profile, ASSISTANT_TOOLS);
  const allowedToolNames = getProfileToolNames(profile);
  // Only offer tools the model can actually call this turn (also drives the prompt's tool rules).
  const toolTokens = estimateToolTokens(profileTools);

  // 1. Vector Search for Top-K passages with relevance filtering to prevent noise
  let rawPassages;
  try {
    rawPassages = await searchVectorStore(query, {
      campaignId,
      limit: config.topKPassages || 3,
    });
  } catch (err) {
    if (err instanceof EmbeddingUnavailableError) return embeddingUnavailableResult(err, chosenModel, null, profile);
    throw err;
  }
  const minScore = config.minPassageScore ?? 0.68;
  const passages = rawPassages.filter((p) => p.score >= minScore);

  // 2. Fetch Authoritative Game State
  const gameState = getAuthoritativeGameState({
    campaignId,
    encounterId,
    chapterId,
    chapterName,
    worldId,
    worldName,
    // Story/world screens (and the encounter builder without a known encounter) get no combat state.
    includeEncounter: profile.gameState === 'full' || (profile.gameState === 'encounter' && !!encounterId),
  });

  // 3. Build Prompt Messages with Context
  const { messages, estimatedTokens } = buildChatMessages({
    query,
    passages,
    gameState,
    maxContextTokens: config.maxContextTokens,
    campaignId,
    profile,
    toolTokens,
  });

  if (mockResponse) {
    // Deterministic mock generation for unit tests / offline verification
    let answer = `[Oracle Answer for "${query}"]\n`;
    if (gameState && gameState.activeChapter) {
      answer += `Active Chapter: ${gameState.activeChapter.title} (ID: ${gameState.activeChapter.id})\n`;
    }
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
      executedTools: [],
      modelUsed: chosenModel,
      estimatedTokens,
      contextProfile: profile.id,
      screen: profile.screen,
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
  // Hoisted so the catch block can still surface proposals that were staged
  // before the LLM call failed (otherwise the DM would never see them).
  const stagedProposals = [];

  try {
    let completionResult = await executeChatCompletion({
      messages,
      tools: profileTools,
      model: chosenModel,
    });

    let currentResponse = completionResult.response;
    let assistantMessage = currentResponse.choices[0]?.message;

    // Track internal model reasoning/thoughts across iterations
    const accumulatedThinking = [];
    if (assistantMessage?.thinking) {
      accumulatedThinking.push(assistantMessage.thinking);
    }

    // 5. Handle structured tool calls if the model invoked any
    let iterations = 0;
    const maxToolIterations = config.maxToolIterations || 20;
    // Every write-tool call in this turn gets its own staged proposal — the
    // DM reviews them one at a time in a queue (see HitlConfirmationBox)
    // rather than only ever being shown the single most recent one. Staging
    // is still read-only (see docs/HITL_WRITE_TOOLS.md); nothing here
    // mutates state, so there is no ordering hazard in staging several in a
    // row. hitlManager itself still caps how many can be pending at once
    // per campaign, so a runaway tool-call loop can't queue unboundedly.

    while (assistantMessage?.tool_calls && assistantMessage.tool_calls.length > 0 && iterations < maxToolIterations) {
      iterations++;
      messages.push(assistantMessage);

      const pendingMultimodalImages = [];

      for (const toolCall of assistantMessage.tool_calls) {
        const fnName = toolCall.function?.name;
        const fnArgs = toolCall.function?.arguments;

        try {
          const toolResult = await executeTool(fnName, fnArgs, {
            campaignId,
            encounterId,
            chapterId,
            chapterName,
            worldId,
            worldName,
            allowedToolNames,
            screenLabel: profile.screenLabel,
          });
          executedToolCalls.push({
            toolName: fnName,
            args: fnArgs,
            result: toolResult,
          });

          const isProposal = !!(toolResult && toolResult.requiresConfirmation && toolResult.proposal);
          if (isProposal) {
            stagedProposals.push(toolResult.proposal);
          }

          // Prepare tool response content for the LLM
          // If toolResult contains a base64 image, keep it out of the JSON string
          // to prevent blowing up the text token budget (<8K limit)
          let toolContentObj = toolResult;
          let attachedImage = null;

          if (isProposal) {
            toolContentObj = {
              status: 'proposal_staged',
              proposalId: toolResult.proposal.proposalId,
              actionDescription: toolResult.proposal.description,
              message: `The proposed action "${toolResult.proposal.description}" has been successfully staged for the Dungeon Master's explicit confirmation. Game state has NOT been altered yet. Inform the DM about the staged proposal and wait for their confirmation.`,
            };
          } else if (
            toolResult &&
            toolResult.image &&
            typeof toolResult.image === 'string' &&
            toolResult.image.startsWith('data:image/')
          ) {
            attachedImage = toolResult.image;
            toolContentObj = {
              ...toolResult,
              image: `[Attached Visual Map Image: ${toolResult.mimeType || 'image/png'}, dimensions ${toolResult.grid?.columns}x${toolResult.grid?.rows} cells, ${toolResult.combatantsCount || 0} combatants marked]`,
            };
          }

          // All tool responses must immediately follow the assistant message
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(toolContentObj),
          });

          if (attachedImage) {
            pendingMultimodalImages.push({
              image: attachedImage,
              encounterName: toolResult.encounterName || toolResult.mapName || 'combat encounter',
            });
          }
        } catch (toolErr) {
          // A missing embedding model is an environment problem, not something for the LLM to
          // work around: stop the turn and tell the DM (handled by the outer catch).
          if (toolErr instanceof EmbeddingUnavailableError) throw toolErr;
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

      // After all role: 'tool' messages are added, attach any pending multimodal map images
      // so OpenAI API requirements (all tool calls answered first) are strictly honored
      for (const imgItem of pendingMultimodalImages) {
        const rawBase64 = imgItem.image.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
        messages.push({
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Visual tactical map image for "${imgItem.encounterName}" with character locations:`,
            },
            {
              type: 'image_url',
              image_url: {
                url: imgItem.image,
              },
            },
          ],
          images: [rawBase64],
        });
      }

      // Re-invoke model with tool execution results
      completionResult = await executeChatCompletion({
        messages,
        tools: profileTools,
        model: completionResult.modelUsed,
      });

      assistantMessage = completionResult.response.choices[0]?.message;
      if (assistantMessage?.thinking && !accumulatedThinking.includes(assistantMessage.thinking)) {
        accumulatedThinking.push(assistantMessage.thinking);
      }
    }

    // Reasoning models occasionally burn their whole token budget on thinking and return an
    // empty answer. Re-ask (bounded) for a direct answer instead of showing a placeholder.
    const maxEmptyAnswerRetries = 2;
    for (let attempt = 0; attempt < maxEmptyAnswerRetries; attempt++) {
      const hasToolCalls = assistantMessage?.tool_calls?.length > 0;
      const { content: probe } = separateThinkingAndContent(
        assistantMessage?.content || '',
        assistantMessage?.thinking || ''
      );
      if (hasToolCalls || probe.trim()) break;

      messages.push({
        role: 'user',
        content:
          'You did not provide a final answer. Reply now with a brief, direct answer to my question using the information already gathered. Do not think further and do not call more tools.',
      });
      completionResult = await executeChatCompletion({
        messages,
        model: completionResult.modelUsed,
      });
      assistantMessage = completionResult.response.choices[0]?.message;
      if (assistantMessage?.thinking && !accumulatedThinking.includes(assistantMessage.thinking)) {
        accumulatedThinking.push(assistantMessage.thinking);
      }
    }

    // Separate thoughts from final answer
    const { thinking: finalTurnThinking, content: cleanFinalContent } = separateThinkingAndContent(
      assistantMessage?.content || '',
      assistantMessage?.thinking || ''
    );

    if (finalTurnThinking && !accumulatedThinking.includes(finalTurnThinking)) {
      accumulatedThinking.push(finalTurnThinking);
    }

    const finalThinking = accumulatedThinking.filter(Boolean).join('\n\n---\n\n').trim();

    let finalAnswer = cleanFinalContent.trim();
    if (!finalAnswer) {
      if (finalThinking) {
        finalAnswer = '*(The model completed its thought process. Expand "Thought Process" above to view its reasoning.)*';
      } else {
        let debugInfo = `\n\n**Oracle Debug Info**:\n`;
        debugInfo += `- Iterations: ${iterations} / ${maxToolIterations}\n`;
        debugInfo += `- Executed Tools: ${executedToolCalls.map((tc) => tc.toolName).join(', ') || 'None'}\n`;
        debugInfo += `- Last message tool_calls: ${assistantMessage?.tool_calls ? assistantMessage.tool_calls.length : 0}\n`;
        if (iterations >= maxToolIterations && assistantMessage?.tool_calls?.length > 0) {
          debugInfo += `- **Reason**: Hit max tool iterations (${maxToolIterations}) and model is still trying to call tools instead of answering.\n`;
        } else {
          debugInfo += `- **Reason**: Model returned an empty content string or no content.\n`;
        }
        finalAnswer = `Oracle response: I could not generate a response.${debugInfo}`;
      }
    }

    return {
      answer: finalAnswer,
      proposals: stagedProposals,
      thinking: finalThinking || null,
      passages,
      gameState,
      toolCalls: executedToolCalls,
      executedTools: executedToolCalls.map((tc) => tc.toolName),
      modelUsed: completionResult.modelUsed,
      isFallback: completionResult.isFallback || false,
      metrics: completionResult.metrics || completionResult.response?.metrics || null,
      contextProfile: profile.id,
      screen: profile.screen,
      estimatedTokens: toolTokens + messages.reduce((s, m) => {
        let text = '';
        let imageCount = 0;
        if (typeof m.content === 'string') {
          text = m.content;
        } else if (Array.isArray(m.content)) {
          text = m.content.map((p) => p.text || '').join(' ');
          imageCount = m.content.filter((p) => p.type === 'image_url').length;
        }
        if (m.images && Array.isArray(m.images)) {
          imageCount = Math.max(imageCount, m.images.length);
        }
        return s + estimateTokenCount(text) + imageCount * 576;
      }, 0),
    };
  } catch (err) {
    if (err instanceof EmbeddingUnavailableError) {
      const result = embeddingUnavailableResult(err, chosenModel, gameState, profile);
      result.proposals = stagedProposals;
      result.toolCalls = executedToolCalls;
      result.executedTools = executedToolCalls.map((tc) => tc.toolName);
      return result;
    }
    // If local Ollama connection fails, return helpful error response with retrieved passages & state
    console.warn('[Orchestrator] LLM invocation failed:', err.message);

    // Provide a graceful synthesized answer from retrieved RAG passages & authoritative state
    let gracefulAnswer = `**Oracle (Offline Mode)**: Could not connect to local LLM (${err.message}).\n\n`;
    if (stagedProposals.length > 0) {
      gracefulAnswer += `**${stagedProposals.length} proposal${stagedProposals.length === 1 ? '' : 's'} already staged before the error and awaiting your confirmation:**\n`;
      stagedProposals.forEach((p) => {
        gracefulAnswer += `- ${p.description}\n`;
      });
      gracefulAnswer += `\n`;
    }
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
      proposals: stagedProposals,
      passages,
      gameState,
      toolCalls: executedToolCalls,
      executedTools: executedToolCalls.map((tc) => tc.toolName),
      modelUsed: chosenModel,
      isOffline: true,
      error: err.message,
      estimatedTokens,
      contextProfile: profile.id,
      screen: profile.screen,
    };
  }
}
