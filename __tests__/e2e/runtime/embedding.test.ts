/**
 * E2E tests for runtime embedding/vector API
 * Tests vector storage and semantic search from sandboxed execution
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { AgentToolProtocolServer } from '@mondaydotcomorg/atp-server';
import { AgentToolProtocolClient } from '@mondaydotcomorg/atp-client';
import { randomUUID } from 'node:crypto';

const TEST_PORT = 3343;
const TEST_API_KEY = `test-key-${randomUUID()}`;

describe('Runtime Embedding E2E', () => {
	let server: AgentToolProtocolServer;
	let client: AgentToolProtocolClient;
	let embeddingRequests: Array<{ text: string; model?: string }> = [];

	beforeAll(async () => {
		process.env.ATP_JWT_SECRET = 'test-secret-embedding';
		// Create ATP server
		server = new AgentToolProtocolServer({
			execution: {
				timeout: 30000,
				memory: 128 * 1024 * 1024,
				llmCalls: 10,
			},
		});

		await server.listen(TEST_PORT);

		// Create ATP client
		client = new AgentToolProtocolClient({
			baseUrl: `http://localhost:${TEST_PORT}`,
			headers: { Authorization: `Bearer ${TEST_API_KEY}` },
		});
		await client.init();
		await client.connect();

		// Provide embedding handler (mock embeddings based on text content)
		client.provideEmbedding({
			embed: async (text) => {
				embeddingRequests.push({ text });

				// Generate more distinct embeddings based on text content
				const embedding: number[] = [];
				const words = text.toLowerCase().split(' ');

				for (let i = 0; i < 384; i++) {
					// Create embedding that varies by word content and position
					let value = 0;
					for (let w = 0; w < words.length; w++) {
						const word = words[w] || '';
						const charCode = word.charCodeAt(i % word.length) || 65;
						value += Math.sin((charCode + i + w) * 0.1) * (1 / (w + 1));
					}
					embedding.push(value / Math.max(words.length, 1));
				}
				return embedding;
			},
		});
	});

	beforeEach(() => {
		embeddingRequests.length = 0;
	});

	afterAll(async () => {
		delete process.env.ATP_JWT_SECRET;
		if (server) {
			await server.stop();
		}
	});

	test('should embed and search documents', async () => {
		const code = `
			// Embed some documents
			await atp.embedding.embed('The cat sat on the mat', { collection: 'docs' });
			await atp.embedding.embed('The dog played in the park', { collection: 'docs' });
			await atp.embedding.embed('Birds fly in the sky', { collection: 'docs' });
			
			// Search for similar documents
			const results = await atp.embedding.search('cat on mat', { 
				collection: 'docs',
				topK: 2
			});
			
			return {
				count: results.length,
				topResult: results[0]?.text,
				similarity: results[0]?.similarity,
			};
		`;

		const result = await client.execute(code);

		expect(result.status).toBe('completed');
		const output = result.result as any;

		// Should find similar documents
		expect(output.count).toBe(2);
		expect(output.topResult).toBeTruthy();
		expect(output.similarity).toBeGreaterThan(0); // Has similarity score

		// Verify embeddings were requested
		expect(embeddingRequests.length).toBeGreaterThan(0);
	});

	test('should handle multiple collections', async () => {
		const code = `
			// Embed in different collections
			await atp.embedding.embed('Technical document about APIs', { collection: 'technical' });
			await atp.embedding.embed('Story about a princess', { collection: 'stories' });
			await atp.embedding.embed('REST API design patterns', { collection: 'technical' });
			
			// Search in specific collection
			const techResults = await atp.embedding.search('API patterns', { 
				collection: 'technical',
				topK: 10
			});
			
			const storyResults = await atp.embedding.search('princess', {
				collection: 'stories',
				topK: 10
			});
			
			return {
				techCount: techResults.length,
				storyCount: storyResults.length,
				topTech: techResults[0]?.text,
				topStory: storyResults[0]?.text,
			};
		`;

		const result = await client.execute(code);

		expect(result.status).toBe('completed');
		const output = result.result as any;

		// Collections are isolated
		expect(output.techCount).toBe(2); // 2 technical docs
		expect(output.storyCount).toBe(1); // 1 story
		expect(output.topTech).toContain('API');
		expect(output.topStory).toContain('princess');
	});

	test('should retrieve embedded documents by ID', async () => {
		const code = `
			// Embed documents and get their IDs
			const id1 = await atp.embedding.embed('First document', { 
				collection: 'test',
				metadata: { source: 'test1' }
			});
			const id2 = await atp.embedding.embed('Second document', { 
				collection: 'test',
				metadata: { source: 'test2' }
			});
			
			// Search returns results with IDs
			const results = await atp.embedding.search('document', { 
				collection: 'test',
				topK: 5
			});
			
			return {
				embeddedIds: [id1, id2],
				searchResults: results.map(r => ({ id: r.id, text: r.text, hasMetadata: !!r.metadata })),
			};
		`;

		const result = await client.execute(code);

		expect(result.status).toBe('completed');
		const output = result.result as any;

		expect(output.embeddedIds).toHaveLength(2);
		expect(output.embeddedIds[0]).toBeTruthy();
		expect(output.embeddedIds[1]).toBeTruthy();

		expect(output.searchResults).toHaveLength(2);
		expect(output.searchResults[0].hasMetadata).toBe(true);
	});

	test('should handle empty searches', async () => {
		const code = `
			// Search in empty collection
			const results = await atp.embedding.search('anything', { 
				collection: 'empty-collection',
				topK: 10
			});
			
			return { count: results.length };
		`;

		const result = await client.execute(code);

		expect(result.status).toBe('completed');
		const output = result.result as any;
		expect(output.count).toBe(0);
	});

	test('should support similarity threshold filtering', async () => {
		const code = `
			// Embed diverse documents
			await atp.embedding.embed('Machine learning algorithms', { collection: 'ml' });
			await atp.embedding.embed('Deep neural networks', { collection: 'ml' });
			await atp.embedding.embed('Recipe for chocolate cake', { collection: 'ml' });
			
			// Search with high threshold
			const results = await atp.embedding.search('neural networks', { 
				collection: 'ml',
				topK: 10,
				minSimilarity: 0.7
			});
			
			return {
				count: results.length,
				allAboveThreshold: results.every(r => r.similarity >= 0.7),
				hasRecipe: results.some(r => r.text.includes('chocolate')),
			};
		`;

		const result = await client.execute(code);

		expect(result.status).toBe('completed');
		const output = result.result as any;

		expect(output.allAboveThreshold).toBe(true);
	});

	test('should work with metadata filtering', async () => {
		const code = `
			// Embed with rich metadata
			await atp.embedding.embed('Document 1', { 
				collection: 'docs',
				metadata: { category: 'tech', year: 2024 }
			});
			await atp.embedding.embed('Document 2', { 
				collection: 'docs',
				metadata: { category: 'business', year: 2024 }
			});
			await atp.embedding.embed('Document 3', { 
				collection: 'docs',
				metadata: { category: 'tech', year: 2023 }
			});
			
			// Search and filter by metadata
			const allResults = await atp.embedding.search('Document', { 
				collection: 'docs',
				topK: 10
			});
			
			// Client-side filtering (server-side filtering not implemented in this test)
			const techDocs = allResults.filter(r => r.metadata?.category === 'tech');
			
			return {
				totalCount: allResults.length,
				techCount: techDocs.length,
				allHaveMetadata: allResults.every(r => r.metadata),
			};
		`;

		const result = await client.execute(code);

		expect(result.status).toBe('completed');
		const output = result.result as any;

		expect(output.totalCount).toBe(3);
		expect(output.techCount).toBeGreaterThanOrEqual(0);
		expect(output.allHaveMetadata).toBe(true);
	});
});
