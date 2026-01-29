import fetch from 'node-fetch';
import { AgnosticNode, NCPRequest, NCPResponse, NodeCapability } from '../interpreter/protocol.js';
import { DiscoveryAgent } from '../interpreter/discovery.js';
import { ErrorInterpreter } from '../interpreter/feedback.js';

/**
 * InterpretiveNode
 * A node that uses the DiscoveryAgent to learn its protocol and 
 * uses ErrorInterpreter to self-correct during failures.
 */
export class GenericProvider implements AgnosticNode {
    public readonly id: string;
    public readonly name: string;
    public capabilities: NodeCapability[] = [];
    private baseUrl: string;
    private apiKey: string;
    private protocol: 'openai' | 'google' | 'anthropic' | 'unknown' = 'openai';
    private agent: DiscoveryAgent;
    private interpreter: ErrorInterpreter;

    constructor(id: string, name: string, baseUrl: string, apiKey: string) {
        this.id = id;
        this.name = name;
        this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
        this.apiKey = apiKey;
        this.agent = new DiscoveryAgent();
        this.interpreter = new ErrorInterpreter();
    }

    async discover(): Promise<void> {
        if (!this.baseUrl) return;
        const result = await this.agent.probe(this.baseUrl, this.apiKey);
        this.protocol = result.protocol === 'mcp' ? 'unknown' : (result.protocol as any);
        this.capabilities = result.capabilities;
    }

    async execute(request: NCPRequest): Promise<NCPResponse> {
        let attempts = 0;
        const maxAttempts = 2;

        while (attempts < maxAttempts) {
            try {
                if (this.protocol === 'google') return await this.callGoogle(request);
                return await this.callOpenAI(request);
            } catch (error: any) {
                attempts++;
                const analysis = this.interpreter.analyze(error, request);

                if (analysis.action === 'switch_protocol' && analysis.suggestedProtocol) {
                    this.protocol = analysis.suggestedProtocol;
                    continue; // Retry with new protocol
                }

                if (analysis.action === 'switch_provider') {
                    throw new Error(`NODE_FAILURE: ${analysis.reason}`);
                }

                if (analysis.action === 'retry') {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    continue;
                }

                throw error; // If we can't repair it, throw the original error
            }
        }

        throw new Error(`NODE_FAILURE: Exhausted ${maxAttempts} interpretive attempts on node ${this.name}. Node is non-functional for this request.`);
    }

    private async callOpenAI(request: NCPRequest): Promise<NCPResponse> {
        const modelId = request.context?.metadata?.modelId || (this.capabilities?.[0]?.description);
        if (!modelId) throw new Error(`No model available on node ${this.name}`);

        const response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(this.apiKey ? { "Authorization": `Bearer ${this.apiKey}` } : {})
            },
            body: JSON.stringify({
                model: modelId,
                messages: request.messages,
                max_tokens: request.constraints?.maxTokens || 4000
            })
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`${this.name} (OpenAI) API error: ${response.status} - ${error}`);
        }

        const data: any = await response.json();
        return {
            content: data.choices?.[0]?.message?.content || "",
            usage: {
                promptTokens: data.usage?.prompt_tokens || 0,
                completionTokens: data.usage?.completion_tokens || 0,
                totalTokens: data.usage?.total_tokens || 0
            }
        };
    }

    private async callGoogle(request: NCPRequest): Promise<NCPResponse> {
        const modelId = request.context?.metadata?.modelId || (this.capabilities?.[0]?.description);
        const url = `${this.baseUrl}/models/${modelId}:generateContent?key=${this.apiKey}`;

        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: request.messages.map((m: any) => ({
                    role: m.role === 'user' ? 'user' : 'model',
                    parts: [{ text: m.content }]
                }))
            })
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`${this.name} (Google) API error: ${response.status} - ${error}`);
        }

        const data: any = await response.json();
        const content = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

        return {
            content,
            metadata: { model: modelId }
        };
    }
}
