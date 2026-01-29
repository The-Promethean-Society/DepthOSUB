// Wrapper to expose marked as a global variable in the webview
// This ensures marked.parse() is available to script.js

(function () {
    // Give the UMD module a moment to initialize
    setTimeout(function () {
        const vscode = acquireVsCodeApi();

        // Check if marked is already global
        if (typeof window.marked !== 'undefined' && window.marked.parse) {
            vscode.postMessage({
                command: 'log',
                text: '✅ marked library loaded successfully (already global)'
            });
            return;
        }

        // Try to find marked in various locations
        let markedLib = null;

        // Check if it's in a module.exports
        if (typeof module !== 'undefined' && module.exports && module.exports.parse) {
            markedLib = module.exports;
        }
        // Check if it's a global function
        else if (typeof marked !== 'undefined' && marked.parse) {
            markedLib = marked;
        }

        if (markedLib) {
            window.marked = markedLib;
            vscode.postMessage({
                command: 'log',
                text: '✅ marked library loaded successfully (exposed to window)'
            });
        } else {
            vscode.postMessage({
                command: 'log',
                text: '❌ marked library failed to load - typeof marked: ' + typeof marked + ', typeof module: ' + typeof module
            });
        }
    }, 100); // Small delay to let UMD initialize
})();

