/**
 * Client Callback Manager
 *
 * Handles callbacks to clients for LLM, approval, and embedding requests
 */
import type { ClientServices } from '@mondaydotcomorg/atp-protocol';
import { log } from '@mondaydotcomorg/atp-runtime';

/**
 * Callback request types
 */
export type CallbackType = 'llm' | 'approval' | 'embedding';

/**
 * Callback request payload
 */
export interface CallbackRequest {
	type: CallbackType;
	operation: string;
	payload: Record<string, unknown>;
}

/**
 * Registered client information
 */
interface ClientInfo {
	clientId: string;
	services: ClientServices;
	callbackUrl?: string;
	lastSeen: Date;
}

/**
 * Callback handler function
 */
export type CallbackHandler = (clientId: string, request: CallbackRequest) => Promise<unknown>;

/**
 * Manages client callbacks for provided services
 */
export class ClientCallbackManager {
	private clients: Map<string, ClientInfo> = new Map();
	private callbackHandler?: CallbackHandler;
	private cleanupInterval?: NodeJS.Timeout;

	/**
	 * Registers a callback handler for client requests
	 * @param handler - Function to handle callbacks
	 */
	setCallbackHandler(handler: CallbackHandler): void {
		this.callbackHandler = handler;

		if (!this.cleanupInterval) {
			this.cleanupInterval = setInterval(
				() => {
					const cleaned = this.cleanupStaleClients();
					if (cleaned > 0) {
						log.debug(`Cleaned up ${cleaned} stale clients`);
					}
				},
				5 * 60 * 1000
			);
		}
	}

	/**
	 * Registers a client with their provided services
	 * @param clientId - Unique client identifier
	 * @param services - Services provided by client
	 * @param callbackUrl - Optional webhook URL for callbacks
	 */
	registerClient(clientId: string, services: ClientServices, callbackUrl?: string): void {
		this.clients.set(clientId, {
			clientId,
			services,
			callbackUrl,
			lastSeen: new Date(),
		});
	}

	/**
	 * Updates client's last seen timestamp
	 * @param clientId - Client identifier
	 */
	updateClientActivity(clientId: string): void {
		const client = this.clients.get(clientId);
		if (client) {
			client.lastSeen = new Date();
		}
	}

	/**
	 * Checks if client has a specific service
	 * @param clientId - Client identifier
	 * @param serviceType - Type of service
	 * @returns Whether client provides this service
	 */
	hasClientService(clientId: string, serviceType: 'llm' | 'approval' | 'embedding'): boolean {
		const client = this.clients.get(clientId);
		if (!client) return false;

		switch (serviceType) {
			case 'llm':
				return client.services.hasLLM;
			case 'approval':
				return client.services.hasApproval;
			case 'embedding':
				return client.services.hasEmbedding;
			default:
				return false;
		}
	}

	/**
	 * Gets client information
	 * @param clientId - Client identifier
	 * @returns Client info or undefined
	 */
	getClient(clientId: string): ClientInfo | undefined {
		return this.clients.get(clientId);
	}

	/**
	 * Sends a callback request to a client
	 * @param clientId - Client identifier
	 * @param request - Callback request
	 * @returns Response from client
	 */
	async sendCallback(clientId: string, request: CallbackRequest): Promise<unknown> {
		const client = this.clients.get(clientId);
		if (!client) {
			throw new Error(`Client ${clientId} not registered`);
		}

		if (!this.hasClientService(clientId, request.type)) {
			throw new Error(`Client ${clientId} does not provide ${request.type} service`);
		}

		if (!this.callbackHandler) {
			throw new Error('No callback handler registered');
		}

		return await this.callbackHandler(clientId, request);
	}

	/**
	 * Cleans up stale clients (not seen in specified duration)
	 * @param maxAge - Maximum age in milliseconds (default: 5 minutes)
	 */
	cleanupStaleClients(maxAge: number = 5 * 60 * 1000): number {
		const now = Date.now();
		let cleaned = 0;

		for (const [clientId, client] of this.clients.entries()) {
			if (now - client.lastSeen.getTime() > maxAge) {
				this.clients.delete(clientId);
				cleaned++;
			}
		}

		return cleaned;
	}

	/**
	 * Gets all registered clients
	 * @returns Array of client information
	 */
	getAllClients(): ClientInfo[] {
		return Array.from(this.clients.values());
	}

	/**
	 * Removes a client
	 * @param clientId - Client identifier
	 */
	unregisterClient(clientId: string): void {
		this.clients.delete(clientId);
	}

	/**
	 * Stops automatic cleanup and clears resources
	 */
	destroy(): void {
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = undefined;
		}
		this.clients.clear();
	}
}

export const clientCallbackManager = new ClientCallbackManager();
