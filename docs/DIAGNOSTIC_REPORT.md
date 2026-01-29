# DepthOS Bridge - Diagnostic Report
## Issue Analysis: Tool Access Failures

### Date: 2026-01-28
### Version: 5.2.4

---

## 🔴 CRITICAL FINDING: Tool Access Mismatch

The DepthOS ensemble is experiencing **systematic tool access failures** because the MCP server tools are **not being properly exposed** to the AI agents running through OpenRouter.

### Root Cause Analysis

#### 1. **Architecture Mismatch**
The current implementation has a fundamental disconnect:

- **MCP Server (`src/server.ts`)**: Defines tools like:
  - `bridge_list_files`
  - `bridge_read_file`
  - `bridge_write_file`
  - `bridge_execute_command`
  - `bridge_get_workspace_tree`
  - `bridge_web_search`

- **Extension (`src/extension.ts`)**: Calls OpenRouter API directly with hardcoded tool definitions in `runAgentLoop()` (lines 545-552)

**THE PROBLEM**: The agents are calling OpenRouter with tool schemas, but OpenRouter models don't have access to execute these tools. The MCP server tools are only accessible via the `this._client!.callTool()` method (line 580), which requires the agent to first request the tool call through OpenRouter, then the extension intercepts it and forwards to MCP.

#### 2. **Tool Call Flow is Broken**

Current flow:
```
User Request 
  → Extension calls OpenRouter with tool schemas
  → OpenRouter model generates tool_calls in response
  → Extension tries to execute via MCP client
  → ❌ FAILS because OpenRouter models can't actually "see" or "use" the tools
```

What's happening in the error logs:
- **Researcher**: Calls `bridge_get_workspace_tree` → Returns "Payment Required" error
- **Researcher**: Calls `bridge_list_files` → Returns error
- **Researcher**: Calls `bridge_web_search` → Returns error
- **Sentinel & Artisan**: Unable to complete assessments due to "API limitations"

#### 3. **The "Payment Required" Error**

This error suggests one of two things:
1. The OpenRouter API key has insufficient credits
2. The model being selected is hitting rate limits or quota issues

However, the real issue is that **the tools aren't being properly bridged** between OpenRouter and the MCP server.

---

## 🎯 The Core Problem

**DepthOS is NOT using Antigravity's native tools.** Instead, it's trying to:
1. Define its own tool schemas
2. Send them to OpenRouter models
3. Hope the models can execute them (they can't)

### What Should Happen

DepthOS should be leveraging the **MCP (Model Context Protocol)** architecture properly:

1. **MCP Server** should expose tools to the **MCP Client**
2. **MCP Client** (in the extension) should make these tools available to agents
3. **Agents should call MCP tools directly**, not through OpenRouter's function calling

---

## 🔧 Required Fixes

### Fix 1: Proper MCP Tool Integration

The `runAgentLoop` method needs to be refactored to:
- NOT send tool schemas to OpenRouter
- Instead, use a **ReAct-style prompting** approach where the agent outputs tool calls as text
- Parse the agent's text output for tool call requests
- Execute tools via MCP client
- Feed results back to the agent

### Fix 2: Remove OpenRouter Function Calling

OpenRouter's function calling feature is designed for models that support it natively (like GPT-4), but it doesn't give the models actual access to execute the functions. The execution still happens client-side.

**Current approach (BROKEN)**:
```typescript
// Lines 545-552 in extension.ts
tools: [
  { type: "function", function: { name: "bridge_list_files", ... } },
  // ... more tools
]
```

**Correct approach**:
```typescript
// No tools array sent to OpenRouter
// Instead, include tool descriptions in system prompt
// Parse agent's text output for tool requests
```

### Fix 3: Implement Proper Tool Execution Pipeline

```typescript
// Pseudo-code for correct implementation
async function runAgentLoop() {
  // 1. Send prompt to OpenRouter (no tools array)
  const response = await callOpenRouter(prompt);
  
  // 2. Parse response for tool call requests
  const toolCalls = parseToolCallsFromText(response.text);
  
  // 3. Execute each tool via MCP
  for (const toolCall of toolCalls) {
    const result = await this._client.callTool({
      name: toolCall.name,
      arguments: toolCall.args
    });
    
    // 4. Feed result back to agent
    prompt += `\nTool Result: ${result}`;
  }
  
  // 5. Continue loop until agent says "done"
}
```

### Fix 4: Ensure MCP Server is Running

The MCP server needs to be:
- Started when the extension activates
- Properly connected via stdio transport
- Available to handle tool calls

**Check**: Lines 184-213 in `extension.ts` show the server is started, but we need to verify it's actually running and accessible.

---

## 🚨 Why This Matters

The user's statement is correct:
> "DepthOS should have access to every tool, method, library, codebase, internet, etc... there should be nothing that Antigravity has to offer that DepthOS can't utilize"

**Currently, DepthOS has access to NONE of Antigravity's tools** because:
1. It's not running inside Antigravity's environment
2. It's a VS Code extension trying to replicate Antigravity's capabilities
3. The MCP bridge is not properly connecting the agents to the tools

---

## 💡 Recommended Solution Path

### Option A: Full MCP Integration (Recommended)
Refactor the entire agent loop to use MCP properly:
- Remove OpenRouter function calling
- Implement ReAct-style tool use
- Parse tool requests from agent text output
- Execute via MCP client

### Option B: Antigravity Native Integration
Instead of building a separate extension, integrate DepthOS directly into Antigravity as a **native ensemble mode**:
- Leverage Antigravity's existing tool infrastructure
- Use Antigravity's MCP servers
- Benefit from Antigravity's browser, terminal, and file system access
- No need to reimplement tool execution

### Option C: Hybrid Approach
Keep the VS Code extension but:
- Connect to Antigravity's MCP servers remotely
- Use Antigravity as the "execution engine"
- DepthOS becomes a "constitutional wrapper" around Antigravity

---

## 📋 Immediate Action Items

1. **Verify MCP Server Status**
   - Check if `dist/server.mjs` is being executed
   - Verify stdio transport is working
   - Test tool calls directly via MCP client

2. **Refactor Agent Loop**
   - Remove OpenRouter function calling
   - Implement text-based tool request parsing
   - Test with a single agent first

3. **Test Tool Execution**
   - Manually call each MCP tool
   - Verify they work independently
   - Ensure proper error handling

4. **Update Documentation**
   - Document the correct tool usage pattern
   - Provide examples of tool calls
   - Update vision.md with technical architecture

---

## 🎓 Educational Note

The confusion here stems from a common misunderstanding of how LLM function calling works:

- **Function calling** (like OpenRouter's implementation) is a way for models to **request** function execution
- The actual **execution** still happens client-side
- The model doesn't "have access" to the functions; it just knows how to format requests

For DepthOS to truly have access to tools, the **execution pipeline** must be properly implemented in the extension code, not just the schema definitions.

---

## 🔮 Long-term Vision Alignment

Per `docs/vision.md`, DepthOS aims to be:
- A Constitutional Guardrail
- A Universal Bridge between human and AI
- Integrated into Antigravity IDE

**Current state**: ❌ Not achieving vision due to tool access failures

**Required state**: ✅ Full tool access with constitutional oversight

**Path forward**: Implement proper MCP integration OR integrate directly into Antigravity

---

## Conclusion

The "Payment Required" and tool access errors are **not** due to API limits or subscription issues. They are **architectural failures** in how tools are being exposed and executed.

**The fix requires a fundamental refactoring of the agent loop to properly bridge MCP tools to the ensemble agents.**
