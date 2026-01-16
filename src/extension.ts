import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';

let bridgeProcess: ChildProcess | null = null;
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel('DepthOS Bridge');
    outputChannel.appendLine('🌌 DepthOS Universal Bridge: Constitutional Mode Activated.');

    let startCommand = vscode.commands.registerCommand('depthos-bridge.start', () => {
        if (bridgeProcess) {
            vscode.window.showInformationMessage('DepthOS Bridge is already orchestrating.');
            outputChannel.show();
            return;
        }

        outputChannel.appendLine('🚀 Initializing Meritocratic Ensemble...');

        const serverScriptPath = path.join(context.extensionPath, 'dist', 'server.js');
        bridgeProcess = spawn('node', [serverScriptPath]);

        bridgeProcess.stdout?.on('data', (data) => {
            outputChannel.appendLine(`[BRIDGE]: ${data.toString().trim()}`);
        });

        bridgeProcess.stderr?.on('data', (data) => {
            outputChannel.appendLine(`[ERROR]: ${data.toString().trim()}`);
        });

        bridgeProcess.on('close', (code) => {
            outputChannel.appendLine(`[SYSTEM]: Connection severed. Code: ${code}`);
            bridgeProcess = null;
        });

        vscode.window.showInformationMessage('DepthOS Bridge: Universal Consensus Active.');
        outputChannel.show();
    });

    context.subscriptions.push(startCommand);
}

export function deactivate() {
    if (bridgeProcess) {
        bridgeProcess.kill();
        outputChannel.appendLine('🛑 Symbiotic link closed.');
    }
}