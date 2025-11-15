import { ExecutionStatus, ExecutionErrorCode } from '@mondaydotcomorg/atp-protocol';

export interface ErrorCategory {
	status: ExecutionStatus;
	code: ExecutionErrorCode;
	retryable: boolean;
	suggestion?: string;
}

export function categorizeError(error: Error): ErrorCategory {
	const message = error.message.toLowerCase();

	if (message.includes('timed out') || message.includes('timeout')) {
		return {
			status: ExecutionStatus.TIMEOUT,
			code: ExecutionErrorCode.TIMEOUT_ERROR,
			retryable: true,
			suggestion:
				'Consider breaking down the operation into smaller steps or increasing the timeout',
		};
	}

	if (message.includes('memory') || message.includes('heap')) {
		return {
			status: ExecutionStatus.MEMORY_EXCEEDED,
			code: ExecutionErrorCode.MEMORY_LIMIT_EXCEEDED,
			retryable: false,
			suggestion: 'Reduce data size, use streaming, or request higher memory limits',
		};
	}

	if (message.includes('exceeded max llm calls') || message.includes('llm call')) {
		return {
			status: ExecutionStatus.LLM_CALLS_EXCEEDED,
			code: ExecutionErrorCode.LLM_CALL_LIMIT_EXCEEDED,
			retryable: false,
			suggestion: 'Reduce LLM calls, cache results, or request higher limits',
		};
	}

	if (
		message.includes('not allowed') ||
		message.includes('forbidden') ||
		message.includes('security')
	) {
		return {
			status: ExecutionStatus.SECURITY_VIOLATION,
			code: ExecutionErrorCode.SECURITY_VIOLATION,
			retryable: false,
			suggestion: 'Remove forbidden operations or use allowed APIs',
		};
	}

	if (message.includes('syntaxerror') || message.includes('unexpected token')) {
		return {
			status: ExecutionStatus.PARSE_ERROR,
			code: ExecutionErrorCode.SYNTAX_ERROR,
			retryable: false,
			suggestion: 'Check code syntax and fix any errors',
		};
	}

	if (message.includes('typeerror') || message.includes('is not a function')) {
		return {
			status: ExecutionStatus.FAILED,
			code: ExecutionErrorCode.TYPE_ERROR,
			retryable: false,
			suggestion: 'Check types and ensure methods are called correctly',
		};
	}

	if (message.includes('referenceerror') || message.includes('is not defined')) {
		return {
			status: ExecutionStatus.FAILED,
			code: ExecutionErrorCode.REFERENCE_ERROR,
			retryable: false,
			suggestion: 'Check variable names and ensure all are defined before use',
		};
	}

	if (
		message.includes('network') ||
		message.includes('fetch') ||
		message.includes('econnrefused')
	) {
		return {
			status: ExecutionStatus.NETWORK_ERROR,
			code: ExecutionErrorCode.NETWORK_ERROR,
			retryable: true,
			suggestion: 'Check network connectivity and try again',
		};
	}

	if (message.includes('loop') || message.includes('infinite')) {
		return {
			status: ExecutionStatus.LOOP_DETECTED,
			code: ExecutionErrorCode.INFINITE_LOOP_DETECTED,
			retryable: false,
			suggestion: 'Review loops and add proper exit conditions',
		};
	}

	if (message.includes('isolate was disposed')) {
		return {
			status: ExecutionStatus.TIMEOUT,
			code: ExecutionErrorCode.TIMEOUT_ERROR,
			retryable: true,
			suggestion: 'The execution was terminated. Consider increasing timeout or optimizing code',
		};
	}

	if (message.includes('could not be cloned') || message.includes('not cloneable')) {
		return {
			status: ExecutionStatus.FAILED,
			code: ExecutionErrorCode.EXECUTION_FAILED,
			retryable: false,
			suggestion:
				'Cannot return functions or non-serializable values. Return only plain objects, arrays, primitives, or await promises before returning results.',
		};
	}

	return {
		status: ExecutionStatus.FAILED,
		code: ExecutionErrorCode.EXECUTION_FAILED,
		retryable: false,
		suggestion: 'Review error message and stack trace for details',
	};
}
