import type { CacheProvider, AuthProvider, AuditSink } from '@mondaydotcomorg/atp-protocol';
import { log } from '@mondaydotcomorg/atp-runtime';

export interface BannerOptions {
	port: number;
	cacheProvider?: CacheProvider;
	authProvider?: AuthProvider;
	auditSink?: AuditSink;
}

/**
 * Prints a startup banner with server information
 */
export function printBanner(options: BannerOptions): void {
	const { port, cacheProvider, authProvider, auditSink } = options;

	log.info('ATP Server ready!');
	log.info(`Server running at http://localhost:${port}/`);
	log.info(`Type definitions: http://localhost:${port}/openapi.json`);
	log.info(`API search: http://localhost:${port}/explorer`);

	if (cacheProvider) log.info(`Cache: ${cacheProvider.name}`);
	if (authProvider) log.info(`Auth: ${authProvider.name}`);
	if (auditSink) log.info(`Audit: ${auditSink.name}`);
}
