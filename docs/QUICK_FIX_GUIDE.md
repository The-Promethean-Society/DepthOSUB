# DepthOS Quick Fix Guide
## Immediate Steps to Restore Tool Access

**Estimated Time**: 2-4 hours  
**Difficulty**: Medium  
**Impact**: HIGH - Restores basic tool functionality

---

## 🎯 Goal

Get DepthOS agents able to call at least ONE tool successfully. Once this works, expanding to all tools is straightforward.

---

## 📋 Prerequisites

- [ ] VS Code installed
- [ ] Node.js and npm installed
- [ ] DepthOS Bridge codebase cloned
- [ ] OpenRouter API key configured
- [ ] Basic TypeScript knowledge

---

## 🚀 Step-by-Step Implementation

### Step 1: Add Tool Call Parser (15 minutes)

**File**: `src/extension.ts`  
**Location**: After line 597 (after `runAgentLoop` method)

Add this new method:

```typescript
private parseToolCallsFromText(text: string): Array<{name: string, args: any}> {
    const toolCalls: Array<{name: string, args: any}> = [];
    
    // Match pattern: TOOL_CALL: tool_name\nARGUMENTS: {...}
    const regex = /TOOL_CALL:\s*(\w+)\s*\nARGUMENTS:\s*(\{[^}]+\})/g;
    let match;
    
    while ((match = regex.exec(text)) !== null) {
        try {
            toolCalls.push({
                name: match[1],
                args: JSON.parse(match[2])
            });
            outputChannel.appendLine(`🔍 Parsed tool call: ${match[1]}`);
        } catch (e) {
            outputChannel.appendLine(`⚠️ Failed to parse tool call: ${match[0]}`);
        }
    }
    
    // Also check for FINAL_ANSWER to know when to stop
    if (text.includes('FINAL_ANSWER:')) {
        outputChannel.appendLine('✅ Agent provided final answer');
    }
    
    return toolCalls;
}
```

### Step 2: Add MCP Tool Executor (15 minutes)

**File**: `src/extension.ts`  
**Location**: After the `parseToolCallsFromText` method you just added

Add this method:

```typescript
private async executeMcpTool(name: string, args: any): Promise<string> {
    if (!this._client) {
        throw new Error("MCP client not connected");
    }
    
    try {
        outputChannel.appendLine(`🔧 Executing MCP tool: ${name} with args: ${JSON.stringify(args)}`);
        
        const result = await this._client.callTool({
            name: name,
            arguments: args
        });
        
        // Extract text from MCP response
        const text = (result.content as any)[0]?.text || "No result";
        
        outputChannel.appendLine(`✅ Tool ${name} completed successfully`);
        outputChannel.appendLine(`📄 Result preview: ${text.substring(0, 100)}...`);
        
        return text;
    } catch (error: any) {
        outputChannel.appendLine(`❌ Tool ${name} failed: ${error.message}`);
        return `ERROR: ${error.message}`;
    }
}
```

### Step 3: Refactor runAgentLoop (30 minutes)

**File**: `src/extension.ts`  
**Location**: Lines 520-597

**REPLACE** the entire `runAgentLoop` method with this:

```typescript
private async runAgentLoop(
    apiKey: string, 
    model: string, 
    agentRole: string, 
    prompt: string, 
    provider: DepthOSViewProvider, 
    systemPrompt?: string, 
    logger?: (agent: string, msg: string) => void, 
    maxTokens?: number
): Promise<string> {
    
    // Enhanced system prompt with ReAct instructions
    const toolDescriptions = `
Available Tools:
- bridge_list_files(directory: string): List files in a directory
- bridge_read_file(filePath: string): Read file contents  
- bridge_write_file(filePath: string, content: string): Write to a file
- bridge_execute_command(command: string, context: string): Run a shell command
- bridge_get_workspace_tree(depth: number): Get project structure
- bridge_web_search(query: string): Search the web

To use a tool, output:
TOOL_CALL: tool_name
ARGUMENTS: {"arg1": "value1", "arg2": "value2"}

You will receive:
TOOL_RESULT: [result text]

When you have completed your task, output:
FINAL_ANSWER: Your final response
`;

    const enhancedSystemPrompt = `${systemPrompt || `You are the ${agentRole}.`}

${toolDescriptions}

Remember: Think step by step, use tools when needed, and provide a FINAL_ANSWER when done.`;

    let messages = [
        { role: "system", content: enhancedSystemPrompt },
        { role: "user", content: prompt }
    ];

    let finalResponse = "";
    const config = vscode.workspace.getConfiguration('depthos-bridge');
    const globalMax = config.get<number>('maxTokensPerRequest') || 4000;
    const tokensToRequest = maxTokens || globalMax;

    // ReAct Loop
    for (let turn = 0; turn < 5; turn++) {
        if (logger) logger(agentRole, `Thinking(Turn ${turn + 1})...`);

        // Call OpenRouter WITHOUT tools array
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: model,
                messages: messages,
                max_tokens: tokensToRequest
                // ✅ NO tools array - this is the key fix!
            })
        });

        if (!response.ok) {
            return `API Error: ${response.statusText}`;
        }

        const data: any = await response.json();
        const messageContent = data.choices[0].message.content;

        if (!messageContent) {
            outputChannel.appendLine('⚠️ Empty response from model');
            break;
        }

        finalResponse += messageContent + "\n";
        
        if (logger) {
            const preview = messageContent.substring(0, 150);
            logger(agentRole, preview + (messageContent.length > 150 ? "..." : ""));
        }

        // Check if agent is done
        if (messageContent.includes('FINAL_ANSWER:')) {
            outputChannel.appendLine('✅ Agent completed task');
            break;
        }

        // Parse tool calls from text
        const toolCalls = this.parseToolCallsFromText(messageContent);

        if (toolCalls.length === 0) {
            // No tool calls and no final answer - agent might be stuck
            outputChannel.appendLine('⚠️ No tool calls found, prompting agent to continue');
            messages.push({ role: "assistant", content: messageContent });
            messages.push({ 
                role: "user", 
                content: "Please continue. Use tools if needed or provide your FINAL_ANSWER." 
            });
            continue;
        }

        // Add agent's message to history
        messages.push({ role: "assistant", content: messageContent });

        // Execute each tool call
        for (const toolCall of toolCalls) {
            if (logger) logger(agentRole, `Calling tool: ${toolCall.name}`);

            // Ratification check
            await this.interceptToolCall(toolCall.name, toolCall.args, `tool-${turn}`, provider);

            // Execute via MCP
            const result = await this.executeMcpTool(toolCall.name, toolCall.args);

            // Add result to conversation
            messages.push({
                role: "user",
                content: `TOOL_RESULT: ${result}`
            });
        }
    }

    return finalResponse;
}
```

### Step 4: Test with Simple Command (10 minutes)

**Action**: Rebuild and test

```bash
cd /Users/officeone/depthos-bridge
npm run build
```

Then in VS Code:
1. Press `F5` to launch extension development host
2. Open DepthOS Bridge panel
3. Send a simple test message: "List the files in the current directory"

**Expected Output**:
```
Strategist: I am convening the Ensemble. One moment...
[System]: [t1] Activating worker for: List the files in the current directory
Artisan: Thinking(Turn 1)...
Artisan: Calling tool: bridge_list_files
✅ Tool bridge_list_files completed
Artisan: Thinking(Turn 2)...
Artisan: FINAL_ANSWER: The current directory contains: [list of files]
Architect: [synthesis of results]
```

### Step 5: Verify in Output Channel (5 minutes)

Open the "DepthOS Bridge" output channel in VS Code and look for:

✅ **Success indicators**:
```
🔍 Parsed tool call: bridge_list_files
🔧 Executing MCP tool: bridge_list_files with args: {"directory":"."}
✅ Tool bridge_list_files completed successfully
```

❌ **Failure indicators**:
```
❌ Tool bridge_list_files failed: [error message]
⚠️ Failed to parse tool call
```

---

## 🐛 Troubleshooting

### Issue: "MCP client not connected"

**Solution**: Check that the MCP server started successfully

```typescript
// In activate() function, verify this runs:
mcpManager.start();
```

Look for in output:
```
✅ MCP Connection established.
```

### Issue: "No tool calls found"

**Possible causes**:
1. Model doesn't understand the format
2. System prompt wasn't included properly
3. Model is too weak (try a better model)

**Solution**: Check the system prompt includes the tool descriptions and format instructions.

### Issue: "Tool execution fails"

**Solution**: Test the MCP server directly

Add this test command to your extension:

```typescript
// In resolveWebviewView, add a test case:
case 'testMcp':
    const testResult = await this._mcpManager._client?.callTool({
        name: 'bridge_list_files',
        arguments: { directory: '.' }
    });
    outputChannel.appendLine(`Test result: ${JSON.stringify(testResult)}`);
    break;
```

### Issue: "Payment Required" error persists

**This means**: The MCP server isn't being reached at all

**Check**:
1. Is `dist/server.mjs` being executed?
2. Is the stdio transport working?
3. Are there any errors in the extension host output?

**Debug**:
```typescript
// Add logging to start() method
outputChannel.appendLine(`Server path: ${serverScriptPath}`);
outputChannel.appendLine(`Server exists: ${fs.existsSync(serverScriptPath)}`);
```

---

## ✅ Success Criteria

You'll know the fix is working when:

1. ✅ Agent outputs `TOOL_CALL:` in response
2. ✅ Parser extracts the tool name and arguments
3. ✅ MCP executor calls the tool successfully
4. ✅ Tool result is fed back to agent
5. ✅ Agent uses the result and continues OR provides final answer
6. ✅ No "Payment Required" errors
7. ✅ Task completes successfully

---

## 📊 Testing Checklist

Test each tool individually:

- [ ] `bridge_list_files` - "List files in src directory"
- [ ] `bridge_read_file` - "Read the package.json file"
- [ ] `bridge_get_workspace_tree` - "Show me the project structure"
- [ ] `bridge_web_search` - "Search for ReAct pattern explanation"
- [ ] `bridge_write_file` - "Create a test.txt file with 'Hello World'"
- [ ] `bridge_execute_command` - "Run 'npm --version'"

---

## 🎯 Next Steps After Quick Fix

Once basic tool execution works:

1. **Expand to all agents** - Update Strategist, Sentinel, Researcher prompts
2. **Improve error handling** - Add better error messages and recovery
3. **Add parallel execution** - Run independent tools concurrently
4. **Enhance ratification** - Add risk levels and better UI
5. **Add tool result caching** - Avoid redundant calls
6. **Create comprehensive tests** - Ensure reliability

---

## 📚 Files Modified

This quick fix touches only ONE file:

- `src/extension.ts` (3 new methods, 1 refactored method)

Total lines changed: ~150 lines

---

## ⏱️ Time Breakdown

- Step 1 (Parser): 15 min
- Step 2 (Executor): 15 min  
- Step 3 (Refactor): 30 min
- Step 4 (Test): 10 min
- Step 5 (Verify): 5 min
- **Debugging**: 30-60 min (buffer)

**Total**: 2-3 hours

---

## 🎓 What You're Learning

This quick fix teaches:

1. **ReAct Pattern** - How agents reason and act iteratively
2. **MCP Integration** - How to properly use Model Context Protocol
3. **Tool Execution** - Client-side vs. server-side execution
4. **Prompt Engineering** - How to instruct models to use tools
5. **Debugging** - How to trace execution flow

---

## 💡 Pro Tips

1. **Start simple** - Test with `bridge_list_files` first
2. **Use logging** - Add `outputChannel.appendLine()` everywhere
3. **Check the output channel** - Most errors show up there
4. **Test incrementally** - Don't change everything at once
5. **Keep backups** - Git commit before making changes

---

## 🚨 Common Mistakes to Avoid

1. ❌ Forgetting to remove the `tools` array from OpenRouter call
2. ❌ Not including tool descriptions in system prompt
3. ❌ Parsing tool calls incorrectly (regex issues)
4. ❌ Not handling errors in tool execution
5. ❌ Forgetting to rebuild after changes (`npm run build`)

---

## 🎉 Success!

When you see this in your chat:

```
Artisan: I'll check the project structure.

TOOL_CALL: bridge_get_workspace_tree
ARGUMENTS: {"depth": 2}

[Tool executes successfully]

Based on the structure, I can see...

FINAL_ANSWER: The project is organized as follows: [analysis]
```

**You've done it!** DepthOS now has working tool access. 🎊

---

## 📞 Need Help?

If you get stuck:

1. Check the output channel for errors
2. Review the DIAGNOSTIC_REPORT.md for context
3. Look at ARCHITECTURE_DIAGRAMS.md to understand the flow
4. Refer to FIX_IMPLEMENTATION_PLAN.md for detailed explanations

---

**Remember**: This is a QUICK FIX to get basic functionality working. For production-ready implementation, follow the full plan in `FIX_IMPLEMENTATION_PLAN.md`.

Good luck! 🚀
