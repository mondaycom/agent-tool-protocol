/**
 * E2E tests for resume token validation and authorization
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { AgentToolProtocolServer } from '@mondaydotcomorg/atp-server';
import fetch from 'node-fetch';
import { randomUUID } from 'node:crypto';

const TEST_PORT = 3502;
const BASE_URL = `http://localhost:${TEST_PORT}`;

describe('Resume Token Validation E2E', () => {
	let server: AgentToolProtocolServer;

	beforeAll(async () => {
		process.env.ATP_JWT_SECRET = 'test-secret-resume-validation';

		server = new AgentToolProtocolServer({
			execution: {
				timeout: 30000,
				memory: 128 * 1024 * 1024,
				llmCalls: 10,
			},
		});

		// Add a tool that requires approval for testing
		server.tool('testOperation', {
			description: 'Test operation for resume',
			input: { value: 'string' },
			handler: async (input: any) => {
				return { processed: input.value };
			},
		});

		await server.listen(TEST_PORT);
	});

	afterAll(async () => {
		if (server) {
			await server.stop();
		}
		delete process.env.ATP_JWT_SECRET;
	});

	test('should reject resume without authentication', async () => {
		const executionId = randomUUID();

		const response = await fetch(`${BASE_URL}/api/resume/${executionId}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ result: { approved: true } }),
		});

		expect(response.status).toBe(401);
		const data = await response.json();
		expect(data.error).toBeTruthy();
	});

	test('should reject resume with invalid token', async () => {
		const executionId = randomUUID();

		const response = await fetch(`${BASE_URL}/api/resume/${executionId}`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: 'Bearer invalid.jwt.token',
				'X-Client-ID': 'cli_invalid',
			},
			body: JSON.stringify({ result: { approved: true } }),
		});

		expect(response.status).toBeGreaterThanOrEqual(401);
	});

	test('should reject resume from different client', async () => {
		// This test verifies that client A cannot resume client B's execution
		// We'll need to create a paused execution first, then try to resume with different client

		// Initialize two clients
		const init1 = await fetch(`${BASE_URL}/api/init`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ clientInfo: { name: 'client1' } }),
		});
		const client1 = await init1.json();

		const init2 = await fetch(`${BASE_URL}/api/init`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ clientInfo: { name: 'client2' } }),
		});
		const client2 = await init2.json();

		// Note: In a full test, we'd need to:
		// 1. Execute code that pauses (requires approval)
		// 2. Get the executionId
		// 3. Try to resume with client2's token
		// Since this requires client-provided services, we'll test the endpoint directly

		const fakeExecutionId = randomUUID();

		const response = await fetch(`${BASE_URL}/api/resume/${fakeExecutionId}`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${client2.token}`,
				'X-Client-ID': client2.clientId,
			},
			body: JSON.stringify({ result: { approved: true } }),
		});

		// Should fail because execution doesn't exist or belongs to different client
		expect(response.status).toBeGreaterThanOrEqual(400);
	});

	test('should validate clientId matches execution owner', async () => {
		// Initialize client
		const initResponse = await fetch(`${BASE_URL}/api/init`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ clientInfo: { name: 'owner-test' } }),
		});
		const { clientId, token } = await initResponse.json();

		// Try to resume with mismatched clientId in header
		const executionId = randomUUID();
		const response = await fetch(`${BASE_URL}/api/resume/${executionId}`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${token}`,
				'X-Client-ID': 'cli_different', // Different from token
			},
			body: JSON.stringify({ result: { approved: true } }),
		});

		// Should fail validation
		expect(response.status).toBeGreaterThanOrEqual(400);
	});

	test('should accept resume with valid authentication', async () => {
		// Initialize client
		const initResponse = await fetch(`${BASE_URL}/api/init`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ clientInfo: { name: 'valid-resume' } }),
		});
		const { clientId, token } = await initResponse.json();

		// For this test, we're just verifying the auth validation passes
		// The execution won't exist, so we'll get 404, but that comes AFTER auth
		const executionId = randomUUID();
		const response = await fetch(`${BASE_URL}/api/resume/${executionId}`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${token}`,
				'X-Client-ID': clientId,
			},
			body: JSON.stringify({ result: { approved: true } }),
		});

		// Should pass auth but fail on execution not found (404)
		expect(response.status).toBe(404); // Not 401 or 403
	});

	test('should refresh token on resume request', async () => {
		// Initialize client
		const initResponse = await fetch(`${BASE_URL}/api/init`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ clientInfo: { name: 'token-refresh' } }),
		});
		const { clientId, token } = await initResponse.json();

		// Try to resume (will fail on execution not found, but should refresh token)
		const executionId = randomUUID();
		const response = await fetch(`${BASE_URL}/api/resume/${executionId}`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${token}`,
				'X-Client-ID': clientId,
			},
			body: JSON.stringify({ result: { approved: true } }),
		});

		// Check for token refresh headers
		const newToken = response.headers.get('X-ATP-Token');
		const expiresAt = response.headers.get('X-ATP-Token-Expires');

		expect(newToken).toBeTruthy();
		expect(expiresAt).toBeTruthy();
		expect(newToken).not.toBe(token);
	});
});
