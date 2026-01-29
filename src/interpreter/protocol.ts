/**
 * Neuro-Common Protocol (NCP)
 * The internal universal language for DepthOS nodes.
 */

export type Role = 'strategist' | 'artisan' | 'sentinel' | 'researcher' | 'system' | 'user' | 'assistant';

export interface NCPMessage {
    role: Role;
    content: string;
    metadata?: Record<string, any>;
}

export interface NCPRequest {
    messages: NCPMessage[];
    constraints?: {
        maxTokens?: number;
        temperature?: number;
        stopSequences?: string[];
    };
    context?: {
        projectPath?: string;
        relevantFiles?: string[];
        metadata?: Record<string, any>;
    };
}

export interface NCPResponse {
    content: string;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    metadata?: Record<string, any>;
}

export interface NodeCapability {
    type: 'inference' | 'tool' | 'storage' | 'network';
    description: string;
    schema?: any; // Protocol specific schema (e.g. JSON Schema for tools)
    metadata?: Record<string, any>;
}

export interface AgnosticNode {
    id: string;
    name: string;
    capabilities: NodeCapability[];

    // Semantic Execution
    execute(request: NCPRequest): Promise<NCPResponse>;

    // Discovery
    discover(): Promise<void>;
}
