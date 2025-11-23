/**
 * Express Integration Example
 * Shows how to integrate ATP with Express and use Express middleware ecosystem
 */

import express from 'express';
import cors from 'cors';
// @ts-ignore - express-rate-limit types may not be available
import rateLimit from 'express-rate-limit';
import { createServer } from '@mondaydotcomorg/atp-server';

const app = express();
const atpServer = createServer();

// Use Express's own middleware
app.use(
	cors({
		origin: '*',
		credentials: true,
	})
);

app.use(
	rateLimit({
		windowMs: 15 * 60 * 1000, // 15 minutes
		max: 100, // Limit each IP to 100 requests per windowMs
	})
);

app.use(express.json());

// Custom authentication middleware using Express
app.use((req, res, next) => {
	const apiKey = req.headers['x-api-key'];

	if (!apiKey) {
		// Optional - allow unauthenticated requests
		return next();
	}

	const validKeys = process.env.API_KEYS?.split(',') || [];
	if (!validKeys.includes(apiKey as string)) {
		return res.status(403).json({ error: 'Invalid API key' });
	}

	next();
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

// Mount ATP routes under /atp prefix - ATP expects /api/* routes
// So /atp/api/info will be handled by ATP's /api/info
app.use('/atp', atpServer.toExpress());

// Or mount at root
// app.all('/api/*', atpServer.toExpress());

// Other Express routes
app.get('/', (req, res) => {
	res.json({
		message: 'ATP Server with Express',
		atpEndpoint: '/atp/api/info',
	});
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
	console.log(`Express server with ATP running on http://localhost:${PORT}`);
	console.log(`ATP Info: http://localhost:${PORT}/atp/api/info`);
});
