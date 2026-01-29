(function () {
    const vscode = acquireVsCodeApi();

    window.onerror = function (msg, url, line, col, error) {
        try {
            vscode.postMessage({
                command: 'log',
                text: 'WEBVIEW JS ERROR: ' + msg + ' (Line: ' + line + ', Col: ' + col + ')'
            });
        } catch (e) {
            console.error('Failed to log error to extension:', e);
        }
    };

    vscode.postMessage({ command: 'log', text: '🚀 [Webview] SCRIPT START' });

    // Simple Markdown parser (inline implementation to avoid library loading issues)
    function parseMarkdown(text) {
        console.log('🔍 parseMarkdown called, input length:', text ? text.length : 0);
        console.log('📝 First 100 chars:', text ? text.substring(0, 100) : 'empty');

        if (!text) return '';

        let html = text;

        // Escape HTML to prevent XSS
        html = html.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        // Headers (must come before bold)
        html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
        html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
        html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

        // Bold
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

        // Italic
        html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
        html = html.replace(/_(.+?)_/g, '<em>$1</em>');

        // Code blocks (must come before inline code)
        html = html.replace(/```[\s\S]*?```/g, function (match) {
            const code = match.slice(3, -3).trim();
            return '<pre><code>' + code + '</code></pre>';
        });

        // Inline code
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

        // Links
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

        // Unordered lists
        html = html.replace(/^\s*[-*+]\s+(.+)$/gim, '<li>$1</li>');
        html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');

        // Line breaks and paragraphs
        html = html.replace(/\n\n/g, '</p><p>');
        html = html.replace(/\n/g, '<br>');

        // Wrap in paragraph if not already wrapped
        if (!html.startsWith('<h') && !html.startsWith('<ul') && !html.startsWith('<pre')) {
            html = '<p>' + html + '</p>';
        }

        console.log('✅ parseMarkdown output length:', html.length);
        console.log('📤 First 100 chars of output:', html.substring(0, 100));

        return html;
    }

    const addMsg = (text, role) => {
        const m = document.createElement('div');
        m.className = 'message ' + role;
        m.innerText = text;
        const chat = document.getElementById('chat');
        chat.appendChild(m);
        chat.scrollTop = chat.scrollHeight;
        return m;
    };

    const switchTab = (tab) => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        const activeTab = Array.from(document.querySelectorAll('.tab')).find(t => t.dataset.tab === tab);
        if (activeTab) {
            activeTab.classList.add('active');
            if (tab === 'settings') {
                activeTab.classList.remove('notification');
            }
        }
        document.getElementById(tab + '-view').classList.add('active');
    };

    const updateSet = (key, value) => {
        vscode.postMessage({ command: 'log', text: 'Updating setting: ' + key });
        vscode.postMessage({ command: 'updateSetting', key, value });
    };

    // TAB CLICK HANDLERS
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    document.getElementById('orchestrate').addEventListener('click', () => {
        vscode.postMessage({ command: 'log', text: 'Start button clicked' });
        vscode.postMessage({ command: 'start' });
    });

    const openCanvasBtn = document.getElementById('open-canvas');
    if (openCanvasBtn) {
        openCanvasBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'openCanvas' });
        });
    }

    // [New] Drag and Drop Support for Chat
    const chatContainer = document.getElementById('chat');
    if (chatContainer) {
        chatContainer.addEventListener('dragover', (e) => {
            e.preventDefault();
            chatContainer.classList.add('drag-over');
            vscode.postMessage({ command: 'log', text: 'Chat: Drag Over event' });
        });

        chatContainer.addEventListener('dragleave', () => {
            chatContainer.classList.remove('drag-over');
            vscode.postMessage({ command: 'log', text: 'Chat: Drag Leave event' });
        });

        chatContainer.addEventListener('drop', (e) => {
            e.preventDefault();
            chatContainer.classList.remove('drag-over');
            vscode.postMessage({ command: 'log', text: 'Chat: Drop event detected' });

            // Try to extract VS Code URIs first (from Explorer)
            const vscodeUriList = e.dataTransfer.getData('text/uri-list');
            if (vscodeUriList) {
                vscode.postMessage({ command: 'log', text: 'Chat: URIs dropped from Explorer' });
                const uris = vscodeUriList.split('\n')
                    .map(u => u.trim())
                    .filter(u => u.length > 0);

                vscode.postMessage({ command: 'attach', uris: uris });
                return;
            }

            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                vscode.postMessage({ command: 'log', text: 'Chat: ' + e.dataTransfer.files.length + ' files dropped from Desktop' });
                vscode.postMessage({ command: 'attach' });
            }
        });
    }

    document.getElementById('ask-btn').addEventListener('click', () => {
        const input = document.getElementById('input');
        if (!input.value && pendingAttachments.length === 0) return;
        vscode.postMessage({ command: 'log', text: 'Sending query with ' + pendingAttachments.length + ' attachments' });

        addMsg(input.value, 'user');

        vscode.postMessage({
            command: 'query',
            text: input.value,
            attachments: pendingAttachments.map(a => ({ path: a.path, type: a.type }))
        });

        input.value = '';
        pendingAttachments = [];
        renderAttachmentPreview();
    });

    document.getElementById('input').addEventListener('keyup', (event) => {
        if (event.key === 'Enter') document.getElementById('ask-btn').click();
    });

    // Terminal Input
    const termInput = document.getElementById('terminal-input');
    if (termInput) {
        termInput.addEventListener('keyup', (event) => {
            if (event.key === 'Enter') {
                const command = termInput.value.trim();
                if (command) {
                    vscode.postMessage({ command: 'terminalCommand', text: command });
                    termInput.value = '';
                }
            }
        });
    }

    // SETTINGS HANDLERS
    const elOrKey = document.getElementById('openRouterApiKey');
    if (elOrKey) elOrKey.addEventListener('change', (e) => updateSet('openRouterApiKey', e.target.value));

    const elGoogleKey = document.getElementById('googleAiApiKey');
    if (elGoogleKey) elGoogleKey.addEventListener('change', (e) => updateSet('googleAiApiKey', e.target.value));

    const elGroqKey = document.getElementById('groqApiKey');
    if (elGroqKey) elGroqKey.addEventListener('change', (e) => updateSet('groqApiKey', e.target.value));

    const elRatRange = document.getElementById('ratification-range');
    if (elRatRange) {
        elRatRange.addEventListener('input', (e) => document.getElementById('rat-val').innerText = e.target.value);
        elRatRange.addEventListener('change', (e) => updateSet('ratificationScale', parseInt(e.target.value)));
    }

    const tCli = document.getElementById('perm-cli');
    if (tCli) tCli.addEventListener('change', (e) => updateSet('permissionCli', e.target.checked));
    const tBro = document.getElementById('perm-browser');
    if (tBro) tBro.addEventListener('change', (e) => updateSet('permissionBrowser', e.target.checked));
    const tAut = document.getElementById('perm-auth');
    if (tAut) tAut.addEventListener('change', (e) => updateSet('permissionAuth', e.target.checked));
    const tFs = document.getElementById('perm-fs');
    if (tFs) tFs.addEventListener('change', (e) => updateSet('permissionFileSystem', e.target.checked));

    const elMode = document.getElementById('orchestration-mode');
    if (elMode) {
        elMode.addEventListener('change', (e) => {
            updateSet('orchestrationMode', e.target.value);
            const group = document.getElementById('ollama-url-group');
            if (group) group.style.display = e.target.value === 'sovereign' ? 'flex' : 'none';
        });
    }

    const elOllama = document.getElementById('ollamaUrl');
    if (elOllama) elOllama.addEventListener('change', (e) => updateSet('ollamaUrl', e.target.value));

    const elTermTarget = document.getElementById('terminal-target');
    if (elTermTarget) elTermTarget.addEventListener('change', (e) => updateSet('terminalTarget', e.target.value));

    const btnReset = document.getElementById('reset-cluster');
    if (btnReset) {
        btnReset.addEventListener('click', () => {
            vscode.postMessage({ command: 'resetCluster' });
        });
    }

    // CONNECTIVITY TEST
    const btnTest = document.getElementById('test-connectivity');
    if (btnTest) {
        btnTest.addEventListener('click', () => {
            const statusSpan = document.getElementById('connectivity-status');
            if (statusSpan) {
                statusSpan.textContent = '⏳ Testing...';
                statusSpan.style.color = '#888';
            }
            vscode.postMessage({ command: 'testConnectivity' });
        });
    }

    // MODEL PREFERENCES UI
    const renderPreferences = (prefs) => {
        const list = document.getElementById('pref-list');
        if (!list) return;
        list.innerHTML = '';

        if (Object.keys(prefs).length === 0) {
            list.innerHTML = '<div class="empty-state">No model preferences set.</div>';
            return;
        }

        Object.entries(prefs).forEach(([key, value]) => {
            const item = document.createElement('div');
            item.className = 'pref-item';

            const label = document.createElement('span');
            label.innerText = `${key}: ${value > 0 ? '+' + value : value}`;
            label.className = value >= 0 ? 'pref-positive' : 'pref-negative';

            const btnRemove = document.createElement('button');
            btnRemove.innerText = '×';
            btnRemove.className = 'icon-btn';
            btnRemove.onclick = () => {
                const newPrefs = { ...currentPreferences };
                delete newPrefs[key];
                updatePreferences(newPrefs);
            };

            item.appendChild(label);
            item.appendChild(btnRemove);
            list.appendChild(item);
        });
    };



    let currentPreferences = {};

    // [NEW] Hydrate from initial settings if available
    if (window.initialSettings && window.initialSettings.modelPreferences) {
        currentPreferences = window.initialSettings.modelPreferences;
        renderPreferences(currentPreferences);
    }

    // Initialize from passed settings (need to expose this from extension first - managed via updateSetting for now)
    // For now, we will assume extension sends it on load or we request it.
    // Actually, let's request full settings on load.

    window.addEventListener('message', event => {
        const d = event.data;
        if (d.type === 'settings') {
            if (d.settings.modelPreferences) {
                currentPreferences = d.settings.modelPreferences;
                renderPreferences(currentPreferences);
            }
        }
    });

    const updatePreferences = (newPrefs) => {
        currentPreferences = newPrefs;
        renderPreferences(newPrefs);
        updateSet('modelPreferences', newPrefs);
    };

    const btnAddPref = document.getElementById('btn-add-pref');

    // CUSTOM NODES UI
    let currentNodes = [];
    if (window.initialSettings && window.initialSettings.customProviders) {
        currentNodes = window.initialSettings.customProviders;
    }

    const renderCustomNodes = (nodes) => {
        const list = document.getElementById('custom-nodes-list');
        if (!list) return;
        list.innerHTML = '';

        if (!nodes || nodes.length === 0) {
            list.innerHTML = '<div class="empty-state">No custom nodes added.</div>';
            return;
        }

        nodes.forEach((node, index) => {
            const item = document.createElement('div');
            item.className = 'pref-item';

            const info = document.createElement('div');
            info.style.display = 'flex';
            info.style.flexDirection = 'column';
            info.innerHTML = `
                <strong>${node.name}</strong>
                <span style="font-size: 0.7rem; opacity: 0.7;">${node.url}</span>
            `;

            const btnRemove = document.createElement('button');
            btnRemove.innerText = '×';
            btnRemove.className = 'icon-btn';
            btnRemove.onclick = () => {
                const newNodes = [...currentNodes];
                newNodes.splice(index, 1);
                updateCustomNodes(newNodes);
            };

            item.appendChild(info);
            item.appendChild(btnRemove);
            list.appendChild(item);
        });
    };

    const updateCustomNodes = (newNodes) => {
        currentNodes = newNodes;
        renderCustomNodes(newNodes);
        updateSet('customProviders', newNodes);
    };

    renderCustomNodes(currentNodes);

    const btnAddNode = document.getElementById('add-node-btn');
    if (btnAddNode) {
        btnAddNode.addEventListener('click', () => {
            const nameEl = document.getElementById('node-name');
            const urlEl = document.getElementById('node-url');
            const keyEl = document.getElementById('node-key');

            const name = nameEl.value.trim();
            const url = urlEl.value.trim();
            const key = keyEl.value.trim();

            if (name && url) {
                const newNode = {
                    id: name.toLowerCase().replace(/\s+/g, '-'),
                    name,
                    url,
                    key
                };
                const newNodes = [...currentNodes, newNode];
                updateCustomNodes(newNodes);

                nameEl.value = '';
                urlEl.value = '';
                keyEl.value = '';
            }
        });
    }
    if (btnAddPref) {
        btnAddPref.addEventListener('click', () => {
            const keyEl = document.getElementById('pref-key');
            const valEl = document.getElementById('pref-val');
            const key = keyEl.value.trim();
            const val = parseInt(valEl.value.trim());

            if (key && !isNaN(val)) {
                const newPrefs = { ...currentPreferences, [key]: val };
                updatePreferences(newPrefs);
                keyEl.value = '';
                valEl.value = '';
            }
        });
    }

    // ===== TERMINAL MONITOR FUNCTIONALITY =====
    let terminalAutoScroll = true;
    let commandCount = 0;
    let runningCommands = 0;
    const terminalHistory = [];

    const updateTerminalStats = () => {
        const statsCommands = document.getElementById('terminal-stats-commands');
        const statsRunning = document.getElementById('terminal-stats-running');
        if (statsCommands) statsCommands.textContent = `Commands: ${commandCount}`;
        if (statsRunning) statsRunning.textContent = `Running: ${runningCommands}`;
    };

    const addTerminalEntry = (type, data) => {
        const terminalOutput = document.getElementById('terminal-output');
        if (!terminalOutput) return;

        // Remove welcome message on first command
        const welcome = terminalOutput.querySelector('.terminal-welcome');
        if (welcome) welcome.remove();

        const entry = document.createElement('div');
        entry.className = `terminal-entry terminal-${type}`;
        entry.dataset.timestamp = new Date().toISOString();

        if (type === 'command') {
            commandCount++;
            runningCommands++;
            updateTerminalStats();

            const header = document.createElement('div');
            header.className = 'terminal-command-header';
            header.innerHTML = `
                <span class="terminal-prompt">$</span>
                <span class="terminal-command-text">${escapeHtml(data.command)}</span>
                <span class="terminal-status running">⏳ RUNNING</span>
            `;
            entry.appendChild(header);

            if (data.cwd) {
                const cwd = document.createElement('div');
                cwd.className = 'terminal-cwd';
                cwd.textContent = `Working Directory: ${data.cwd}`;
                entry.appendChild(cwd);
            }

            const outputContainer = document.createElement('div');
            outputContainer.className = 'terminal-output-container';
            outputContainer.dataset.commandId = data.id || `cmd-${commandCount}`;
            entry.appendChild(outputContainer);

            terminalHistory.push({
                id: data.id || `cmd-${commandCount}`,
                command: data.command,
                cwd: data.cwd,
                timestamp: new Date(),
                element: entry
            });
        } else if (type === 'output') {
            // Find the corresponding command entry
            const commandEntry = terminalOutput.querySelector(`[data-command-id="${data.commandId}"]`);
            if (commandEntry) {
                const outputLine = document.createElement('div');
                outputLine.className = 'terminal-output-line';
                outputLine.textContent = data.text;
                commandEntry.appendChild(outputLine);
            }
        } else if (type === 'complete') {
            // Update command status
            const commandEntry = terminalOutput.querySelector(`[data-command-id="${data.commandId}"]`);
            if (commandEntry) {
                const parentEntry = commandEntry.parentElement;
                const statusSpan = parentEntry.querySelector('.terminal-status');
                if (statusSpan) {
                    runningCommands = Math.max(0, runningCommands - 1);
                    updateTerminalStats();

                    if (data.exitCode === 0) {
                        statusSpan.className = 'terminal-status success';
                        statusSpan.textContent = '✅ SUCCESS';
                    } else {
                        statusSpan.className = 'terminal-status error';
                        statusSpan.textContent = `❌ EXIT ${data.exitCode}`;
                    }
                }

                // Add execution time if provided
                if (data.duration) {
                    const duration = document.createElement('div');
                    duration.className = 'terminal-duration';
                    duration.textContent = `Completed in ${data.duration}ms`;
                    commandEntry.appendChild(duration);
                }
            }
        } else if (type === 'error') {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'terminal-error';
            errorDiv.textContent = `Error: ${data.message}`;
            entry.appendChild(errorDiv);
        }

        terminalOutput.appendChild(entry);

        // Auto-scroll if enabled
        if (terminalAutoScroll) {
            terminalOutput.scrollTop = terminalOutput.scrollHeight;
        }

        return entry;
    };

    const escapeHtml = (text) => {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    };

    // Terminal controls
    const btnClearTerminal = document.getElementById('clear-terminal');
    if (btnClearTerminal) {
        btnClearTerminal.addEventListener('click', () => {
            const terminalOutput = document.getElementById('terminal-output');
            if (terminalOutput) {
                terminalOutput.innerHTML = `
                    <div class="terminal-welcome">
                        <div class="terminal-icon">⚡</div>
                        <div class="terminal-welcome-text">Terminal Cleared</div>
                        <div class="terminal-welcome-subtext">Ready for new commands</div>
                    </div>
                `;
                commandCount = 0;
                runningCommands = 0;
                terminalHistory.length = 0;
                updateTerminalStats();
            }
        });
    }

    // ===== ATTACHMENT FUNCTIONALITY =====
    let pendingAttachments = [];

    const attachBtn = document.getElementById('attach-btn');
    if (attachBtn) {
        attachBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'attach' });
        });
    }

    const renderAttachmentPreview = () => {
        const preview = document.getElementById('attachment-preview');
        if (!preview) return;
        preview.innerHTML = '';

        pendingAttachments.forEach((att, index) => {
            const chip = document.createElement('div');
            chip.className = 'attachment-chip';

            if (att.thumbnail) {
                const img = document.createElement('img');
                img.src = att.thumbnail;
                chip.appendChild(img);
            } else {
                const icon = document.createElement('span');
                icon.textContent = att.type === 'folder' ? '📁' : '📄';
                chip.appendChild(icon);
            }

            const name = document.createElement('span');
            name.textContent = att.name;
            name.style.overflow = 'hidden';
            name.style.textOverflow = 'ellipsis';
            name.style.whiteSpace = 'nowrap';
            chip.appendChild(name);

            const removeBtn = document.createElement('div');
            removeBtn.className = 'remove-btn';
            removeBtn.textContent = '×';
            removeBtn.onclick = () => {
                pendingAttachments.splice(index, 1);
                renderAttachmentPreview();
            };
            chip.appendChild(removeBtn);

            preview.appendChild(chip);
        });
    };

    const btnToggleAutoscroll = document.getElementById('toggle-autoscroll');
    if (btnToggleAutoscroll) {
        btnToggleAutoscroll.addEventListener('click', () => {
            terminalAutoScroll = !terminalAutoScroll;
            btnToggleAutoscroll.classList.toggle('active', terminalAutoScroll);
            btnToggleAutoscroll.title = terminalAutoScroll ? 'Auto-scroll: ON' : 'Auto-scroll: OFF';
        });
    }

    vscode.postMessage({ command: 'log', text: 'Webview script bootstrap started' });
    vscode.postMessage({ command: 'ready' });

    window.addEventListener('message', event => {
        const d = event.data;
        if (d.type === 'status') {
            const dot = document.getElementById('status-dot');
            dot.className = 'status-dot ' + (d.text === 'ACTIVE' ? 'active' : d.text === 'SYNERGIZING' ? 'busy' : '');
            if (d.text === 'ACTIVE') document.getElementById('orchestrate').style.display = 'none';
        }
        if (d.type === 'agency-status') {
            // Reset all
            document.querySelectorAll('.agent-indicator').forEach(el => el.classList.remove('active'));

            // Activate specific agent
            if (d.agent) {
                const target = document.querySelector(`.agent-indicator[data-agent="${d.agent}"]`);
                if (target) {
                    target.classList.add('active');
                }
            }
        }
        if (d.type === 'response') {
            console.log('📨 Response received, text length:', d.text ? d.text.length : 0);
            console.log('📨 Response text preview:', d.text ? d.text.substring(0, 150) : 'empty');

            const chatContainer = document.getElementById('chat');
            const msgDiv = document.createElement('div');
            msgDiv.className = 'message bridge';

            // Check if there's an agent prefix like "**Strategist**:" or "**Architect**:"
            // The format from extension.ts line 298 is: `**${agent}**: ${msg}`
            const match = d.text.match(/^\*\*([^*]+)\*\*:\s*([\s\S]*)$/);
            if (match) {
                console.log('✅ Agent match found:', match[1]);
                const agentName = match[1];
                const agentText = match[2];

                const label = document.createElement('span');
                label.className = 'agent-label';
                label.setAttribute('data-agent', agentName);
                label.textContent = agentName + ': ';

                const content = document.createElement('span');
                // Use our inline Markdown parser
                const parsedHtml = parseMarkdown(agentText);
                console.log('🎨 Setting innerHTML for agent content');
                content.innerHTML = parsedHtml;

                msgDiv.appendChild(label);
                msgDiv.appendChild(content);
            } else {
                console.log('❌ No agent match, parsing entire message');
                // Use our inline Markdown parser for the entire message
                const parsedHtml = parseMarkdown(d.text);
                console.log('🎨 Setting innerHTML for full message');
                msgDiv.innerHTML = parsedHtml;
            }

            chatContainer.appendChild(msgDiv);
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }
        if (d.type === 'ratificationRequest') {
            // ... handling logic ...
            vscode.postMessage({ command: 'log', text: 'Ratification request received for tool: ' + d.tool });
            const m = addMsg("⚠️ RATIFICATION REQUIRED\nTool: " + d.tool + "\nArgs: " + d.args, 'ratification');
            const div = document.createElement('div');
            div.style.marginTop = '10px';

            const appBtn = document.createElement('button');
            appBtn.innerText = 'Approve';
            appBtn.addEventListener('click', () => {
                vscode.postMessage({ command: 'log', text: 'Ratification Approved: ' + d.id });
                vscode.postMessage({ command: 'ratify', approved: true, id: d.id });
                m.remove();
            });

            const vetoBtn = document.createElement('button');
            vetoBtn.className = 'secondary';
            vetoBtn.style.marginLeft = '5px';
            vetoBtn.innerText = 'Veto';
            vetoBtn.addEventListener('click', () => {
                vscode.postMessage({ command: 'log', text: 'Ratification Vetoed: ' + d.id });
                vscode.postMessage({ command: 'ratify', approved: false, id: d.id });
                m.remove();
            });

            div.appendChild(appBtn);
            div.appendChild(vetoBtn);
            m.appendChild(div);
        }
        if (d.type === 'agency-log') {
            const content = document.getElementById('thinking-content');

            // Set notification on Settings tab if not active
            const settingsTab = document.querySelector('.tab[data-tab="settings"]');
            if (settingsTab && !settingsTab.classList.contains('active')) {
                settingsTab.classList.add('notification');
            }

            const entry = document.createElement('div');
            entry.className = 'log-entry';
            entry.setAttribute('data-agent', d.agent || 'System');
            entry.innerHTML = `<strong>[${d.agent || 'System'}]</strong>: ${d.text}`;
            content.appendChild(entry);
            content.scrollTop = content.scrollHeight;
        }
        if (d.type === 'terminal-command') {
            addTerminalEntry('command', {
                id: d.id,
                command: d.command,
                cwd: d.cwd
            });
        }
        if (d.type === 'terminal-output') {
            addTerminalEntry('output', {
                commandId: d.commandId,
                text: d.text
            });
        }
        if (d.type === 'terminal-complete') {
            addTerminalEntry('complete', {
                commandId: d.commandId,
                exitCode: d.exitCode,
                duration: d.duration
            });
        }
        if (d.type === 'terminal-error') {
            addTerminalEntry('error', {
                message: d.message
            });
        }
        if (d.type === 'attachmentSelections') {
            d.files.forEach(file => {
                if (!pendingAttachments.find(a => a.path === file.path)) {
                    pendingAttachments.push(file);
                }
            });
            renderAttachmentPreview();
        }
    });


})();
