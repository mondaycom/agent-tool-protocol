// Runtime SDK Type Definitions

export interface ApprovalResponse<T = unknown> {
	approved: boolean;
	response?: T;
	timestamp: number;
}

interface SearchOptions {
  query: string;
  topK?: number;
  minSimilarity?: number;
  filter?: Record<string, unknown>;
}

interface SearchResult {
  id: string;
  text: string;
  similarity: number;
  metadata?: Record<string, unknown>;
}

interface EmbeddingRecord {
  id: string;
  text: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
}

interface LLMCallOptions {
  prompt: string;
  context?: Record<string, unknown>;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

interface LLMExtractOptions {
  prompt: string;
  context?: Record<string, unknown>;
  schema: unknown;
}

interface LLMClassifyOptions {
  text: string;
  categories: string[];
  context?: Record<string, unknown>;
}

// Runtime SDK
declare const atp: {
  /**
   * Approval API - Request explicit human approval for sensitive operations
   */
  approval: {
    /**
     * Request approval from a human
     * @param message - The message to display to the user
     * @param context - Optional context information about what needs approval
     * @returns Promise resolving to result
     */
    request(message: string, context?: Record<string, unknown>): Promise<ApprovalResponse>;

  };

  /**
   * Cache API - Store and retrieve data with optional TTL
   */
  cache: {
    /**
     * Get a value from cache by key
     * @param key - Cache key
     * @returns Promise resolving to result
     */
    get(key: string): Promise<T | null>;

    /**
     * Set a value in cache with optional TTL
     * @param key - Cache key
     * @param value - Value to cache
     * @param ttl - Time to live in seconds
     * @returns Promise resolving to result
     */
    set(key: string, value: unknown, ttl?: number): Promise<void>;

    /**
     * Delete a value from cache
     * @param key - Cache key to delete
     * @returns Promise resolving to result
     */
    delete(key: string): Promise<void>;

    /**
     * Check if a key exists in cache
     * @param key - Cache key to check
     * @returns Promise resolving to result
     */
    has(key: string): Promise<boolean>;

    /**
     * Clear all cache entries
     * @returns Promise resolving to result
     */
    clear(): Promise<void>;

  };

  /**
   * Embedding API - Client-side embedding with server-side vector storage
   */
  embedding: {
    /**
     * Request client to generate and store embeddings
     * @param input - Text(s) to embed
     * @param metadata - Optional metadata to store with embeddings
     * @returns Promise resolving to result
     */
    embed(input: string | string[], metadata?: Record<string, unknown>): Promise<string | string[]>;

    /**
     * Search stored embeddings by similarity
     * @param query - Search query text (will be embedded by client)
     * @param options - Search options (topK, minSimilarity, filter)
     * @returns Promise resolving to result
     */
    search(query: string, options?: Omit<SearchOptions, 'query'>): Promise<SearchResult[]>;

    /**
     * Calculate cosine similarity between two embedding vectors
     * @param embedding1 - First embedding vector
     * @param embedding2 - Second embedding vector
     * @returns Result value
     */
    similarity(embedding1: number[], embedding2: number[]): number;

    /**
     * Get all stored embeddings
     * @returns Result value
     */
    getAll(): EmbeddingRecord[];

    /**
     * Get count of stored embeddings
     * @returns Result value
     */
    count(): number;

  };

  /**
   * LLM API - Large Language Model calls using client-provided LLM (requires client.provideLLM())
   */
  llm: {
    /**
     * Make an LLM call with a prompt
     * @param options - LLM call options including prompt
     * @returns Promise resolving to result
     */
    call(options: LLMCallOptions): Promise<string>;

    /**
     * Extract structured data from text using an LLM
     * @param options - Extraction options with JSON schema
     * @returns Promise resolving to result
     */
    extract(options: LLMExtractOptions): Promise<T>;

    /**
     * Classify text into one of the provided categories
     * @param options - Classification options with categories
     * @returns Promise resolving to result
     */
    classify(options: LLMClassifyOptions): Promise<string>;

  };

  /**
   * Progress API - Report execution progress to clients
   */
  progress: {
    /**
     * Report progress with message and completion fraction
     * @param message - Progress message
     * @param fraction - Completion fraction (0-1)
     */
    report(message: string, fraction: number): void;

  };

};

