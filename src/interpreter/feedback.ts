export interface FeedbackRepair {
    action: 'switch_protocol' | 'switch_provider' | 'modify_payload' | 'retry' | 'fail';
    suggestedProtocol?: 'openai' | 'google' | 'anthropic';
    modifiedPayload?: any;
    reason: string;
}

/**
 * ErrorInterpreter
 * The "Self-Correction" layer of DepthOS. Analyzes failures to evolve protocol adapters.
 */
export class ErrorInterpreter {
    constructor(private outputChannel?: { appendLine: (msg: string) => void }) { }

    public analyze(error: any, request: any): FeedbackRepair {
        const errorMsg = error.toString().toLowerCase();
        this.log(`🕵️ Analyzing failure: ${errorMsg}`);

        // 1. Detect if Google payload was sent to OpenAI or vice-versa
        if (errorMsg.includes('invalid field') || errorMsg.includes('unknown property')) {
            if (request.contents && !errorMsg.includes('google')) {
                return {
                    action: 'switch_protocol',
                    suggestedProtocol: 'openai',
                    reason: 'Payload contains "contents" (Google style) but endpoint rejected it. Trying OpenAI.'
                };
            }
            if (request.messages && errorMsg.includes('contents')) {
                return {
                    action: 'switch_protocol',
                    suggestedProtocol: 'google',
                    reason: 'Endpoint expected "contents" but got OpenAI style metadata. Trying Google.'
                };
            }
        }

        // 2. Budget, Authentication, or Sustained Outage -> Switch Provider
        if (errorMsg.includes('402') || errorMsg.includes('payment') || errorMsg.includes('budget')) {
            return {
                action: 'switch_provider',
                reason: 'Budget/Payment limit exceeded on this provider.'
            };
        }

        if (errorMsg.includes('401') || errorMsg.includes('unauthorized') || errorMsg.includes('api key')) {
            return {
                action: 'switch_provider',
                reason: 'Authentication failure or invalid API key for this provider.'
            };
        }

        // 3. Rate limits or transient errors
        if (errorMsg.includes('rate limit') || errorMsg.includes('429') || errorMsg.includes('503') || errorMsg.includes('502')) {
            return {
                action: 'retry',
                reason: 'Transient network or rate limit error detected. Retrying if possible.'
            };
        }

        return {
            action: 'fail',
            reason: `Unrecognized error pattern: ${errorMsg}`
        };
    }

    private log(msg: string) {
        if (this.outputChannel) {
            this.outputChannel.appendLine(`[ErrorInterpreter] ${msg}`);
        } else {
            console.log(`[ErrorInterpreter] ${msg}`);
        }
    }
}
