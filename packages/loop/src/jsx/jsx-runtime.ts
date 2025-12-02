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

export function jsx(
  tag: string,
  props: Record<string, any> | null
): string {
  const { children, ...rest } = props || {};
  const attrs = Object.entries(rest);
  const childArray = (Array.isArray(children) ? children.flat() : (children ? [children] : [])).filter(a => a && !!a.trim());

  const lines: string[] = [`${tag}:`];

  for (const [k, v] of attrs)
    lines.push(`  ${k}: ${v}`);

  for (const child of childArray) {
    const indented = child.split('\n').map((line: string) => `  ${line}`).join('\n');
    lines.push(indented);
  }

  return lines.join('\n');
}

export const jsxs = jsx;
