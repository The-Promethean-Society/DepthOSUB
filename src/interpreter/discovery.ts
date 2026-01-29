import fetch from 'node-fetch';
import { NodeCapability } from './protocol.js';

export interface DiscoveryResult {
    protocol: 'openai' | 'anthropic' | 'google' | 'mcp' | 'unknown';
    capabilities: NodeCapability[];
    metadata: Record<string, any>;
}

/**
 * DiscoveryAgent
 * The "Senses" of DepthOS. Probes endpoints to determine their "Dialect".
 */
export class DiscoveryAgent {
    constructor(private outputChannel?: { appendLine: (msg: string) => void }) { }

    public async probe(url: string, key?: string): Promise<DiscoveryResult> {
        this.log(`🔍 Probing node at: ${url}`);

        const cleanUrl = url.endsWith('/') ? url.slice(0, -1) : url;

        // 1. Try OpenAI-compatible Discovery (/models)
        const openai = await this.tryOpenAI(cleanUrl, key);
        if (openai) return openai;

        // 2. Try Google Gemini (/v1beta/models)
        const google = await this.tryGoogle(cleanUrl, key);
        if (google) return google;

        // 3. TODO: Try MCP etc...

        this.log(`⚠️ Unknown protocol at ${url}. Falling back to 'unknown'.`);
        return {
            protocol: 'unknown',
            capabilities: [],
            metadata: { url: cleanUrl }
        };
    }

    private async tryOpenAI(url: string, key?: string): Promise<DiscoveryResult | null> {
        try {
            const res = await fetch(`${url}/models`, {
                headers: key ? { "Authorization": `Bearer ${key}` } : {}
            });
            if (res.ok) {
                const data: any = await res.json();
                if (data.data && Array.isArray(data.data)) {
                    this.log(`✅ Identified OpenAI-compatible protocol.`);
                    return {
                        protocol: 'openai',
                        capabilities: data.data.map((m: any) => ({
                            type: 'inference',
                            description: m.id.startsWith('models/') ? m.id.slice(7) : (m.id.startsWith('openai/') ? m.id.slice(7) : m.id),
                            metadata: { context_length: m.context_window || 8000 }
                        })),
                        metadata: { baseUrl: url }
                    };
                }
            }
        } catch (e) {
            // Silently fail to next probe
        }
        return null;
    }

    private async tryGoogle(url: string, key?: string): Promise<DiscoveryResult | null> {
        try {
            // Gemini typically needs a key in the URL or header
            const probeUrl = url.includes('googleapis.com') ? `${url}/models?key=${key}` : `${url}/models`;
            const res = await fetch(probeUrl);
            if (res.ok) {
                const data: any = await res.json();
                if (data.models && Array.isArray(data.models)) {
                    this.log(`✅ Identified Google Gemini protocol.`);
                    return {
                        protocol: 'google',
                        capabilities: data.models.map((m: any) => ({
                            type: 'inference',
                            description: m.name.startsWith('models/') ? m.name.slice(7) : m.name,
                            metadata: {
                                fullName: m.name,
                                inputTokenLimit: m.inputTokenLimit
                            }
                        })),
                        metadata: { baseUrl: url }
                    };
                }
            }
        } catch (e) {
            // Silently fail
        }
        return null;
    }

    private log(msg: string) {
        if (this.outputChannel) {
            this.outputChannel.appendLine(`[DiscoveryAgent] ${msg}`);
        } else {
            console.log(`[DiscoveryAgent] ${msg}`);
        }
    }
}
