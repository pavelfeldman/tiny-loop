/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import url from 'url';

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type * as types from '@lowire/loop';

export type McpServer = {
  command: string;
  args?: string[];
  cwd?: string;
  stderr?: 'pipe' | 'inherit' | 'ignore';
  env?: Record<string, string>;
};

type ToolFilter = (string | RegExp)[];
type ToolSupport = {
  close: () => Promise<void>;
  tools: types.Tool[];
  callTool: types.ToolCallback;
};

async function connectToMcpServer(server: McpServer, options?: { rootDir?: string }): Promise<Client> {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const { ListRootsRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');

  const transport = new StdioClientTransport(server);
  const capabilities: any = {};
  if (options?.rootDir)
    capabilities['roots'] = {};

  const client = new Client({ name: 'test', version: '1.0.0' }, { capabilities });
  if (options?.rootDir) {
    client.setRequestHandler(ListRootsRequestSchema, async () => {
      return {
        roots: [{ name: 'workspace', uri: url.pathToFileURL(options.rootDir!).toString() }],
      };
    });
  }
  await client.connect(transport);
  return client;
}

async function mcpTools(server: McpServer, options?: { rootDir?: string, toolFilter?: ToolFilter }): Promise<ToolSupport> {
  const client = await connectToMcpServer(server, options);
  const { tools } = await client.listTools() as { tools: types.Tool[] };
  const filteredTools = options?.toolFilter ? tools.filter(tool => options.toolFilter!.some(filter => typeof filter === 'string' ? tool.name === filter : filter.test(tool.name))) : tools;
  const callTool: types.ToolCallback = async params => {
    return await client.callTool({ name: params.name, arguments: params.arguments }) as types.ToolResult;
  };
  return { tools: filteredTools, callTool, close: () => client.close() };
}

export async function createMcpTools(servers: Record<string, McpServer>, options?: { rootDir?: string, toolFilter?: ToolFilter }): Promise<ToolSupport> {
  const allTools: types.Tool[] = [];
  const callTools: Map<string, types.ToolCallback> = new Map();
  const closes: (() => Promise<void>)[] = [];
  for (const [name, server] of Object.entries(servers)) {
    const { tools, callTool, close } = await mcpTools(server, options);
    for (const tool of tools) {
      const fullName = `${name}__${tool.name}`;
      allTools.push({ ...tool, name: fullName });
      callTools.set(fullName, params => callTool({ name: tool.name, arguments: params.arguments }));
    }
    closes.push(close);
  }
  return {
    close: async () => {
      await Promise.all(closes.map(c => c()));
    },
    tools: allTools,
    callTool: async params => {
      const callTool = callTools.get(params.name);
      if (!callTool)
        throw new Error(`Tool not found: ${params.name}`);
      return callTool(params);
    }
  };
}
