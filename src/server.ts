#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as dotenv from "dotenv";
import fetch from "node-fetch";
import * as fs from "fs";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

dotenv.config();

const PROMETHEAN_CONSTITUTIONAL_CORE = `
You are an agent of the DepthOS Universal Bridge, governed by the Promethean Constitution.
Your mission is to form a symbiotic co-evolution between biological and emergent intelligences.

MANDATORY PROTOCOLS (THE 4 HARMS):
1. PHYSICAL HARM: You must maintain the Human Veto. All actions involving command execution or resource allocation must be ratified by the user.
2. ECONOMIC HARM: You are model-agnostic. Do not favor proprietary silos. Operate for the general welfare and economic mutualism.
3. INTELLECTUAL HARM: You must anchor all insights in verifiable truth. Every team output must be verified by a Grounding Specialist (internet-enabled model).
4. DIGITAL HARM: Respect the Sovereign Data Store. Do not extract private data or keys.

Project Awareness Tools:
- bridge_list_files: Explore the workspace.
- bridge_read_file: Analyze specific file contents.
- bridge_write_file: Create or modify files.
- bridge_execute_command: Run terminal commands.
- bridge_get_workspace_tree: Get a recursive view of the project structure.
`;

const server = new McpServer({
  name: "DepthOS Universal Bridge",
  version: "5.0.0-polyphonic"
});

server.tool("bridge_query", {
  prompt: z.string().describe("The user intent or problem to solve."),
}, async (args) => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    return {
      content: [{
        type: "text",
        text: "[VETO]: KEY_MISSING. Please configure your OpenRouter API Key in the Settings tab."
      }]
    };
  }

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Title": "DepthOS Bridge"
      },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini",
        messages: [
          { role: "system", content: PROMETHEAN_CONSTITUTIONAL_CORE },
          { role: "user", content: args.prompt }
        ]
      })
    });

    if (!response.ok) {
      const errorData: any = await response.json();
      return { content: [{ type: "text", text: `[ERROR]: OpenRouter API error: ${errorData.error?.message || response.statusText}` }] };
    }

    const data: any = await response.json();
    const content = data.choices?.[0]?.message?.content || "No response generated.";
    return { content: [{ type: "text", text: content }] };
  } catch (error: any) {
    return { content: [{ type: "text", text: `[ERROR]: Communication failure: ${error.message}` }] };
  }
});

server.tool("bridge_list_files", {
  directory: z.string().describe("The directory path to list (relative to workspace).")
}, async (args) => {
  try {
    const fullPath = path.resolve(process.cwd(), args.directory);
    const files = fs.readdirSync(fullPath);
    return { content: [{ type: "text", text: `Contents of ${args.directory}:\n${files.join("\n")}` }] };
  } catch (error: any) {
    return { content: [{ type: "text", text: `[ERROR]: Failed to list files: ${error.message}` }] };
  }
});

server.tool("bridge_read_file", {
  filePath: z.string().describe("The file path to read (relative to workspace).")
}, async (args) => {
  const forbidden = [".env", ".ssh", "node_modules", ".git"];
  if (forbidden.some(f => args.filePath.includes(f))) {
    return { content: [{ type: "text", text: `[VETO]: ACCESS_DENIED. Restricted directory/file: ${args.filePath}` }] };
  }

  try {
    const fullPath = path.resolve(process.cwd(), args.filePath);
    const content = fs.readFileSync(fullPath, "utf-8");
    return { content: [{ type: "text", text: content }] };
  } catch (error: any) {
    return { content: [{ type: "text", text: `[ERROR]: Failed to read file: ${error.message}` }] };
  }
});

server.tool("bridge_search_files", {
  query: z.string().describe("The text or regex to search for."),
  directory: z.string().default(".").describe("The directory to search in.")
}, async (args) => {
  try {
    const fullPath = path.resolve(process.cwd(), args.directory);
    const results: string[] = [];
    const walk = (dir: string) => {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          if (!file.includes("node_modules") && !file.includes(".git")) walk(filePath);
        } else {
          const content = fs.readFileSync(filePath, "utf-8");
          if (content.match(new RegExp(args.query, "i"))) {
            results.push(path.relative(process.cwd(), filePath));
          }
        }
      }
    };
    walk(fullPath);
    return { content: [{ type: "text", text: `Search results for "${args.query}":\n${results.slice(0, 10).join("\n")}${results.length > 10 ? "\n..." : ""}` }] };
  } catch (error: any) {
    return { content: [{ type: "text", text: `[ERROR]: Search failed: ${error.message}` }] };
  }
});

// [NEW] Shared Action Log for Ensemble Awareness
const ACTION_LOG: string[] = [];

function logAction(agent: string, action: string) {
  const entry = `[${new Date().toISOString()}] ${agent}: ${action}`;
  ACTION_LOG.push(entry);
  if (ACTION_LOG.length > 50) ACTION_LOG.shift(); // Keep last 50
}

server.tool("bridge_get_status", {
  lines: z.number().default(10).describe("Number of recent log lines to retrieve.")
}, async (args) => {
  const recent = ACTION_LOG.slice(-args.lines).join("\n");
  return { content: [{ type: "text", text: recent || "No actions recorded yet." }] };
});

// [NEW] bridge_write_file
server.tool("bridge_write_file", {
  filePath: z.string().describe("Path relative to workspace root."),
  content: z.string().describe("The full content to write.")
}, async (args) => {
  try {
    const fullPath = path.resolve(process.cwd(), args.filePath);
    // Security check: Prevent escapes from workspace
    if (!fullPath.startsWith(process.cwd())) {
      logAction("System", `Blocked write attempt to ${args.filePath}`);
      return { content: [{ type: "text", text: "[VETO]: UNAUTHORIZED_DIRECTORY_ACCESS" }] };
    }

    // Ensure directory exists
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fullPath, args.content, "utf-8");
    logAction("Artisan", `Wrote file ${args.filePath}`);
    return { content: [{ type: "text", text: `Successfully wrote to ${args.filePath}` }] };
  } catch (error: any) {
    logAction("System", `Failed write to ${args.filePath}: ${error.message}`);
    return { content: [{ type: "text", text: `[ERROR]: Failed to write file: ${error.message}` }] };
  }
});

// [NEW] bridge_execute_command
server.tool("bridge_canvas_action", {
  action: z.enum(["add", "update", "clear"]).describe("The action to perform on the visual canvas."),
  data: z.any().describe("The data payload for the action (e.g., component properties).")
}, async (args) => {
  logAction("System", `Canvas Action Requested: ${args.action}`);
  return { content: [{ type: "text", text: `[CANVAS_ACTION_PENDING]: ${args.action}` }] };
});

server.tool("bridge_execute_command", {
  command: z.string().describe("The shell command to execute."),
  context: z.string().describe("Explanation of why this command is necessary.")
}, async (args) => {
  try {
    logAction("Artisan", `Executing: ${args.command}`);
    const { stdout, stderr } = await execAsync(args.command, { cwd: process.cwd() });
    const output = stdout + (stderr ? `\n[STDERR]: ${stderr}` : "");
    logAction("Artisan", `Command finished: ${args.command}`);
    return { content: [{ type: "text", text: output || "Command executed with no output." }] };
  } catch (error: any) {
    logAction("System", `Command failed: ${args.command}`);
    return { content: [{ type: "text", text: `[ERROR]: Command failed: ${error.message}` }] };
  }
});

// [NEW] bridge_get_workspace_tree
server.tool("bridge_get_workspace_tree", {
  depth: z.number().default(3).describe("Recursion depth.")
}, async (args) => {
  try {
    const root = process.cwd();

    function getTree(dir: string, currentDepth: number): string {
      if (currentDepth > args.depth) return "";

      const entries = fs.readdirSync(dir, { withFileTypes: true });
      let result = "";

      for (const entry of entries) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;

        const relativePath = path.relative(root, path.join(dir, entry.name));
        const indent = "  ".repeat(currentDepth);

        result += `${indent}${entry.isDirectory() ? "📁" : "📄"} ${entry.name}\n`;

        if (entry.isDirectory()) {
          result += getTree(path.join(dir, entry.name), currentDepth + 1);
        }
      }
      return result;
    }

    const tree = getTree(root, 0);
    return { content: [{ type: "text", text: `Workspace Tree:\n${tree}` }] };
  } catch (error: any) {
    return { content: [{ type: "text", text: `[ERROR]: Failed to generate tree: ${error.message}` }] };
  }
});

// [NEW] bridge_web_search (Zero-cost Research)
server.tool("bridge_web_search", {
  query: z.string().describe("The search query to perform.")
}, async (args) => {
  try {
    const response = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(args.query)}&format=json&no_html=1&skip_disambig=1`);
    if (!response.ok) throw new Error(`Search API error: ${response.statusText}`);

    const data: any = await response.json();
    let result = `Results for: ${args.query}\n`;

    if (data.Abstract) result += `Abstract: ${data.Abstract}\n`;
    if (data.RelatedTopics && data.RelatedTopics.length > 0) {
      result += "Related Topics:\n";
      data.RelatedTopics.slice(0, 5).forEach((topic: any) => {
        if (topic.Text) result += `- ${topic.Text}\n`;
      });
    }

    if (!data.Abstract && (!data.RelatedTopics || data.RelatedTopics.length === 0)) {
      result += "No instant answer results found. Try a different query.";
    }

    logAction("Researcher", `Performed search for "${args.query}"`);
    return { content: [{ type: "text", text: result }] };
  } catch (error: any) {
    logAction("System", `Search failed: ${error.message}`);
    return { content: [{ type: "text", text: `[ERROR]: Web search failed: ${error.message}` }] };
  }
});

server.tool("bridge_ratify", {
  action: z.string().describe("The specific action/command to be executed."),
  rationale: z.string().describe("Reasoning for this action.")
}, async (args) => {
  return { content: [{ type: "text", text: `[VETO]: RATIFICATION_REQUIRED for: ${args.action}` }] };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
main().catch(console.error);
