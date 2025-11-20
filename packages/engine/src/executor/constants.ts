export const PAUSE_EXECUTION_MARKER = '__PAUSE_EXECUTION__';

export const ATP_COMPILER_ENABLED = true;

export const ATP_BATCH_SIZE_THRESHOLD = parseInt(process.env.ATP_BATCH_SIZE_THRESHOLD || '10', 10);
