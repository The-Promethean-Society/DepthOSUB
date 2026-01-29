# DepthOS Bridge - Fix Implementation Plan
## Restoring Full Tool Access to Ensemble Agents

### Version: 5.2.5 (Proposed)
### Date: 2026-01-28

---

## 🎯 Objective

Enable DepthOS ensemble agents to have **full access** to all MCP tools, matching Antigravity's capabilities, with proper constitutional oversight.

---

## 📊 Current vs. Target State

### Current State ❌
- Agents receive tool schemas but cannot execute them
- OpenRouter function calling is used incorrectly
- MCP tools are defined but not accessible to agents
- "Payment Required" and API errors block all operations

### Target State ✅
- Agents can call any MCP tool successfully
- ReAct-style tool execution loop
- Proper error handling and fallbacks
- Constitutional ratification for dangerous operations
- Full parity with Antigravity's tool access

---

## 🔧 Implementation Strategy

### Phase 1: Fix Tool Execution Pipeline (CRITICAL)

#### 1.1 Refactor `runAgentLoop` Method

**File**: `src/extension.ts`
**Lines**: 520-597

**Changes Required**:

```typescript
// BEFORE (BROKEN):
private async runAgentLoop(...) {
  // Sends tools array to OpenRouter
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    body: JSON.stringify({
      model: model,
      messages: messages,
      tools: [...] // ❌ This doesn't give models actual access
    })
  });
}

// AFTER (FIXED):
private async runAgentLoop(...) {
  // Use ReAct prompting instead
  const systemPrompt = `${baseSystemPrompt}

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

After receiving results, continue your work or output:
FINAL_ANSWER: Your response to the user
`;

  // Send to OpenRouter WITHOUT tools array
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    body: JSON.stringify({
      model: model,
      messages: messages,
      // NO tools array
    })
  });
  
  // Parse response for tool calls
  const toolCalls = this.parseToolCallsFromText(response.text);
  
  // Execute each tool via MCP
  for (const toolCall of toolCalls) {
    const result = await this.executeMcpTool(toolCall.name, toolCall.args);
    messages.push({
      role: "user",
      content: `TOOL_RESULT: ${result}`
    });
  }
}
```

#### 1.2 Implement Tool Call Parser

**New Method**: `parseToolCallsFromText`

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
    } catch (e) {
      outputChannel.appendLine(`⚠️ Failed to parse tool call: ${match[0]}`);
    }
  }
  
  return toolCalls;
}
```

#### 1.3 Implement MCP Tool Executor

**New Method**: `executeMcpTool`

```typescript
private async executeMcpTool(name: string, args: any): Promise<string> {
  if (!this._client) {
    throw new Error("MCP client not connected");
  }
  
  try {
    outputChannel.appendLine(`🔧 Executing MCP tool: ${name}`);
    
    const result = await this._client.callTool({
      name: name,
      arguments: args
    });
    
    // Extract text from MCP response
    const text = (result.content as any)[0]?.text || "No result";
    
    outputChannel.appendLine(`✅ Tool ${name} completed`);
    return text;
  } catch (error: any) {
    outputChannel.appendLine(`❌ Tool ${name} failed: ${error.message}`);
    return `ERROR: ${error.message}`;
  }
}
```

---

### Phase 2: Enhance MCP Server Tools

#### 2.1 Add Missing Tools

**File**: `src/server.ts`

Add tools that Antigravity has but DepthOS doesn't:

```typescript
// Add browser automation
server.tool("bridge_browser_navigate", {
  url: z.string().describe("URL to navigate to")
}, async (args) => {
  // Implementation for browser control
});

// Add file system operations
server.tool("bridge_create_directory", {
  path: z.string().describe("Directory path to create")
}, async (args) => {
  // Implementation
});

// Add git operations
server.tool("bridge_git_status", {}, async (args) => {
  // Implementation
});

// Add package manager operations
server.tool("bridge_npm_install", {
  packages: z.array(z.string()).describe("Packages to install")
}, async (args) => {
  // Implementation
});
```

#### 2.2 Improve Error Handling

All MCP tools should return structured errors:

```typescript
try {
  // Tool logic
  return { content: [{ type: "text", text: result }] };
} catch (error: any) {
  return { 
    content: [{ 
      type: "text", 
      text: JSON.stringify({
        error: true,
        message: error.message,
        code: error.code || "UNKNOWN_ERROR"
      })
    }] 
  };
}
```

---

### Phase 3: Fix Agent Prompts

#### 3.1 Update Strategist Prompt

**File**: `src/extension.ts`
**Lines**: 333-358

```typescript
const strategistAgent = {
  name: "Architect",
  role: "Strategist",
  systemPrompt: `You are the Lead Architect of the DepthOS Construction Company.

AVAILABLE TOOLS:
${this.getToolDescriptions()}

TOOL USAGE FORMAT:
To call a tool, output:
TOOL_CALL: tool_name
ARGUMENTS: {"arg": "value"}

You will receive:
TOOL_RESULT: {...}

Then continue planning or output your final plan as JSON.

Your mission is to create a construction plan with tasks for specialized workers.

OUTPUT FORMAT:
{
  "messageToUser": "Your message to the user",
  "tasks": [
    {
      "id": "t1",
      "agentType": "Artisan" | "Sentinel" | "Researcher",
      "instruction": "Detailed task description",
      "dependsOn": [],
      "estimatedTokens": 500,
      "meritRequired": 0-10
    }
  ]
}
`
};
```

#### 3.2 Add Tool Descriptions Generator

```typescript
private getToolDescriptions(): string {
  return `
- bridge_list_files(directory: string): List all files in a directory
- bridge_read_file(filePath: string): Read the contents of a file
- bridge_write_file(filePath: string, content: string): Write content to a file
- bridge_execute_command(command: string, context: string): Execute a shell command
- bridge_get_workspace_tree(depth: number): Get the project file tree
- bridge_web_search(query: string): Search the web for information
- bridge_search_files(query: string, directory: string): Search for text in files
- bridge_get_status(lines: number): Get recent action log
`;
}
```

---

### Phase 4: Constitutional Safeguards

#### 4.1 Enhance Ratification System

**File**: `src/extension.ts`
**Lines**: 668-691

```typescript
private async interceptToolCall(
  name: string, 
  args: any, 
  id: string, 
  provider: DepthOSViewProvider
) {
  const config = vscode.workspace.getConfiguration('depthos-bridge');
  const scale = config.get<number>('ratificationScale', 3);
  
  // Define risk levels
  const riskLevels = {
    HIGH: ['bridge_execute_command', 'bridge_write_file'],
    MEDIUM: ['bridge_search_files', 'bridge_get_workspace_tree'],
    LOW: ['bridge_read_file', 'bridge_list_files', 'bridge_web_search']
  };
  
  let needsRatification = false;
  
  if (scale >= 8) {
    // Strict mode: ratify everything
    needsRatification = true;
  } else if (scale >= 4) {
    // Medium mode: ratify high and medium risk
    needsRatification = riskLevels.HIGH.includes(name) || riskLevels.MEDIUM.includes(name);
  } else if (scale >= 1) {
    // Low mode: ratify only high risk
    needsRatification = riskLevels.HIGH.includes(name);
  }
  
  if (needsRatification) {
    provider.postMessageToWebview({
      type: 'ratificationRequest',
      tool: name,
      args: JSON.stringify(args, null, 2),
      id: id,
      riskLevel: riskLevels.HIGH.includes(name) ? 'HIGH' : 
                 riskLevels.MEDIUM.includes(name) ? 'MEDIUM' : 'LOW'
    });
    
    const approved = await new Promise<boolean>(resolve => {
      this._pendingRatification = resolve;
    });
    
    if (!approved) {
      throw new Error("[VETO]: User rejected this action");
    }
  }
}
```

---

### Phase 5: Testing & Validation

#### 5.1 Create Test Suite

**New File**: `src/tests/tool-execution.test.ts`

```typescript
import * as assert from 'assert';
import { McpClientManager } from '../extension';

suite('Tool Execution Tests', () => {
  test('MCP client can list files', async () => {
    // Test implementation
  });
  
  test('MCP client can read files', async () => {
    // Test implementation
  });
  
  test('Tool call parser works correctly', async () => {
    const text = `
I need to check the files.

TOOL_CALL: bridge_list_files
ARGUMENTS: {"directory": "."}

After that, I'll analyze them.
`;
    
    const parser = new McpClientManager(context);
    const calls = parser.parseToolCallsFromText(text);
    
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].name, 'bridge_list_files');
    assert.strictEqual(calls[0].args.directory, '.');
  });
});
```

#### 5.2 Integration Test

Create a test that:
1. Starts the MCP server
2. Connects the client
3. Calls each tool
4. Verifies results

---

## 📋 Implementation Checklist

### Week 1: Core Fixes
- [ ] Implement `parseToolCallsFromText` method
- [ ] Implement `executeMcpTool` method
- [ ] Refactor `runAgentLoop` to use ReAct pattern
- [ ] Remove OpenRouter function calling
- [ ] Test with single agent (Artisan)

### Week 2: Agent Updates
- [ ] Update all agent system prompts
- [ ] Add tool descriptions to prompts
- [ ] Implement `getToolDescriptions` method
- [ ] Test with full ensemble

### Week 3: MCP Enhancements
- [ ] Add missing tools to MCP server
- [ ] Improve error handling in all tools
- [ ] Add structured error responses
- [ ] Test each tool individually

### Week 4: Safety & Polish
- [ ] Enhance ratification system
- [ ] Add risk level indicators
- [ ] Create test suite
- [ ] Run integration tests
- [ ] Update documentation

---

## 🚀 Quick Start (Immediate Fix)

For an immediate partial fix, apply this minimal change:

**File**: `src/extension.ts`, line 535

```typescript
// REMOVE the tools array from the fetch call
const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    model: model,
    messages: messages,
    max_tokens: tokensToRequest,
    // REMOVE THIS:
    // tools: [...]
  })
});
```

Then update the system prompt to include tool descriptions and ReAct instructions.

---

## 🎓 Expected Outcomes

After implementing these fixes:

1. ✅ Agents can successfully call MCP tools
2. ✅ No more "Payment Required" errors (unless actual API limits hit)
3. ✅ Full tool access matching Antigravity's capabilities
4. ✅ Constitutional oversight maintained
5. ✅ Proper error handling and user feedback
6. ✅ Ensemble can complete complex multi-step tasks

---

## 📚 Additional Resources

- [MCP Documentation](https://modelcontextprotocol.io/)
- [ReAct Pattern Paper](https://arxiv.org/abs/2210.03629)
- [OpenRouter API Docs](https://openrouter.ai/docs)

---

## 🔮 Future Enhancements

After core fixes are complete:

1. **Streaming Responses**: Show agent thinking in real-time
2. **Tool Result Caching**: Avoid redundant tool calls
3. **Parallel Tool Execution**: Run independent tools concurrently
4. **Tool Usage Analytics**: Track which tools are most effective
5. **Custom Tool Registration**: Allow users to add their own tools

---

## Conclusion

This implementation plan provides a clear path to restore full tool access to DepthOS ensemble agents. The core issue is architectural, not financial or API-related. By implementing proper ReAct-style tool execution and fixing the MCP integration, DepthOS will achieve its vision of being a true Universal Bridge with full access to all capabilities.
