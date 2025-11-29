/**
 * Copyright 2017 Google Inc. All rights reserved.
 * Modifications copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import http from 'http';
import debug from 'debug';

export class TestServer {
  private _server: http.Server;
  readonly debugServer: any;
  private _routes = new Map<string, (request: http.IncomingMessage, response: http.ServerResponse) => any>();
  readonly PORT: number;
  readonly PREFIX: string;
  readonly CROSS_PROCESS_PREFIX: string;
  readonly HELLO_WORLD: string;

  static async create(port: number): Promise<TestServer> {
    const server = new TestServer(port);
    await new Promise(x => server._server.once('listening', x));
    return server;
  }

  static async createHTTPS(port: number): Promise<TestServer> {
    const server = new TestServer(port);
    await new Promise(x => server._server.once('listening', x));
    return server;
  }

  constructor(port: number) {
    this._server = http.createServer(this._onRequest.bind(this));
    this._server.listen(port);
    this.debugServer = debug('pw:testserver');

    const cross_origin = '127.0.0.1';
    const same_origin = 'localhost';
    const protocol = 'http';
    this.PORT = port;
    this.PREFIX = `${protocol}://${same_origin}:${port}/`;
    this.CROSS_PROCESS_PREFIX = `${protocol}://${cross_origin}:${port}/`;
    this.HELLO_WORLD = `${this.PREFIX}hello-world`;
  }

  async stop() {
    this.reset();
    await new Promise(x => this._server.close(x));
  }

  route(path: string, handler: (request: http.IncomingMessage, response: http.ServerResponse) => any) {
    this._routes.set(path, handler);
  }

  setContent(path: string, content: string, mimeType: string) {
    this.route(path, (req, res) => {
      res.writeHead(200, { 'Content-Type': mimeType });
      res.end(mimeType === 'text/html' ? `<!DOCTYPE html>${content}` : content);
    });
  }

  reset() {
    this._routes.clear();
    this._server.closeAllConnections();
    this.setContent('/favicon.ico', '', 'image/x-icon');

    this.setContent('/', ``, 'text/html');

    this.setContent('/hello-world', `
      <title>Title</title>
      <body>Hello, world!</body>
    `, 'text/html');
  }

  _onRequest(request: http.IncomingMessage, response: http.ServerResponse) {
    request.on('error', error => {
      if ((error as any).code === 'ECONNRESET')
        response.end();
      else
        throw error;
    });
    (request as any).postBody = new Promise(resolve => {
      const chunks: Buffer[] = [];
      request.on('data', chunk => {
        chunks.push(chunk);
      });
      request.on('end', () => resolve(Buffer.concat(chunks)));
    });
    const path = request.url || '/';
    this.debugServer(`request ${request.method} ${path}`);
    const handler = this._routes.get(path);
    if (handler) {
      handler.call(null, request, response);
    } else {
      response.writeHead(404);
      response.end();
    }
  }
}
