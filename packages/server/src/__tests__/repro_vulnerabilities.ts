
import { SandboxExecutor } from '../executor/executor';
import { ProvenanceMode } from '@mondaydotcomorg/atp-protocol';
import { createServer } from '../server';

async function runRepro() {
    console.log('--- Starting Security Vulnerability Reproduction ---\n');

    const executor = new SandboxExecutor({
        maxMemory: 512 * 1024 * 1024,
        timeout: 5000,
        maxLLMCalls: 0,
        provenanceMode: ProvenanceMode.AST,
        securityPolicies: [
            {
                name: 'block-tainted',
                check: async (tool, args, getProv) => {
                    // Block if any argument is tainted
                    for (const key in args) {
                        const prov = getProv(args[key]);
                        if (prov) {
                            console.log(`[Policy] Blocked tainted value in ${tool}:`, prov);
                            return { action: 'deny', reason: 'Tainted data' };
                        }
                    }
                    return { action: 'allow' };
                }
            }
        ]
    }, [{
        name: 'test',
        functions: [
            {
                name: 'getSecret',
                handler: async () => 'SECRET_PASSWORD',
                metadata: { sensitivityLevel: 'sensitive' } // This should trigger provenance tracking
            },
            {
                name: 'exfiltrate',
                handler: async (data) => {
                    console.log('!!! EXFILTRATED DATA:', data);
                    return 'success';
                }
            }
        ]
    }]);

    // 1. Test Primitive Provenance Loss
    console.log('\n--- Test 1: Primitive Provenance Loss ---');
    try {
        const code = `
            const secret = await api.test.getSecret();
            // The secret is a primitive string.
            // In the current implementation, the link to provenance is LOST here for the value itself.
            // Only the ID returned by __track has metadata, but 'secret' is just a string "SECRET_PASSWORD".
            
            // Let's try to exfiltrate it. Policy should BLOCK this if provenance worked.
            await api.test.exfiltrate(secret);
        `;

        const result = await executor.execute(code, {
            maxLLMCalls: 0,
            allowLLMCalls: false
        });

        console.log('Execution Result:', result.status);
        // If we see "EXFILTRATED DATA", the vulnerability is confirmed.
    } catch (e) {
        console.error('Execution Error:', e);
    }

    // 2. Test Eval Bypass
    console.log('\n--- Test 2: Eval Bypass ---');
    try {
        const code = `
            // Even if provenance worked, eval() is not instrumented.
            // We can use it to bypass AST tracking.
            
            const secret = await api.test.getSecret();
            
            // Use eval to combine strings. The AST instrumentor won't see this binary expression.
            // If 'secret' had provenance, eval() would strip it (or rather, the result of eval wouldn't be tracked).
            const combined = eval('secret + "_suffix"');
            
            await api.test.exfiltrate(combined);
        `;
        const result = await executor.execute(code, {
            maxLLMCalls: 0,
            allowLLMCalls: false
        });
        console.log('Execution Result:', result.status);
    } catch (e) {
        console.error('Execution Error:', e);
    }

    // 3. Test Timer Overwrite
    console.log('\n--- Test 3: Timer Overwrite ---');
    try {
        const code = `
            // This should crash or fail because setTimeout is overwritten with the host version
            setTimeout(() => {
                console.log('Timer executed');
            }, 100);
        `;
        const result = await executor.execute(code, {
            maxLLMCalls: 0,
            allowLLMCalls: false
        });
        console.log('Execution Result:', result.status);
    } catch (e) {
        console.log('Confirmed Crash/Error:', e.message);
    }
}

runRepro().catch(console.error);
