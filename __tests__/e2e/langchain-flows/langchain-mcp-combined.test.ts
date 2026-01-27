import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { ChatOpenAI } from '@langchain/openai';
import { createATPTools } from '@mondaydotcomorg/atp-langchain';
import { loadOpenAPI } from '@mondaydotcomorg/atp-server';
import type { AuthProvider, CustomFunctionDef } from '@mondaydotcomorg/atp-protocol';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
	createTestATPServer,
	createCleanupTracker,
	cleanupAll,
	getTestPort,
	loadOpenAPISpec,
	replacePortInSpec,
	type TestServer,
	type CleanupTracker,
} from '../infrastructure/test-helpers';
import { GitHubMockServer } from '../infrastructure/mock-servers/github-mock';
import { FilesystemMockMCP } from '../infrastructure/mock-mcps/filesystem-mock-mcp';
import { SlackMockMCP } from '../infrastructure/mock-mcps/slack-mock-mcp';

describe('LangChain: MCP + OpenAPI Combined', () => {
	let atpServer: TestServer;
	let githubServer: GitHubMockServer;
	let filesystemMCP: FilesystemMockMCP;
	let slackMCP: SlackMockMCP;
	let cleanup: CleanupTracker;
	let githubPort: number;
	const tempFiles: string[] = [];
	const createdTools: any[] = [];
	const mcpAuthToken = 'test-mcp-auth-token';
	const slackApiKey = 'test-slack-api-key';

	const mockAuthProvider: AuthProvider = {
		name: 'test-auth',
		async getCredential(key: string): Promise<string | null> {
			if (key === 'GITHUB_MOCK_API_TOKEN') return 'mock_github_token';
			return null;
		},
		async setCredential(): Promise<void> {},
		async deleteCredential(): Promise<void> {},
	};

	beforeAll(async () => {
		process.env.ATP_JWT_SECRET = 'test-secret-langchain-mcp';
		process.env.OPENAI_API_KEY = 'sk-fake-key-for-testing';
		cleanup = createCleanupTracker();

		await new Promise((resolve) => setTimeout(resolve, 500));

		githubPort = getTestPort();

		githubServer = new GitHubMockServer({ port: githubPort });
		await githubServer.start();
		cleanup.httpServers.push(githubServer);
		await new Promise((resolve) => setTimeout(resolve, 200));

		filesystemMCP = new FilesystemMockMCP({ authToken: mcpAuthToken });
		slackMCP = new SlackMockMCP({ apiKey: slackApiKey });

		await filesystemMCP.handleRequest(
			{ jsonrpc: '2.0', id: 0, method: 'initialize' },
			mcpAuthToken
		);
		await slackMCP.handleRequest({ jsonrpc: '2.0', id: 0, method: 'initialize' }, slackApiKey);

		const githubSpec = replacePortInSpec(loadOpenAPISpec('github-mock'), {
			GITHUB_PORT: githubPort,
			OAUTH_PORT: 0,
		});

		const githubSpecPath = join(tmpdir(), `github-spec-langchain-mcp-${Date.now()}.json`);
		writeFileSync(githubSpecPath, JSON.stringify(githubSpec));
		tempFiles.push(githubSpecPath);

		const githubApiGroup = await loadOpenAPI(githubSpecPath, {
			name: 'github',
			baseURL: `http://localhost:${githubPort}`,
			authProvider: mockAuthProvider,
		});

		const filesystemFunctions: CustomFunctionDef[] = [
			{
				name: 'readFile',
				description: 'Read file from filesystem MCP',
				inputSchema: {
					type: 'object',
					properties: { path: { type: 'string' } },
					required: ['path'],
				},
				handler: async (input: any) => {
					const response = await filesystemMCP.handleRequest(
						{
							jsonrpc: '2.0',
							id: 1,
							method: 'tools/call',
							params: { name: 'readFile', arguments: input },
						},
						mcpAuthToken
					);
					if (response.error) throw new Error(response.error.message);
					return response.result.content[0].text;
				},
			},
		];

		const slackFunctions: CustomFunctionDef[] = [
			{
				name: 'listChannels',
				description: 'List Slack channels via MCP',
				inputSchema: {
					type: 'object',
					properties: {},
				},
				handler: async () => {
					const response = await slackMCP.handleRequest(
						{
							jsonrpc: '2.0',
							id: 1,
							method: 'tools/call',
							params: { name: 'listChannels', arguments: {} },
						},
						slackApiKey
					);
					if (response.error) throw new Error(response.error.message);
					return JSON.parse(response.result.content[0].text);
				},
			},
		];

		atpServer = await createTestATPServer({
			apiGroups: [
				githubApiGroup,
				{ name: 'filesystem', type: 'mcp', functions: filesystemFunctions },
				{ name: 'slack', type: 'mcp', functions: slackFunctions },
			],
		});

		cleanup.servers.push(atpServer);
	});

	afterAll(async () => {
		for (const toolSet of createdTools) {
			try {
				if (toolSet.client) {
					await toolSet.client.close?.();
				}
			} catch (e) {
				// Ignore
			}
		}
		createdTools.length = 0;

		await cleanupAll(cleanup);

		tempFiles.forEach((file) => {
			try {
				unlinkSync(file);
			} catch (e) {
				// Ignore
			}
		});
	});

	it('should execute OpenAPI + MCP through LangChain tools', async () => {
		const llm = new ChatOpenAI({ modelName: 'gpt-4', openAIApiKey: 'sk-fake-key' });
		const { client, tools } = await createATPTools({
			serverUrl: `http://localhost:${atpServer.port}`,
			llm,
		});
		createdTools.push({ client });

		const executeCodeTool = tools.find((t) => t.name === 'atp_execute_code');
		expect(executeCodeTool).toBeDefined();

		const code = `
			const user = await api.github.getAuthenticatedUser();
			const file = await api.filesystem.readFile({ path: '/test/file1.txt' });
			const channels = await api.slack.listChannels();
			
			return {
				github: user.login,
				fileContent: file,
				slackChannels: channels.channels.length
			};
		`;

		const result = await executeCodeTool!.invoke(code);
		const parsed = JSON.parse(result);

		expect(parsed.success).toBe(true);
		expect(parsed.result.github).toBe('testuser');
		expect(parsed.result.fileContent).toContain('Content');
		expect(parsed.result.slackChannels).toBeGreaterThan(0);
	});

	it('should search APIs through LangChain', async () => {
		const llm = new ChatOpenAI({ modelName: 'gpt-4', openAIApiKey: 'sk-fake-key' });
		const { client, tools } = await createATPTools({
			serverUrl: `http://localhost:${atpServer.port}`,
			llm,
		});
		createdTools.push({ client });

		const searchTool = tools.find((t) => t.name === 'atp_search_api');
		expect(searchTool).toBeDefined();

		const searchResult = await searchTool!.invoke({ query: 'repository' });
		const parsed = typeof searchResult === 'string' ? JSON.parse(searchResult) : searchResult;

		const results = Array.isArray(parsed) ? parsed : parsed.results || [];
		expect(results.length).toBeGreaterThan(0);
	});

	it('should handle MCP auth validation through LangChain', async () => {
		const llm = new ChatOpenAI({ modelName: 'gpt-4', openAIApiKey: 'sk-fake-key' });
		const { client, tools } = await createATPTools({
			serverUrl: `http://localhost:${atpServer.port}`,
			llm,
		});
		createdTools.push({ client });

		const executeCodeTool = tools.find((t) => t.name === 'atp_execute_code');

		const code = `
			const file = await api.filesystem.readFile({ path: '/test/file1.txt' });
			return { content: file };
		`;

		const result = await executeCodeTool!.invoke(code);
		const parsed = JSON.parse(result);

		expect(parsed.success).toBe(true);
		expect(parsed.result.content).toBeDefined();
		expect(typeof parsed.result.content).toBe('string');
	});

	it('should execute complex workflow combining OpenAPI and MCP through LangChain', async () => {
		const llm = new ChatOpenAI({ modelName: 'gpt-4', openAIApiKey: 'sk-fake-key' });
		const { client, tools } = await createATPTools({
			serverUrl: `http://localhost:${atpServer.port}`,
			llm,
		});
		createdTools.push({ client });

		const executeCodeTool = tools.find((t) => t.name === 'atp_execute_code');

		const code = `
			const repos = await api.github.listRepositories();
			const config = await api.filesystem.readFile({ path: '/data/config.json' });
			const channels = await api.slack.listChannels();
			
			return {
				repoCount: repos.length,
				configData: config,
				channelCount: channels.channels.length,
				workflow: 'completed'
			};
		`;

		const result = await executeCodeTool!.invoke(code);
		const parsed = JSON.parse(result);

		expect(parsed.success).toBe(true);
		expect(parsed.result.repoCount).toBeGreaterThanOrEqual(0);
		expect(parsed.result.configData).toBeDefined();
		expect(parsed.result.channelCount).toBeGreaterThan(0);
		expect(parsed.result.workflow).toBe('completed');
	});
});
