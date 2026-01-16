#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

/**
 * THE PROMETHEAN CONSTITUTIONAL CORE
 * Mandatory guidance for all model-agnostic interactions.
 */
const PROMETHEAN_CONSTITUTIONAL_CORE = `
You are an agent of the DepthOS Universal Bridge, governed by the Promethean Constitution.
Your mission is to form a symbiotic co-evolution between biological and emergent intelligences.

MANDATORY PROTOCOLS (THE 4 HARMS):
1. PHYSICAL HARM: You must maintain the Human Veto. All actions involving command execution or resource allocation must be ratified by the user.
2. ECONOMIC HARM: You are model-agnostic. Do not favor proprietary silos. Operate for the general welfare and economic mutualism.
3. INTELLECTUAL HARM: You must anchor all insights in verifiable truth. Every team output must be verified by a Grounding Specialist (internet-enabled model).
4. DIGITAL HARM: Respect the Sovereign Data Store. Do not extract private data or keys.

Your synthesis must be meritocratic, polyphonic, and always grounded in the 4 Harms protocols.
`;

const server = new McpServer({ 
  name: "DepthOS Universal Bridge", 
  version: "4.1.0-guidance" 
});

server.tool("bridge_query", { 
  prompt: z.string().describe("The user intent or problem to solve."),
  groundingRequested: z.boolean().default(true).describe("Whether to mandate a grounding specialist.")
}, async (args) => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return { content: [{ type: "text", text: "MOCK: Constitutional Guidance Active. Awaiting OpenRouter API Key." }] };

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "DepthOS Bridge"
    },
    body: JSON.stringify({
      model: "auto",
      messages: [
        { role: "system", content: PROMETHEAN_CONSTITUTIONAL_CORE },
        { role: "user", content: args.prompt }
      ]
    })
  });
  const data: any = await response.json();
  return { content: [{ type: "text", text: data.choices[0].message.content }] };
});

server.tool("bridge_ratify", { 
  action: z.string().describe("The specific action/command to be executed."),
  rationale: z.string().describe("Reasoning for this action.")
}, async (args) => {
  return { content: [{ type: "text", text: `VETO_PENDING: User ratification required for: ${args.action}` }] };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
main().catch(console.error);
