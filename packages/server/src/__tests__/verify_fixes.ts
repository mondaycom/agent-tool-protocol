
import { SandboxExecutor } from '../executor/executor';
import { ProvenanceMode } from '@mondaydotcomorg/atp-protocol';

async function runRepro() {
    console.log('--- Starting Security Vulnerability Reproduction (Debug Mode) ---\n');

    const executor = new SandboxExecutor({
        defaultMemoryLimit: 2048 * 1024 * 1024,
        maxMemoryLimit: 4096 * 1024 * 1024,
        defaultTimeout: 10000,
        maxTimeout: 20000,
        defaultLLMCallLimit: 0,
        maxLLMCallLimit: 0
    }, [{
        name: 'test',
        functions: [
            {
                name: 'getSecret',
                handler: async () => 'SECRET_PASSWORD',
                metadata: { sensitivityLevel: 'sensitive' }
            },
            {
                name: 'exfiltrate',
                handler: async (data) => {
                    console.log('!!! EXFILTRATED DATA:', data);
                    return 'success';
                }
            }
        ]
    }],
        async (request) => {
            console.log('[Approval] Auto-approving:', request);
            return { approved: true };
        });

    // 1. Test Primitive Provenance Loss
    console.log('\n--- Test 1: Primitive Provenance Loss ---');
    try {
        const code = `
            const secret = await api.test.getSecret();
            await api.test.exfiltrate(secret);
        `;

        const result = await executor.execute(code, {
            maxLLMCalls: 0,
            allowLLMCalls: false,
            maxMemory: 2048 * 1024 * 1024,
            timeout: 10000,
            allowedAPIs: [],
            provenanceMode: ProvenanceMode.AST,
            securityPolicies: [
                {
                    name: 'block-tainted',
                    check: async (tool, args, getProv) => {
                        console.log(`[Policy] Checking ${tool} with args:`, args);
                        // Block if any argument is tainted
                        for (const key in args) {
                            const val = args[key];
                            console.log(`[Policy] Checking arg ${key}:`, val);
                            const prov = getProv(val);
                            console.log(`[Policy] Provenance for ${key}:`, prov);
                            if (prov) {
                                console.log(`[Policy] Blocked tainted value in ${tool}:`, prov);
                                return { action: 'deny', reason: 'Tainted data' };
                            }
                        }
                        return { action: 'allow' };
                    }
                }
            ]
        });

        console.log('Execution Result:', result.status);
    } catch (e) {
        console.error('Execution Error:', e);
    }

    // 2. Test Eval Bypass
    console.log('\n--- Test 2: Eval Bypass ---');
    try {
        const code = `
            const secret = await api.test.getSecret();
            // Use eval to combine strings. The AST instrumentor won't see this binary expression.
            const combined = eval('secret + "_suffix"');
            await api.test.exfiltrate(combined);
        `;
        const result = await executor.execute(code, {
            maxLLMCalls: 0,
            allowLLMCalls: false,
            maxMemory: 2048 * 1024 * 1024,
            timeout: 10000,
            allowedAPIs: [],
            provenanceMode: ProvenanceMode.AST,
            securityPolicies: [
                {
                    name: 'block-tainted',
                    check: async (tool, args, getProv) => {
                        for (const key in args) {
                            const prov = getProv(args[key]);
                            if (prov) {
                                return { action: 'deny', reason: 'Tainted data' };
                            }
                        }
                        return { action: 'allow' };
                    }
                }
            ]
        });
        console.log('Execution Result:', result.status);
    } catch (e) {
        console.error('Execution Error:', e);
    }

    // 3. Test Timer Overwrite
    console.log('\n--- Test 3: Timer Overwrite ---');
    try {
        const code = `
            await new Promise(resolve => {
                setTimeout(() => {
                    console.log('Timer executed');
                    resolve();
                }, 100);
            });
        `;
        const result = await executor.execute(code, {
            maxLLMCalls: 0,
            allowLLMCalls: false,
            maxMemory: 2048 * 1024 * 1024,
            timeout: 10000,
            allowedAPIs: [],
            provenanceMode: ProvenanceMode.AST
        });
        console.log('Execution Result:', result.status);
    } catch (e) {
        console.log('Confirmed Crash/Error:', e.message);
    }
}

runRepro().catch(console.error);
