/**
 * Fastify Integration Example
 * Shows how to integrate ATP with Fastify and use Fastify plugins
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { createServer } from '@mondaydotcomorg/atp-server';

const fastify = Fastify({
	logger: true,
});

fastify.addContentTypeParser('application/json', { parseAs: 'string' }, function (req, body, done) {
	try {
		const json = JSON.parse(body as string);
		done(null, json);
	} catch (err: unknown) {
		done(err as Error, undefined);
	}
});

const atpServer = createServer();

// Use Fastify's plugin ecosystem
await fastify.register(cors, {
	origin: '*',
	credentials: true,
});

await fastify.register(rateLimit, {
	max: 100,
	timeWindow: '15 minutes',
});

// Custom authentication hook
fastify.addHook('onRequest', async (request, reply) => {
	const apiKey = request.headers['x-api-key'];

	if (!apiKey) {
		// Optional - allow unauthenticated requests
		return;
	}

	const validKeys = process.env.API_KEYS?.split(',') || [];
	if (!validKeys.includes(apiKey as string)) {
		reply.code(403).send({ error: 'Invalid API key' });
		return;
	}
});

// Add some custom tools
atpServer.tool('greet', {
	description: 'Greet someone by name',
	input: { name: 'string' },
	handler: async (input: unknown) => {
		const { name } = input as { name: string };
		return { greeting: `Hello, ${name}!` };
	},
});

// Get the ATP handler once
const atpHandler = atpServer.toFastify();

// Mount ATP routes - strip /atp prefix before handling
fastify.all('/atp/*', async (request, reply) => {
	const originalUrl = request.raw.url;
	if (originalUrl) {
		request.raw.url = originalUrl.replace('/atp', '');
	}
	await atpHandler(request, reply);
});

// Or mount at root
// fastify.all('/api/*', atpServer.toFastify());

// Other Fastify routes
fastify.get('/', async (request, reply) => {
	return {
		message: 'ATP Server with Fastify',
		atpEndpoint: '/atp/api/info',
	};
});

// Start server
try {
	await fastify.listen({ port: 3000 });
	console.log('Fastify server with ATP running on http://localhost:3000');
	console.log('ATP Info: http://localhost:3000/atp/api/info');
} catch (err) {
	fastify.log.error(err);
	process.exit(1);
}
