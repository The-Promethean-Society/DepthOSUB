# Testing Guide for DepthOS v5.3.0
## Verify Tool Execution Works

**Version**: 5.3.0  
**Purpose**: Validate that the tool execution fix works correctly  
**Time Required**: 15-30 minutes

---

## 🎯 Testing Objectives

1. Verify extension loads without errors
2. Confirm MCP server starts successfully
3. Test tool call parsing works
4. Validate tool execution via MCP
5. Ensure agents can complete tasks

---

## 📋 Prerequisites

- [x] Phase 1 implementation complete
- [x] Build successful (`npm run build`)
- [x] VS Code installed
- [x] OpenRouter API key configured

---

## 🚀 Testing Steps

### Step 1: Launch Extension Development Host

1. **Open VS Code** in the DepthOS Bridge directory
2. **Press F5** (or Run → Start Debugging)
3. **Wait** for Extension Development Host to open

**Expected Result**:
- New VS Code window opens
- Title bar shows "[Extension Development Host]"
- No errors in Debug Console

**If it fails**:
- Check Debug Console for errors
- Verify `dist/` directory exists
- Run `npm run build` again

---

### Step 2: Verify Extension Activation

1. **Open DepthOS Bridge panel**:
   - Click the rocket icon (🚀) in the Activity Bar
   - Or: `Cmd+Shift+P` → "DepthOS: Focus Constitutional Bridge"

2. **Check the Output Channel**:
   - View → Output
   - Select "DepthOS Bridge" from dropdown

**Expected Output**:
```
🛰 [v5.3.0] POLYPHONIC ENSEMBLE ONLINE.
🚀 Initializing Polyphonic Ensemble...
✅ MCP Connection established.
📦 Discovered [N] models on OpenRouter.
```

**If MCP connection fails**:
- Check that `dist/server.mjs` exists
- Verify OpenRouter API key is set
- Look for error messages in output

---

### Step 3: Test Simple Tool Call

**Test Command**: "List the files in the src directory"

1. **Enter command** in DepthOS chat input
2. **Send** the message
3. **Watch the output channel** for logs

**Expected Logs**:
```
🤖 [Artisan] Starting ReAct loop with model: [model-id]
📊 [Artisan] Max tokens: 4000
💭 [Artisan] Turn 1 response length: [N] chars
🔍 [ReAct] Parsed tool call: bridge_list_files
🔧 [MCP] Executing tool: bridge_list_files
📋 [MCP] Arguments: {"directory":"src"}
✅ [MCP] Tool bridge_list_files completed successfully
📄 [MCP] Result preview: Contents of src:...
✅ [Artisan] Tool bridge_list_files executed successfully
💭 [Artisan] Turn 2 response length: [N] chars
✅ [ReAct] Agent provided FINAL_ANSWER
🏁 [Artisan] Agent loop completed after [N] turns
```

**Expected UI Response**:
```
Strategist: I am convening the Ensemble. One moment...
[System]: [t1] Activating worker for: List the files in the src directory
Artisan: Thinking(Turn 1)...
Artisan: Calling tool: bridge_list_files
Artisan: Thinking(Turn 2)...
Artisan: FINAL_ANSWER: The src directory contains: [list of files]
Architect: [synthesis of results]
```

**If it fails**:
- Check for `❌` indicators in output
- Look for specific error messages
- Verify MCP server is running
- Check API key is valid

---

### Step 4: Test File Reading

**Test Command**: "Read the package.json file and tell me the project name"

**Expected Behavior**:
1. Agent parses command
2. Calls `bridge_read_file` with `filePath: "package.json"`
3. Receives file contents
4. Extracts project name
5. Provides FINAL_ANSWER

**Expected Logs**:
```
🔍 [ReAct] Parsed tool call: bridge_read_file
🔧 [MCP] Executing tool: bridge_read_file
✅ [MCP] Tool bridge_read_file completed successfully
```

**Expected Answer**:
```
FINAL_ANSWER: The project name is "depthos-bridge"
```

---

### Step 5: Test Workspace Tree

**Test Command**: "Show me the project structure"

**Expected Behavior**:
1. Agent calls `bridge_get_workspace_tree`
2. Receives tree structure
3. Formats and presents it

**Expected Logs**:
```
🔍 [ReAct] Parsed tool call: bridge_get_workspace_tree
🔧 [MCP] Executing tool: bridge_get_workspace_tree
✅ [MCP] Tool bridge_get_workspace_tree completed successfully
```

---

### Step 6: Test Web Search

**Test Command**: "Search for information about the ReAct pattern"

**Expected Behavior**:
1. Agent calls `bridge_web_search`
2. Receives search results
3. Summarizes findings

**Expected Logs**:
```
🔍 [ReAct] Parsed tool call: bridge_web_search
🔧 [MCP] Executing tool: bridge_web_search
✅ [MCP] Tool bridge_web_search completed successfully
```

---

### Step 7: Test Multi-Tool Task

**Test Command**: "Review the extension.ts file and suggest one improvement"

**Expected Behavior**:
1. Agent calls `bridge_read_file` to read extension.ts
2. Analyzes the code
3. Provides improvement suggestion
4. May call additional tools if needed

**This tests**:
- Multi-turn conversation
- Tool result processing
- Agent reasoning
- Task completion

---

## ✅ Success Criteria

### Minimum Success (Phase 1 Complete)
- [x] Extension loads without errors
- [x] MCP server connects successfully
- [ ] At least ONE tool call works
- [ ] Tool result feeds back to agent
- [ ] Agent provides FINAL_ANSWER

### Full Success (Ready for Phase 2)
- [ ] ALL basic tools work (list, read, tree, search)
- [ ] Multi-tool tasks complete successfully
- [ ] Error handling works gracefully
- [ ] Logging is clear and helpful
- [ ] No crashes or hangs

---

## 🐛 Troubleshooting

### Issue: Extension doesn't load

**Symptoms**:
- Extension Development Host opens but extension not active
- No DepthOS icon in Activity Bar

**Solutions**:
1. Check `package.json` has correct `main` field
2. Verify `dist/extension.js` exists
3. Check Debug Console for activation errors
4. Try: Developer: Reload Window

---

### Issue: MCP server doesn't start

**Symptoms**:
- Output shows "❌ Connection failed"
- No "✅ MCP Connection established" message

**Solutions**:
1. Verify `dist/server.mjs` exists
2. Check Node.js is installed
3. Look for specific error in output
4. Try running server manually: `node dist/server.mjs`

---

### Issue: Tool calls not parsed

**Symptoms**:
- Agent responds but no `🔍 [ReAct] Parsed tool call` in logs
- Agent doesn't use tools

**Solutions**:
1. Check agent's response in output
2. Verify response includes "TOOL_CALL:" and "ARGUMENTS:"
3. Model might not understand format - try better model
4. Check system prompt includes tool descriptions

---

### Issue: Tool execution fails

**Symptoms**:
- `🔧 [MCP] Executing tool` appears
- But then `❌ [MCP] Tool [name] failed`

**Solutions**:
1. Read the specific error message
2. Check tool arguments are correct
3. Verify MCP server is running
4. Test tool directly via MCP client

---

### Issue: Agent gets stuck

**Symptoms**:
- Agent keeps thinking but doesn't finish
- No FINAL_ANSWER provided
- Hits turn limit (8 turns)

**Solutions**:
1. Check if agent is receiving tool results
2. Verify tool results are being added to messages
3. Agent might need better prompt
4. Try simpler task first

---

## 📊 Test Results Template

Use this template to document your testing:

```markdown
## Test Results - DepthOS v5.3.0

**Date**: [Date]
**Tester**: [Your name]
**Environment**: VS Code [version] on [OS]

### Test 1: Extension Load
- Status: [ ] Pass [ ] Fail
- Notes: 

### Test 2: MCP Connection
- Status: [ ] Pass [ ] Fail
- Notes:

### Test 3: List Files
- Status: [ ] Pass [ ] Fail
- Tool called: [ ] Yes [ ] No
- Tool succeeded: [ ] Yes [ ] No
- Agent completed: [ ] Yes [ ] No
- Notes:

### Test 4: Read File
- Status: [ ] Pass [ ] Fail
- Notes:

### Test 5: Workspace Tree
- Status: [ ] Pass [ ] Fail
- Notes:

### Test 6: Web Search
- Status: [ ] Pass [ ] Fail
- Notes:

### Test 7: Multi-Tool Task
- Status: [ ] Pass [ ] Fail
- Tools used: 
- Notes:

### Overall Assessment
- Phase 1 Success: [ ] Yes [ ] No
- Ready for Phase 2: [ ] Yes [ ] No
- Critical Issues: 
- Minor Issues:
- Recommendations:
```

---

## 📈 Performance Benchmarks

Track these metrics during testing:

### Tool Execution
- **Tool call attempts**: [N]
- **Tool call successes**: [N]
- **Success rate**: [N%]
- **Average execution time**: [N]ms

### Task Completion
- **Tasks attempted**: [N]
- **Tasks completed**: [N]
- **Completion rate**: [N%]
- **Average turns per task**: [N]

### Error Rate
- **Total errors**: [N]
- **MCP errors**: [N]
- **Parse errors**: [N]
- **API errors**: [N]

---

## 🎯 Next Steps After Testing

### If All Tests Pass ✅
1. Document test results
2. Commit changes to git
3. Create release tag `v5.3.0`
4. Proceed to Phase 2 (Agent Prompt Enhancements)

### If Some Tests Fail ⚠️
1. Document which tests failed
2. Identify root causes
3. Fix critical issues
4. Re-test
5. Then proceed to Phase 2

### If All Tests Fail ❌
1. Review implementation
2. Check diagnostic logs
3. Verify MCP server works independently
4. Fix fundamental issues
5. Re-test from Step 1

---

## 📞 Getting Help

If you encounter issues:

1. **Check Output Channel** - Most errors show there
2. **Review Logs** - Look for `❌` indicators
3. **Read Error Messages** - They're designed to be helpful
4. **Check Documentation** - Refer to diagnostic report
5. **Test Incrementally** - Don't skip steps

---

## 🎓 What You're Testing

### Architecture
- ReAct pattern implementation
- MCP integration
- Tool call parsing
- Error handling

### Functionality
- Tool execution
- Result processing
- Agent reasoning
- Task completion

### Quality
- Logging clarity
- Error messages
- Performance
- Reliability

---

## ✅ Testing Checklist

Before declaring Phase 1 complete:

- [ ] Extension loads successfully
- [ ] MCP server connects
- [ ] Tool calls are parsed from text
- [ ] Tools execute via MCP
- [ ] Results feed back to agent
- [ ] Agent completes simple tasks
- [ ] Error handling works
- [ ] Logging is comprehensive
- [ ] No critical bugs
- [ ] Performance is acceptable

---

**Ready to test?** Follow the steps above and document your results!

Good luck! 🚀
