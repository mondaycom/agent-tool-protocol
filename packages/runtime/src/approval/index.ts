/**
 * Approval API - Clean refactored version with decorators and extracted modules
 *
 * Benefits:
 * - No duplication between implementation and metadata
 * - Types auto-detected from TypeScript signatures
 * - Clean separation of concerns (handler, API)
 */
import { RuntimeAPI, RuntimeMethod } from '../metadata/decorators.js';
import { getApprovalHandler } from './handler.js';
import { pauseForCallback, CallbackType, ApprovalOperation } from '../pause/index.js';
import type { ApprovalRequest, ApprovalResponse } from './types';
import { nextSequenceNumber, getCachedResult, shouldPauseForClient } from '../llm/replay.js';

export type { ApprovalRequest, ApprovalResponse, ApprovalSchema } from './types';
export { initializeApproval } from './handler.js';

/**
 * Approval Runtime API
 *
 * Allows agents to request explicit human approval before proceeding with sensitive operations.
 * This integrates with MCP's elicitation feature to request structured input from users.
 */
@RuntimeAPI('approval', 'Approval API - Request explicit human approval for sensitive operations')
class ApprovalAPI {
	/**
	 * Request approval from a human
	 */
	@RuntimeMethod('Request approval from a human', {
		message: {
			description: 'The message to display to the user',
		},
		context: {
			description: 'Optional context information about what needs approval',
			optional: true,
			type: 'Record<string, unknown>',
		},
	})
	async request(message: string, context?: Record<string, unknown>): Promise<ApprovalResponse> {
		const currentSequence = nextSequenceNumber();

		const cachedResult = getCachedResult(currentSequence);
		if (cachedResult !== undefined) {
			return cachedResult as ApprovalResponse;
		}

		const shouldPause = shouldPauseForClient();
		if (shouldPause) {
			pauseForCallback(CallbackType.APPROVAL, ApprovalOperation.REQUEST, {
				message,
				context,
				sequenceNumber: currentSequence,
			});
		}

		const handler = getApprovalHandler();
		if (!handler) {
			throw new Error(
				'Approval handler not configured. Human approval is required but no handler is set.'
			);
		}

		const approvalRequest: ApprovalRequest = {
			message,
			context,
			timeout: 300000,
		};

		let timeoutId: NodeJS.Timeout | null = null;
		const timeoutPromise = new Promise<ApprovalResponse>((_, reject) => {
			timeoutId = setTimeout(
				() => reject(new Error('Approval request timed out')),
				approvalRequest.timeout!
			);
		});

		try {
			const response = await Promise.race([handler(approvalRequest), timeoutPromise]);

			if (timeoutId) clearTimeout(timeoutId);

			return {
				...response,
				timestamp: Date.now(),
			};
		} catch (error) {
			if (timeoutId) clearTimeout(timeoutId);
			throw new Error(
				`Approval request failed: ${error instanceof Error ? error.message : 'Unknown error'}`
			);
		}
	}
}

export const approval = new ApprovalAPI();
