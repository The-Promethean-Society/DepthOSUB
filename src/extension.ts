import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fetch from "node-fetch";
import { AgnosticNode, NCPMessage, NCPResponse, NCPRequest, NodeCapability } from './interpreter/protocol.js';
import { GenericProvider } from './providers/generic.js';

let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;
let mcpManager: McpClientManager;

// --- NODAL CLUSTER REGISTRY ---

class NodeRegistry {
    private nodes: Map<string, AgnosticNode> = new Map();

    register(node: AgnosticNode) {
        this.nodes.set(node.id, node);
        outputChannel.appendLine(`🔌 Registered node: ${node.name} (${node.id})`);
    }

    getNode(id: string): AgnosticNode | undefined {
        return this.nodes.get(id);
    }

    getAllNodes(): AgnosticNode[] {
        return Array.from(this.nodes.values());
    }

    clear() {
        this.nodes.clear();
        outputChannel.appendLine(`🧹 Cluster registry cleared.`);
    }

    async discoverAll(): Promise<void> {
        for (const node of this.nodes.values()) {
            try {
                await node.discover();
            } catch (e) {
                outputChannel.appendLine(`⚠️ Error discovering node ${node.name}: ${e}`);
            }
        }
    }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const registry = new NodeRegistry();
let modelCatalog: any[] = [];

async function refreshModelCatalog(): Promise<void> {
    try {
        await registry.discoverAll();
        const allNodes = registry.getAllNodes();
        const catalog: any[] = [];
        allNodes.forEach(node => {
            node.capabilities.forEach((cap: NodeCapability) => {
                if (cap.type === 'inference') {
                    catalog.push({
                        id: cap.description,
                        name: cap.description,
                        provider: node.id,
                        context_length: (cap.metadata as any)?.context_length || 8000,
                        description: `Provided by ${node.name}`
                    });
                }
            });
        });
        modelCatalog = catalog;
        outputChannel.appendLine(`📦 Discovered total ${modelCatalog.length} inference capabilities across all nodes.`);
    } catch (e) {
        outputChannel.appendLine(`⚠️ Cluster discovery error: ${e}`);
    }
}

const nodeBlacklist = new Set<string>();

async function callModel(modelId: string, messages: any[]): Promise<string> {
    const maxFailover = 3;
    let attempts = 0;
    let currentModelId = modelId;

    while (attempts < maxFailover) {
        // Filter catalog to exclude blacklisted providers
        const activeCatalog = modelCatalog.filter(m => !nodeBlacklist.has(m.provider));

        let modelInfo = activeCatalog.find(m => m.id === currentModelId);
        let targetNode: AgnosticNode | undefined;

        if (modelInfo) {
            targetNode = registry.getNode(modelInfo.provider);
        } else {
            // Search all non-blacklisted nodes for this capability
            targetNode = registry.getAllNodes().find(n =>
                !nodeBlacklist.has(n.id) &&
                n.capabilities.some((c: NodeCapability) => c.type === 'inference' && c.description === currentModelId)
            );
        }

        if (targetNode) {
            // Safety check: Don't use Google-prefixed models on OpenRouter
            // This is the CRITICAL BLOCKER to prevent 400 errors.
            const isGoogleModel = currentModelId.startsWith('models/') ||
                currentModelId.toLowerCase().includes('gemini') ||
                currentModelId.startsWith('google/');

            if (targetNode.id === 'openrouter' && isGoogleModel) {
                outputChannel.appendLine(`⚠️ Execution Block: Invalid model ${currentModelId} for OpenRouter node. Rerouting to appropriate node...`);
                targetNode = undefined; // Force fallback search
            }
        }

        if (!targetNode) {
            // Fallback: Use any available inference node that isn't blacklisted
            // Specifically look for a node that is NOT openrouter if model is gemini,
            // or look for a node and a model that is compatible.
            const isGoogleModel = currentModelId.startsWith('models/') || currentModelId.toLowerCase().includes('gemini');

            targetNode = registry.getAllNodes().find(n => {
                if (nodeBlacklist.has(n.id)) return false;
                if (!n.capabilities.some((c: NodeCapability) => c.type === 'inference')) return false;
                // If it's a google model, don't pick openrouter
                if (isGoogleModel && n.id === 'openrouter') return false;
                return true;
            });

            if (targetNode) {
                // Find a compatible capability
                const fallbackCap = targetNode.capabilities.find((c: NodeCapability) => {
                    if (c.type !== 'inference') return false;
                    // If target is openrouter (shouldn't happen with above filter), ensure model is not gemini
                    if (targetNode!.id === 'openrouter' && (c.description.startsWith('models/') || c.description.toLowerCase().includes('gemini'))) return false;
                    return true;
                });

                if (fallbackCap) {
                    outputChannel.appendLine(`🔄 Failover: Swapping ${currentModelId} for ${fallbackCap.description} on ${targetNode.name}`);
                    currentModelId = fallbackCap.description;
                } else {
                    targetNode = undefined; // No compatible caps on this node
                }
            }
        }

        if (!targetNode) {
            if (nodeBlacklist.size > 0) {
                outputChannel.appendLine(`⚠️ Cluster Collapse imminent. Clearing blacklist for a universal retry...`);
                nodeBlacklist.clear();
                // We don't continue here to avoid infinite loops, but the next iteration will have a fresh catalog
                const freshCatalog = modelCatalog; // Already has no blacklist filter now
                targetNode = registry.getAllNodes().find(n => n.capabilities.some((c: NodeCapability) => c.type === 'inference'));
            }

            if (!targetNode) {
                throw new Error(`CRITICAL: No operational nodes remaining in cluster for model ${modelId}. All candidates blacklisted or unavailable.`);
            }
        }

        try {
            const request: NCPRequest = {
                messages: messages.map(m => ({
                    role: m.role,
                    content: m.content
                })),
                context: {
                    metadata: { modelId: currentModelId }
                }
            };

            const response = await targetNode.execute(request);
            return response.content;
        } catch (error: any) {
            if (error.message.includes('NODE_FAILURE')) {
                outputChannel.appendLine(`🚫 Blacklisting Node ${targetNode.id}: ${error.message}`);
                nodeBlacklist.add(targetNode.id);
                attempts++;
                // Try again with the next best node
                continue;
            }
            throw error;
        }
    }

    throw new Error(`Failover exhausted after ${maxFailover} attempts.`);
}

function scoreModel(model: any, role: 'strategist' | 'artisan' | 'sentinel', mode: string, minContext: number = 0, meritRequired: number = 0): number {
    let score = 0;
    const context = model.context_length || 8000;
    if (context < minContext) return -1000;

    const config = vscode.workspace.getConfiguration('depthos-bridge');
    const preferences = config.get<Record<string, number>>('modelPreferences') || {};
    for (const [key, adj] of Object.entries(preferences)) {
        if (model.id.toLowerCase().includes(key.toLowerCase())) score += adj;
    }

    if (model.id.includes(':free')) score += 1000;

    // Critical: Penalize blacklisted providers heavily
    if (nodeBlacklist.has(model.provider)) {
        score -= 10000;
    }

    const desc = (model.description + " " + model.name).toLowerCase();
    if (role === 'strategist') {
        if (desc.includes('reasoning') || desc.includes('complex')) score += 100;
    } else if (role === 'artisan') {
        if (desc.includes('code') || desc.includes('coder')) score += 200;
    }

    if (meritRequired >= 8 && !model.id.includes('claude') && !model.id.includes('gpt-4')) {
        score -= 500;
    }

    if (model.id.toLowerCase().includes('gemini') || model.id.startsWith('google/') || model.id.startsWith('models/')) {
        const isCompatibleProvider = model.provider === 'google' || model.provider === 'ollama';
        if (model.provider === 'openrouter' || !isCompatibleProvider) {
            score -= 1000000; // Absolute block
        }
    }

    return score;
}

async function getEnsembleModels(mode: string = 'meritocratic', minContext: number = 8000, meritRequired: number = 0): Promise<Record<string, string>> {
    if (modelCatalog.length === 0) await refreshModelCatalog();

    const select = (role: 'strategist' | 'artisan' | 'sentinel', reqContext: number) => {
        const sorted = [...modelCatalog]
            .filter(m => !nodeBlacklist.has(m.provider))
            .sort((a, b) => scoreModel(b, role, mode, reqContext, meritRequired) - scoreModel(a, role, mode, reqContext, meritRequired));
        return sorted[0]?.id || "google/gemma-2-9b-it:free";
    };

    return {
        strategist: select('strategist', minContext),
        artisan: select('artisan', minContext),
        sentinel: select('sentinel', 8000),
        researcher: select('strategist', 32000)
    };
}

// --- EXTENSION ACTIVATION ---

export function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel('DepthOS Bridge');
    outputChannel.appendLine('🛰 [v5.3.2] AGNOSTIC CORE ONLINE.');

    mcpManager = new McpClientManager(context);
    const provider = new DepthOSViewProvider(context.extensionUri, mcpManager);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(DepthOSViewProvider.viewType, provider, {
            webviewOptions: { retainContextWhenHidden: true }
        })
    );

    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'depthos-bridge.focus';
    statusBarItem.text = '$(hubot) DepthOS Ensemble';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    context.subscriptions.push(
        vscode.commands.registerCommand('depthos-bridge.focus', () => {
            vscode.commands.executeCommand('workbench.view.extension.depthos-bridge-container');
        }),
        vscode.commands.registerCommand('depthos-bridge.start', () => {
            mcpManager.start();
        }),
        vscode.commands.registerCommand('depthos-bridge.openCanvas', () => {
            VisualCanvasPanel.createOrShow(context.extensionUri, mcpManager);
        })
    );
}

// --- VISUAL EXECUTION CANVAS PANEL ---

class VisualCanvasPanel {
    public static currentPanel: VisualCanvasPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    public static createOrShow(extensionUri: vscode.Uri, mcpManager: McpClientManager) {
        const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;

        if (VisualCanvasPanel.currentPanel) {
            VisualCanvasPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'depthosVisualCanvas',
            'DepthOS Visual Canvas',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'src', 'webview')]
            }
        );

        VisualCanvasPanel.currentPanel = new VisualCanvasPanel(panel, extensionUri, mcpManager);
    }

    public static reconstruct(mcpManager: McpClientManager) {
        if (VisualCanvasPanel.currentPanel) {
            VisualCanvasPanel.currentPanel.postMessage({ type: 'updateStatus', text: '🌌 RECONSTRUCTING...' });
            const provider = mcpManager.getProvider();
            if (provider) {
                mcpManager.queryEnsemble("Analyze the current project and reconstruct its visual layout on the canvas. Add components for main modules, UI sections, and architectural layers.", provider);
            }
        }
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, mcpManager: McpClientManager) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        this._update();
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'log':
                        outputChannel.appendLine(`🎨 [Canvas] ${message.text}`);
                        break;
                    case 'reconstruct':
                        VisualCanvasPanel.reconstruct(mcpManager);
                        break;
                    case 'canvasUpdate':
                        // Handle visual drag-and-drop updates back to code
                        outputChannel.appendLine(`✨ Canvas Update: ${JSON.stringify(message.data)}`);
                        // Here we would trigger an agent to update the corresponding code file
                        break;
                }
            },
            null,
            this._disposables
        );

        // Notify MCP Manager of the new canvas
        mcpManager.registerCanvas(this);
    }

    public postMessage(message: any) {
        this._panel.webview.postMessage(message);
    }

    public dispose() {
        VisualCanvasPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) x.dispose();
        }
    }

    private _update() {
        this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'canvas-script.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'canvas-style.css'));
        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource}; font-src ${webview.cspSource} https:; connect-src ${webview.cspSource} https:;">
    <title>DepthOS Visual Canvas</title>
    <link rel="stylesheet" href="${styleUri}">
</head>
<body>
    <div id="canvas-container">
        <div id="canvas-header">
            <div class="canvas-title">SPATIAL BUILDER</div>
            <div style="display: flex; gap: 10px; align-items: center;">
                <button id="reconstruct-btn" style="background: var(--accent); color: white; border: none; padding: 4px 10px; border-radius: 4px; font-size: 0.7rem; cursor: pointer;">RECONSTRUCT</button>
                <div class="canvas-status" id="canvas-status">READY</div>
            </div>
        </div>
        <div id="canvas-board" class="canvas-board">
            <div class="empty-state">Drag components here or use the Sidebar to prompt...</div>
        </div>
    </div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}

// --- MCP CLIENT MANAGER (THE ORCHESTRATOR) ---

class McpClientManager implements AgnosticNode {
    private _client: Client | null = null;
    private _process: ChildProcess | null = null;
    private _onStatusChange = new vscode.EventEmitter<string>();
    public readonly onStatusChange = this._onStatusChange.event;
    private _pendingRatification: ((approved: boolean) => void) | null = null;
    private _canvas: VisualCanvasPanel | undefined;
    private _nativeTerminal: vscode.Terminal | null = null;

    public readonly id = "mcp-core";
    public readonly name = "MCP Core Tools";
    public capabilities: NodeCapability[] = [];

    constructor(private readonly _context: vscode.ExtensionContext) { }

    public async start() {
        if (this._process) return;

        const config = vscode.workspace.getConfiguration('depthos-bridge');
        const openRouterKey = config.get<string>('openRouterApiKey') || "";
        const googleKey = config.get<string>('googleAiApiKey') || "";
        const groqKey = config.get<string>('groqApiKey') || "";
        const ollamaUrl = config.get<string>('ollamaUrl') || 'http://localhost:11434';
        const customProviders = config.get<any[]>('customProviders') || [];

        registry.clear();
        if (openRouterKey) registry.register(new GenericProvider('openrouter', 'OpenRouter', 'https://openrouter.ai/api/v1', openRouterKey));
        if (googleKey) registry.register(new GenericProvider('google', 'Google AI Studio', 'https://generativelanguage.googleapis.com/v1beta/openai', googleKey));
        if (groqKey) registry.register(new GenericProvider('groq', 'Groq', 'https://api.groq.com/openai/v1', groqKey));
        if (ollamaUrl) registry.register(new GenericProvider('ollama', 'Ollama (Local)', ollamaUrl, ""));

        customProviders.forEach((p: any) => registry.register(new GenericProvider(p.id, p.name, p.url, p.key)));

        // Re-register self if already connected
        if (this._client) registry.register(this);

        await refreshModelCatalog();

        outputChannel.appendLine('🚀 Initializing Polyphonic Ensemble...');
        this._onStatusChange.fire('SYNERGIZING');

        if (this._client) {
            this._onStatusChange.fire('ACTIVE');
            await this.discover();
            return;
        }

        const serverScriptPath = path.join(this._context.extensionPath, 'dist', 'server.mjs');
        const transport = new StdioClientTransport({
            command: 'node',
            args: [serverScriptPath],
            env: { ...process.env, OPENROUTER_API_KEY: openRouterKey }
        });

        this._client = new Client({ name: "DepthOS Extension", version: "5.3.2" }, { capabilities: {} });

        try {
            await this._client.connect(transport);
            outputChannel.appendLine('✅ MCP Connection established.');
            this._onStatusChange.fire('ACTIVE');
            registry.register(this);
            await this.discover();
        } catch (error: any) {
            outputChannel.appendLine(`❌ Connection failed: ${error}`);
            this._onStatusChange.fire('DORMANT');
            this.stop();
        }
    }

    public async discover(): Promise<void> {
        if (!this._client) return;
        try {
            const result = await this._client.listTools();
            this.capabilities = result.tools.map(t => ({
                type: 'tool',
                description: t.name,
                schema: t.inputSchema,
                metadata: { description: t.description }
            }));
            outputChannel.appendLine(`🛠 Discovered ${this.capabilities.length} tools via MCP.`);
        } catch (e) {
            outputChannel.appendLine(`⚠️ tool discovery error: ${e}`);
        }
    }

    public async execute(request: NCPRequest): Promise<NCPResponse> {
        if (!this._client) throw new Error("MCP Client not initialized.");
        const toolName = request.context?.metadata?.toolName;
        const args = request.context?.metadata?.args;

        if (toolName) {
            outputChannel.appendLine(`🔧 Executing tool: ${toolName}`);
            const result = await this._client.callTool({ name: toolName, arguments: args });
            return {
                content: JSON.stringify(result.content),
                metadata: { isToolResult: true, toolName }
            };
        }
        throw new Error("McpClientManager currently only handles tool execution nodes.");
    }

    public stop() {
        if (this._process) {
            this._process.kill();
            this._process = null;
        }
        this._client = null;
        this._onStatusChange.fire('DORMANT');
    }

    public resolveRatification(approved: boolean) {
        if (this._pendingRatification) {
            this._pendingRatification(approved);
            this._pendingRatification = null;
        }
    }

    public registerCanvas(canvas: VisualCanvasPanel) {
        this._canvas = canvas;
        outputChannel.appendLine(`🎨 Visual Canvas registered with Orchestrator.`);
    }

    public postToCanvas(message: any) {
        if (this._canvas) {
            this._canvas.postMessage(message);
        }
    }

    public getProvider(): DepthOSViewProvider | undefined {
        return (this as any)._view; // Hacky but works for now as provider is registered elsewhere
    }

    public async testOpenRouterConnection() {
        const config = vscode.workspace.getConfiguration('depthos-bridge');
        const apiKey = config.get<string>('openRouterApiKey');
        if (!apiKey) {
            vscode.window.showErrorMessage('DepthOS: No API key configured');
            return;
        }
        try {
            const response = await fetch("https://openrouter.ai/api/v1/models", {
                method: "GET",
                headers: { "Authorization": `Bearer ${apiKey}` }
            });
            if (response.ok) {
                vscode.window.showInformationMessage('✅ DepthOS: OpenRouter connection successful!');
            } else {
                vscode.window.showErrorMessage(`❌ DepthOS: API Error (${response.status})`);
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`❌ DepthOS: Network error - ${error.message}`);
        }
    }

    private async getIdeContext() {
        const editor = vscode.window.activeTextEditor;
        let diagnostics: vscode.Diagnostic[] = [];
        if (editor) diagnostics = vscode.languages.getDiagnostics(editor.document.uri);

        return {
            currentFile: editor?.document.uri.fsPath || "None",
            visibleText: (editor && editor.visibleRanges && editor.visibleRanges.length > 0) ? editor.document.getText(editor.visibleRanges[0]) : "None",
            problems: diagnostics
                .filter(d => d.severity === vscode.DiagnosticSeverity.Error)
                .map(d => `Line ${d.range.start.line}: ${d.message}`)
                .slice(0, 5)
        };
    }

    public async queryEnsemble(userPrompt: string, provider: DepthOSViewProvider, attachments: any[] = [], history: any[] = []) {
        if (!this._client) {
            provider.postMessageToWebview({ type: 'response', text: "[VETO]: Bridge not initialized." });
            return;
        }

        const config = vscode.workspace.getConfiguration('depthos-bridge');
        const postToChat = (agent: string, msg: string) => provider.postMessageToWebview({ type: 'response', text: `**${agent}**: ${msg}` });
        const postStatus = (agent: string | null) => provider.postMessageToWebview({ type: 'agency-status', agent: agent });
        const postToThinking = (agent: string, msg: string) => provider.postMessageToWebview({ type: 'agency-log', agent: agent, text: msg });

        try {
            this._onStatusChange.fire('SYNERGIZING');
            postToChat("Strategist", "I am convening the Ensemble. One moment...");
            postStatus("Strategist");

            const ideContext = await this.getIdeContext();
            const mode = config.get<string>('orchestrationMode') || 'meritocratic';
            const promptSize = (JSON.stringify(ideContext).length + userPrompt.length) / 3;

            const initialMerit = mode === 'meritocratic' ? 10 : 0;
            const models = await getEnsembleModels(mode, promptSize, initialMerit);

            const strategistAgent = {
                name: "Architect",
                role: "Strategist",
                systemPrompt: `You are the Lead Architect of the DepthOS Bridge. 
Coordinate squads (Artisans, Sentinels, Researchers). 
You MUST provide a clear plan using this JSON Schema: { "messageToUser": "...", "tasks": [{ "id": "t1", "agentType": "...", "instruction": "...", "dependsOn": [] }] }
Available Agent Types: Artisan (Execution), Sentinel (Verification), Researcher (Knowledge).
VISUAL CANVAS: A spatial builder is available in the center panel. To update it, an Artisan can use TOOL_CALL: bridge_execute_command with a "canvas_update" context.
CRITICAL: Do not claim a task is "executed" until you have the TOOL_RESULT. Talking about a command is NOT running it.`,
                allowedTools: ["bridge_list_files", "bridge_search_files", "bridge_get_workspace_tree", "bridge_get_status"]
            };

            let attachmentContext = "";
            if (attachments && attachments.length > 0) {
                attachmentContext = "\n### ATTACHED CONTEXT ###\nThe user has attached the following items for your analysis:\n";
                for (const att of attachments) {
                    try {
                        const stats = fs.statSync(att.path);
                        if (stats.isDirectory()) {
                            attachmentContext += `- [FOLDER]: ${att.path}\n`;
                        } else {
                            const ext = path.extname(att.path).toLowerCase();
                            if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
                                attachmentContext += `- [IMAGE]: ${att.path} (Visual context provided)\n`;
                                // Future: Inject base64 for multimodal models
                            } else {
                                const content = fs.readFileSync(att.path, 'utf8');
                                attachmentContext += `- [FILE]: ${att.path}\nContent:\n${content.substring(0, 5000)}${content.length > 5000 ? '\n...(truncated)' : ''}\n`;
                            }
                        }
                    } catch (e: any) {
                        attachmentContext += `- [ERROR] Could not read ${att.path}: ${e.message}\n`;
                    }
                }
            }

            const strategyPrompt = `${strategistAgent.systemPrompt}\nContext: ${JSON.stringify(ideContext)}${attachmentContext}\nUser Request: ${userPrompt}\nOutput MUST be JSON.`;

            // Prepare messages with history
            const historyContext = history.map(h => ({ role: h.role, content: h.content }));
            const strategistMessages = [
                { role: 'system', content: strategyPrompt },
                ...historyContext,
                { role: 'user', content: userPrompt }
            ];

            const strategyResponse = await callModel(models.strategist, strategistMessages);
            const jsonMatch = strategyResponse.match(/\{[\s\S]*\}/);
            const plan = jsonMatch ? JSON.parse(jsonMatch[0]) : { tasks: [] };

            if (plan.messageToUser) postToChat("Strategist", plan.messageToUser);

            const agentOutputs = new Map<string, string>();
            const completedTaskIds = new Set<string>();
            const pendingTasks = [...(plan.tasks || [])];

            while (pendingTasks.length > 0) {
                const readyTasks = pendingTasks.filter(t => !t.dependsOn || t.dependsOn.every((d: string) => completedTaskIds.has(d)));
                if (readyTasks.length === 0) break;

                for (const task of readyTasks) {
                    const agentType = task.agentType || "Artisan";
                    const taskId = task.id;

                    provider.postMessageToWebview({ type: 'status', text: `SYNERGIZING: ${agentType} is working...` });

                    let model = models.artisan;
                    let sysPrompt = "";

                    if (agentType === "Sentinel") {
                        model = models.sentinel;
                        sysPrompt = `You are the Sentinel of the DepthOS Bridge. Verify all outputs from the Artisan.`;
                    } else if (agentType === "Researcher") {
                        model = models.strategist;
                        sysPrompt = `You are the Researcher of the DepthOS Bridge. Use searches to ground tasks in truth.`;
                    } else {
                        sysPrompt = `You are the Artisan of the DepthOS Bridge. Execute terminal commands and modify files precisely. 
MANDATORY: To run a command, you MUST use TOOL_CALL: bridge_execute_command with a "command" and a "context" string. 
Do NOT simulate, imagine, or hallucinate terminal output. If you do not use the tool, nothing happens in the physical world.`;
                    }

                    const res = await this.runAgentLoop(model, agentType, task.instruction, provider, sysPrompt, postToThinking, 1000);
                    agentOutputs.set(taskId, res);
                    completedTaskIds.add(taskId);
                    pendingTasks.splice(pendingTasks.indexOf(task), 1);
                }
            }

            const internalReport = Array.from(agentOutputs.values()).join("\n\n");
            const synthesisPrompt = `The Squads have completed: \n${internalReport}\nProvide a final update to the user.`;
            const finalResponse = await callModel(models.strategist, [{ role: 'system', content: synthesisPrompt }, { role: 'user', content: userPrompt }]);
            postToChat("Architect", finalResponse);

            // Persist the assistant response
            provider.pushToHistory({ role: 'assistant', content: finalResponse });

            this._onStatusChange.fire('ACTIVE');
            postStatus(null);
        } catch (e: any) {
            postToChat("System", `[ERROR]: ${e.message}`);
            this._onStatusChange.fire('ACTIVE');
        }
    }

    private async runAgentLoop(model: string, agentRole: string, prompt: string, provider: DepthOSViewProvider, sysPrompt: string, logger: any, maxTokens: number): Promise<string> {
        const toolDescriptions = this.getToolDescriptions();
        const messages = [
            { role: "system", content: `${sysPrompt}\n\n${toolDescriptions}` },
            { role: "user", content: prompt }
        ];

        let finalResponse = "";
        for (let turn = 0; turn < 5; turn++) {
            const content = await callModel(model, messages);
            finalResponse += content + "\n";
            if (content.includes('FINAL_ANSWER:')) break;

            const toolCalls = this.parseToolCallsFromText(content);
            if (toolCalls.length === 0) {
                messages.push({ role: "assistant", content });
                messages.push({ role: "user", content: "Please continue or provide FINAL_ANSWER." });
                continue;
            }

            messages.push({ role: "assistant", content });
            for (const tc of toolCalls) {
                await this.interceptToolCall(tc.name, tc.args, `tool-${turn}`, provider);
                const result = await this.executeMcpTool(tc.name, tc.args, provider);
                messages.push({ role: "user", content: `TOOL_RESULT for ${tc.name}: ${result}` });
            }
        }
        return finalResponse;
    }

    private getToolDescriptions() {
        return `### TOOL EXECUTION PROTOCOL ###
Tools Available:
` + this.capabilities.map(c => {
            const schema = (c.metadata as any)?.inputSchema ? `\n   Args: ${JSON.stringify((c.metadata as any).inputSchema.properties)}` : "";
            return `- ${c.description}: ${c.metadata?.description}${schema}`;
        }).join("\n") +
            `\n\nCRITICAL: To execute a tool, write EXACTLY this format (with NO flavor text above or below the tool block if multiple tools are needed):\n` +
            `TOOL_CALL: tool_name\n` +
            `ARGUMENTS: {"arg1": "value", "arg2": "value"}\n\n` +
            `Example:\nTOOL_CALL: bridge_execute_command\nARGUMENTS: {"command": "ls -la", "context": "Checking files"}`;
    }

    private parseToolCallsFromText(text: string) {
        const toolCalls: any[] = [];
        // More robust regex to catch different spacings/newboarding
        const regex = /TOOL_CALL:\s*(\w+)\s*[\n\r]?\s*ARGUMENTS:\s*(\{[^}]+\})/g;
        let match;
        while ((match = regex.exec(text)) !== null) {
            try {
                const cleanedArgs = match[2].trim().replace(/\n/g, ' ');
                toolCalls.push({ name: match[1], args: JSON.parse(cleanedArgs) });
            } catch (e) {
                outputChannel.appendLine(`⚠️ Failed to parse tool arguments: ${match[2]}`);
            }
        }
        return toolCalls;
    }

    private async executeMcpTool(name: string, args: any, provider?: DepthOSViewProvider): Promise<string> {
        if (!this._client) throw new Error("MCP client not initialized.");

        if (name === 'bridge_execute_command' && provider) {
            const config = vscode.workspace.getConfiguration('depthos-bridge');
            const target = config.get<string>('terminalTarget') || 'bridge';

            const commandId = `cmd-${Date.now()}`;
            const command = args.command;
            const cwd = args.cwd || vscode.workspace.workspaceFolders?.[0].uri.fsPath;

            let resultText = "";

            // Bridge Terminal Path
            if (target === 'bridge' || target === 'both') {
                provider.postMessageToWebview({ type: 'terminal-command', id: commandId, command, cwd });
                provider.postMessageToWebview({ type: 'terminal-output', commandId, text: `⏳ Initiating Bridge Request...` });

                const result = await this._client.callTool({ name, arguments: args });
                resultText = (result.content as any[]).map(c => c.text || "").join("\n");

                provider.postMessageToWebview({ type: 'terminal-output', commandId, text: resultText });
                provider.postMessageToWebview({ type: 'terminal-complete', commandId, exitCode: result.isError ? 1 : 0 });
            }

            // Native Terminal Path
            if (target === 'native' || target === 'both') {
                if (!this._nativeTerminal) {
                    this._nativeTerminal = vscode.window.createTerminal("DepthOS Bridge Shell");
                }
                this._nativeTerminal.show(true);
                this._nativeTerminal.sendText(command);

                if (target === 'native') resultText = `Command sent to Native Terminal. Check terminal window for output.`;
            }

            return resultText;
        }

        if (name === 'bridge_canvas_action' && provider) {
            const { action, data } = args;
            if (action === 'add') {
                this.postToCanvas({ type: 'addComponent', data });
            } else if (action === 'clear') {
                this.postToCanvas({ type: 'clear' });
            } else if (action === 'update') {
                this.postToCanvas({ type: 'addComponent', data }); // Reuse add for simple updates
            }
            return `Canvas action ${action} executed successfully.`;
        }

        const result = await this._client.callTool({ name, arguments: args });
        return (result.content as any[]).map(c => c.text || "").join("\n");
    }

    public async executeTerminalCommand(command: string, provider: DepthOSViewProvider) {
        const commandId = `cmd-user-${Date.now()}`;
        const cwd = vscode.workspace.workspaceFolders?.[0].uri.fsPath;

        provider.postMessageToWebview({ type: 'terminal-command', id: commandId, command, cwd });

        try {
            // Use node's spawn directly for user commands to ensure real-time streaming
            const proc = spawn(command, { shell: true, cwd });
            const startTime = Date.now();

            proc.stdout.on('data', (data) => {
                provider.postMessageToWebview({ type: 'terminal-output', commandId, text: data.toString() });
            });

            proc.stderr.on('data', (data) => {
                provider.postMessageToWebview({ type: 'terminal-output', commandId, text: data.toString() });
            });

            proc.on('close', (code) => {
                provider.postMessageToWebview({
                    type: 'terminal-complete',
                    commandId,
                    exitCode: code,
                    duration: Date.now() - startTime
                });
            });
        } catch (error: any) {
            provider.postMessageToWebview({ type: 'terminal-error', message: error.message });
        }
    }

    private async interceptToolCall(name: string, args: any, id: string, provider: DepthOSViewProvider) {
        const config = vscode.workspace.getConfiguration('depthos-bridge');
        const scale = config.get<number>('ratificationScale', 3);
        if (scale >= 5) {
            provider.postMessageToWebview({ type: 'ratificationRequest', tool: name, args: JSON.stringify(args), id: id });
            const approved = await new Promise<boolean>(resolve => { this._pendingRatification = resolve; });
            if (!approved) throw new Error("User VETOED action.");
        }
    }
}

class DepthOSViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'depthos-bridge-view';
    private _view?: vscode.WebviewView;
    private _messageHistory: any[] = [];

    constructor(private readonly _extensionUri: vscode.Uri, private readonly _mcpManager: McpClientManager) {
        this._mcpManager.onStatusChange(status => this.postMessageToWebview({ type: 'status', text: status }));
    }

    public resolveWebviewView(webviewView: vscode.WebviewView) {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true, localResourceRoots: [this._extensionUri, vscode.Uri.joinPath(this._extensionUri, 'dist')] };
        webviewView.webview.onDidReceiveMessage(async data => {
            switch (data.command) {
                case 'start': this._mcpManager.start(); break;
                case 'query':
                    this._messageHistory.push({ role: 'user', content: data.text });
                    await this._mcpManager.queryEnsemble(data.text, this, data.attachments, this._messageHistory);
                    break;
                case 'attach': this.handleAttach(webviewView, data.uris); break;
                case 'ratify': this._mcpManager.resolveRatification(data.approved); break;
                case 'updateSetting':
                    const config = vscode.workspace.getConfiguration('depthos-bridge');
                    await config.update(data.key, data.value, vscode.ConfigurationTarget.Global);
                    if (data.key.includes('Key')) await this._mcpManager.start();
                    break;
                case 'resetCluster':
                    nodeBlacklist.clear();
                    await refreshModelCatalog();
                    this.postMessageToWebview({ type: 'status', text: 'CLUSTER RESET' });
                    break;
                case 'terminalCommand':
                    this._mcpManager.executeTerminalCommand(data.text, this);
                    break;
            }
        });
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
    }

    private async handleAttach(webviewView: vscode.WebviewView, providedUris?: string[]) {
        let uris: vscode.Uri[] | undefined;

        if (providedUris && providedUris.length > 0) {
            uris = providedUris.map(u => vscode.Uri.parse(u));
        } else {
            uris = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: true,
                canSelectMany: true,
                openLabel: 'Attach to Ensemble'
            });
        }

        if (uris && uris.length > 0) {
            const files = uris.map(uri => {
                const fsPath = uri.fsPath;
                const name = path.basename(fsPath);
                const isDir = fs.statSync(fsPath).isDirectory();
                const ext = path.extname(fsPath).toLowerCase();
                let type = isDir ? 'folder' : 'file';
                let thumbnail = undefined;

                if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
                    type = 'image';
                    thumbnail = webviewView.webview.asWebviewUri(uri).toString();
                } else if (['.mp4', '.webm', '.ogg'].includes(ext)) {
                    type = 'video';
                } else if (['.mp3', '.wav', '.m4a'].includes(ext)) {
                    type = 'audio';
                }

                return { path: fsPath, name, type, thumbnail };
            });

            this.postMessageToWebview({ type: 'attachmentSelections', files });
        }
    }

    public pushToHistory(message: { role: string, content: string }) {
        this._messageHistory.push(message);
    }

    public postMessageToWebview(message: any) {
        if (this._view) this._view.webview.postMessage(message);
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const config = vscode.workspace.getConfiguration('depthos-bridge');
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'script.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'style.css'));
        const nonce = getNonce();

        const initialSettings = {
            openRouterKey: config.get('openRouterApiKey', ''),
            googleAiKey: config.get('googleAiApiKey', ''),
            groqApiKey: config.get('groqApiKey', ''),
            ratification: config.get('ratificationScale', 3),
            orchestrationMode: config.get('orchestrationMode', 'meritocratic'),
            ollamaUrl: config.get('ollamaUrl', 'http://localhost:11434'),
            customProviders: config.get('customProviders', []),
            permCli: config.get('permissionCli', false),
            permBrowser: config.get('permissionBrowser', false),
            permAuth: config.get('permissionAuth', false),
            permFs: config.get('permissionFileSystem', false),
            terminalTarget: config.get('terminalTarget', 'bridge')
        };

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource}; font-src ${webview.cspSource} https:; connect-src ${webview.cspSource} https:;">
    <link rel="stylesheet" href="${styleUri}">
    <script nonce="${nonce}">const initialSettings = ${JSON.stringify(initialSettings)};</script>
</head>
<body>
    <div class="tabs">
        <div class="tab active" data-tab="chat">CHAT</div>
        <div class="tab" data-tab="terminal">TERMINAL</div>
        <div class="tab" data-tab="settings">SETTINGS</div>
    </div>

    <div id="chat-view" class="view active">
        <div class="header">
            <h1>BRIDGE</h1>
            <div id="status-dot" class="status-dot"></div>
        </div>
        <div class="chat-container" id="chat">
            <div class="message bridge">🌌 Agnostic Core Online. Listening to the Cluster.</div>
        </div>
        <div style="margin-top: 10px; text-align:center; display: flex; flex-direction: column; gap: 8px;">
            <button id="orchestrate">Initialize Orchestration</button>
            <button id="open-canvas" class="secondary">Open Visual Canvas</button>
        </div>
    </div>

    <div id="terminal-view" class="view">
        <div class="header">
            <h1>TERMINAL MONITOR</h1>
            <div class="terminal-controls">
                <button id="clear-terminal" class="icon-btn" title="Clear Terminal">🗑️</button>
                <button id="toggle-autoscroll" class="icon-btn active" title="Auto-scroll">📜</button>
            </div>
        </div>
        <div class="terminal-container" id="terminal-output">
            <div class="terminal-welcome">⚡ Terminal Monitor Ready</div>
        </div>
        <div class="terminal-input-row">
            <span class="terminal-prompt">$</span>
            <input type="text" id="terminal-input" placeholder="Enter manual command...">
        </div>
    </div>

    <div id="settings-view" class="view">
        <div class="settings-group">
            <div class="setting-item">
                <span class="setting-label">API Key (OpenRouter)</span>
                <input type="password" id="openRouterApiKey" value="${initialSettings.openRouterKey}" placeholder="sk-or-v1-...">
            </div>
            <div class="setting-item">
                <span class="setting-label">Google AI Key</span>
                <input type="password" id="googleAiApiKey" value="${initialSettings.googleAiKey}" placeholder="AIza...">
            </div>
            <div class="setting-item">
                <span class="setting-label">Groq API Key</span>
                <input type="password" id="groqApiKey" value="${initialSettings.groqApiKey}" placeholder="gsk_...">
            </div>
            <div class="setting-item">
                <span class="setting-label">Ollama URL</span>
                <input type="text" id="ollamaUrl" value="${initialSettings.ollamaUrl}" placeholder="http://localhost:11434">
            </div>
            
            <div class="setting-item">
                <span class="setting-label">CUSTOM NODES</span>
                <div id="custom-nodes-list" class="pref-container">
                    <!-- Nodes will be rendered here -->
                </div>
                <div class="pref-input-group" style="margin-top: 10px;">
                    <input type="text" id="node-name" placeholder="Name">
                    <input type="text" id="node-url" placeholder="Base URL">
                    <input type="password" id="node-key" placeholder="Key (optional)">
                    <button id="add-node-btn">+</button>
                </div>
            </div>

            <div class="setting-item">
                <span class="setting-label">Ratification Scale: <span id="rat-val">${initialSettings.ratification}</span></span>
                <input type="range" id="ratification-range" min="0" max="10" value="${initialSettings.ratification}">
            </div>

            <div class="setting-item">
                <span class="setting-label">Terminal Target</span>
                <select id="terminal-target" style="width: 100%; background: var(--bg-alt); color: var(--text); border: 1px solid var(--glass); padding: 4px; border-radius: 4px; margin-top: 5px;">
                    <option value="bridge" ${initialSettings.terminalTarget === 'bridge' ? 'selected' : ''}>Bridge Terminal (Isolated)</option>
                    <option value="native" ${initialSettings.terminalTarget === 'native' ? 'selected' : ''}>Native Terminal (Visible)</option>
                    <option value="both" ${initialSettings.terminalTarget === 'both' ? 'selected' : ''}>Both (Synced Output)</option>
                </select>
            </div>

            <div style="margin-top: 20px;">
                <button id="reset-cluster" class="secondary" style="width: 100%;">Reset Cluster (Clear Blacklist)</button>
            </div>
        </div>
    </div>

    <div id="attachment-preview" class="attachment-preview"></div>
    <div class="input-area">
        <button id="attach-btn" title="Attach file/folder/media">+</button>
        <input type="text" id="input" placeholder="Query ensemble...">
        <button id="ask-btn">Ask</button>
    </div>

    <div class="diagnostic">DepthOS Agnostic v5.3.2</div>

    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}
function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
