/**
 * Pinchtab OpenClaw Plugin
 *
 * Single-tool design: one `pinchtab` tool with an `action` parameter.
 * Minimal context bloat — one tool definition covers all browser operations.
 */

interface PluginConfig {
  baseUrl?: string;
  token?: string;
  timeout?: number;
}

interface PluginApi {
  config: { plugins?: { entries?: Record<string, { config?: PluginConfig }> } };
  registerTool: (tool: any, opts?: { optional?: boolean }) => void;
}

function getConfig(api: PluginApi): PluginConfig {
  return api.config?.plugins?.entries?.pinchtab?.config ?? {};
}

async function pinchtabFetch(
  cfg: PluginConfig,
  path: string,
  opts: { method?: string; body?: unknown; rawResponse?: boolean } = {},
): Promise<any> {
  const base = cfg.baseUrl || "http://localhost:9867";
  const url = `${base}${path}`;
  const headers: Record<string, string> = {};
  if (cfg.token) headers["Authorization"] = `Bearer ${cfg.token}`;
  if (opts.body) headers["Content-Type"] = "application/json";

  const controller = new AbortController();
  const timeout = cfg.timeout || 30000;
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url, {
      method: opts.method || (opts.body ? "POST" : "GET"),
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
    if (opts.rawResponse) return res;
    const text = await res.text();
    if (!res.ok) {
      return { error: `${res.status} ${res.statusText}`, body: text };
    }
    try {
      return JSON.parse(text);
    } catch {
      return { text };
    }
  } catch (err: any) {
    if (err?.name === "AbortError") {
      return { error: `Request timed out after ${timeout}ms: ${path}` };
    }
    return {
      error: `Connection failed: ${err?.message || err}. Is Pinchtab running at ${base}?`,
    };
  } finally {
    clearTimeout(timer);
  }
}

function textResult(data: any): any {
  const text =
    typeof data === "string" ? data : data?.text ?? JSON.stringify(data, null, 2);
  return { content: [{ type: "text", text }] };
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function htmlToMarkdown(html: string): string {
  if (!html || typeof html !== "string") return "";

  let md = html;

  // Remove non-content blocks.
  md = md
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gis, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gis, "")
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gis, "");

  // Preserve code blocks early.
  md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_m, code) => {
    const clean = decodeHtmlEntities(String(code).replace(/<[^>]+>/g, "")).trim();
    return `\n\n\`\`\`\n${clean}\n\`\`\`\n\n`;
  });

  // Links.
  md = md.replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, label) => {
    const cleanLabel = decodeHtmlEntities(String(label).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    return cleanLabel ? `[${cleanLabel}](${href})` : href;
  });

  // Headings.
  for (let i = 6; i >= 1; i -= 1) {
    const hashes = "#".repeat(i);
    const re = new RegExp(`<h${i}[^>]*>([\\s\\S]*?)<\\/h${i}>`, "gi");
    md = md.replace(re, (_m, content) => {
      const clean = decodeHtmlEntities(String(content).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
      return clean ? `\n\n${hashes} ${clean}\n\n` : "\n\n";
    });
  }

  // Inline emphasis.
  md = md
    .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/(strong|b)>/gi, "**$2**")
    .replace(/<(em|i)[^>]*>([\s\S]*?)<\/(em|i)>/gi, "*$2*")
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");

  // Lists.
  md = md
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(ul|ol)>/gi, "\n\n");

  // Line breaks + paragraphs/blocks.
  md = md
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|main|header|footer|aside|blockquote)>/gi, "\n\n");

  // Remove remaining tags.
  md = md.replace(/<[^>]+>/g, " ");

  md = decodeHtmlEntities(md)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return md;
}

function ensureH1(markdown: string, title?: string): string {
  const body = (markdown || "").trim();
  const firstNonEmpty = body.split(/\r?\n/).find((line) => line.trim().length > 0) || "";
  const hasH1 = /^#\s+\S/.test(firstNonEmpty);
  if (hasH1) return body;

  const cleanTitle = (title || "").replace(/\s+/g, " ").trim() || "Untitled";
  return `# ${cleanTitle}\n\n${body}`.trim();
}

async function extractArticleMarkdown(cfg: PluginConfig, params: any): Promise<{ text: string } | { error: string; body?: string }> {
  const query = new URLSearchParams();
  if (params.tabId) query.set("tabId", params.tabId);
  query.set("mode", "readability");

  // Prefer /text endpoint first (keeps compatibility with current plugin behavior).
  let textPayload = await pinchtabFetch(cfg, `/text?${query.toString()}`);

  // Fallback for APIs that require explicit tab route.
  if (textPayload?.error && params.tabId) {
    textPayload = await pinchtabFetch(cfg, `/tabs/${params.tabId}/text?mode=readability`);
  }

  if (textPayload?.error) {
    return textPayload;
  }

  const titleFromText = typeof textPayload?.title === "string" ? textPayload.title : "";
  const urlFromText = typeof textPayload?.url === "string" ? textPayload.url : "";
  const readableText = typeof textPayload?.text === "string" ? textPayload.text : "";

  // Try to extract readable HTML + title from page for better Markdown structure.
  const expression = `(() => {
    const root = document.querySelector('article, main, [role="main"], .article, .post, .entry-content, .content') || document.body;
    return {
      title: document.title || '',
      url: location.href || '',
      html: root ? root.innerHTML : ''
    };
  })()`;

  let evalPayload: any = null;
  if (params.tabId) {
    evalPayload = await pinchtabFetch(cfg, `/tabs/${params.tabId}/evaluate`, { body: { expression } });
    if (evalPayload?.error) {
      evalPayload = await pinchtabFetch(cfg, "/evaluate", { body: { expression, tabId: params.tabId } });
    }
  } else {
    evalPayload = await pinchtabFetch(cfg, "/evaluate", { body: { expression } });
  }

  const evalResult = evalPayload?.result && typeof evalPayload.result === "object" ? evalPayload.result : null;
  const html = typeof evalResult?.html === "string" ? evalResult.html : "";
  const title =
    (typeof evalResult?.title === "string" && evalResult.title.trim()) ||
    (typeof titleFromText === "string" && titleFromText.trim()) ||
    "Untitled";
  const url =
    (typeof evalResult?.url === "string" && evalResult.url.trim()) ||
    (typeof urlFromText === "string" && urlFromText.trim()) ||
    "";

  let markdown = htmlToMarkdown(html);

  // Fallback: if HTML conversion yielded too little, convert readable text into basic Markdown paragraphs.
  if (!markdown || markdown.length < 32) {
    markdown = (readableText || "")
      .replace(/\r\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  markdown = ensureH1(markdown, title);

  // Add source URL if useful and missing.
  if (url && !markdown.includes(url)) {
    markdown = `${markdown}\n\nSource: ${url}`.trim();
  }

  return { text: markdown };
}

export default function register(api: PluginApi) {
  api.registerTool(
    {
      name: "pinchtab",
      description: `Browser control via Pinchtab. Actions:
- navigate: go to URL (url, tabId?, newTab?, blockImages?, timeout?)
- snapshot: accessibility tree (filter?, format?, selector?, maxTokens?, depth?, diff?, tabId?)
- click/type/press/fill/hover/scroll/select/focus: act on element (ref, text?, key?, value?, scrollY?, waitNav?, tabId?)
- text: extract readable text (mode?, tabId?)
- article_markdown: extract clean article markdown in one call (tabId?)
- tabs: list/new/close tabs (tabAction?, url?, tabId?)
- screenshot: JPEG screenshot (quality?, tabId?)
- evaluate: run JS (expression, tabId?)
- pdf: export page as PDF (landscape?, scale?, tabId?)
- health: check connectivity

Token strategy: prefer "article_markdown" or "text" for reading (~800), use "snapshot" with filter=interactive&format=compact for interactions (~3,600), and diff=true on subsequent snapshots.`,
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: [
              "navigate",
              "snapshot",
              "click",
              "type",
              "press",
              "fill",
              "hover",
              "scroll",
              "select",
              "focus",
              "text",
              "article_markdown",
              "tabs",
              "screenshot",
              "evaluate",
              "pdf",
              "health",
            ],
            description: "Action to perform",
          },
          url: { type: "string", description: "URL for navigate or new tab" },
          ref: {
            type: "string",
            description: "Element ref from snapshot (e.g. e5)",
          },
          text: { type: "string", description: "Text to type or fill" },
          key: {
            type: "string",
            description: "Key to press (e.g. Enter, Tab, Escape)",
          },
          expression: {
            type: "string",
            description: "JavaScript expression for evaluate",
          },
          selector: {
            type: "string",
            description: "CSS selector for snapshot scope or action target",
          },
          filter: {
            type: "string",
            enum: ["interactive", "all"],
            description: "Snapshot filter: interactive = buttons/links/inputs only",
          },
          format: {
            type: "string",
            enum: ["json", "compact", "text", "yaml"],
            description: "Snapshot format: compact is most token-efficient",
          },
          maxTokens: {
            type: "number",
            description: "Truncate snapshot to ~N tokens",
          },
          depth: { type: "number", description: "Max snapshot tree depth" },
          diff: {
            type: "boolean",
            description: "Snapshot diff: only changes since last snapshot",
          },
          value: { type: "string", description: "Value for select dropdown" },
          scrollY: {
            type: "number",
            description: "Pixels to scroll vertically",
          },
          waitNav: {
            type: "boolean",
            description: "Wait for navigation after action",
          },
          tabId: { type: "string", description: "Target tab ID" },
          tabAction: {
            type: "string",
            enum: ["list", "new", "close"],
            description: "Tab sub-action (default: list)",
          },
          newTab: { type: "boolean", description: "Open URL in new tab" },
          blockImages: { type: "boolean", description: "Block image loading" },
          timeout: {
            type: "number",
            description: "Navigation timeout in seconds",
          },
          quality: {
            type: "number",
            description: "JPEG quality 1-100 (default: 80)",
          },
          mode: {
            type: "string",
            enum: ["readability", "raw"],
            description: "Text extraction mode",
          },
          landscape: { type: "boolean", description: "PDF landscape orientation" },
          scale: { type: "number", description: "PDF print scale (default: 1.0)" },
        },
        required: ["action"],
      },
      async execute(_id: string, params: any) {
        const cfg = getConfig(api);
        const { action } = params;

        // --- navigate ---
        if (action === "navigate") {
          const body: any = { url: params.url };
          if (params.tabId) body.tabId = params.tabId;
          if (params.newTab) body.newTab = true;
          if (params.blockImages) body.blockImages = true;
          if (params.timeout) body.timeout = params.timeout;
          return textResult(await pinchtabFetch(cfg, "/navigate", { body }));
        }

        // --- snapshot ---
        if (action === "snapshot") {
          const query = new URLSearchParams();
          if (params.tabId) query.set("tabId", params.tabId);
          if (params.filter) query.set("filter", params.filter);
          if (params.format) query.set("format", params.format);
          if (params.selector) query.set("selector", params.selector);
          if (params.maxTokens) query.set("maxTokens", String(params.maxTokens));
          if (params.depth) query.set("depth", String(params.depth));
          if (params.diff) query.set("diff", "true");
          const qs = query.toString();
          return textResult(
            await pinchtabFetch(cfg, `/snapshot${qs ? `?${qs}` : ""}`),
          );
        }

        // --- element actions ---
        const elementActions = [
          "click",
          "type",
          "press",
          "fill",
          "hover",
          "scroll",
          "select",
          "focus",
        ];
        if (elementActions.includes(action)) {
          const body: any = { kind: action };
          for (const k of [
            "ref",
            "text",
            "key",
            "selector",
            "value",
            "scrollY",
            "tabId",
            "waitNav",
          ]) {
            if (params[k] !== undefined) body[k] = params[k];
          }
          return textResult(await pinchtabFetch(cfg, "/action", { body }));
        }

        // --- text ---
        if (action === "text") {
          const query = new URLSearchParams();
          if (params.tabId) query.set("tabId", params.tabId);
          if (params.mode) query.set("mode", params.mode);
          const qs = query.toString();
          return textResult(
            await pinchtabFetch(cfg, `/text${qs ? `?${qs}` : ""}`),
          );
        }

        // --- article_markdown ---
        if (action === "article_markdown") {
          return textResult(await extractArticleMarkdown(cfg, params));
        }

        // --- tabs ---
        if (action === "tabs") {
          const tabAction = params.tabAction || "list";
          if (tabAction === "list") {
            return textResult(await pinchtabFetch(cfg, "/tabs"));
          }
          const body: any = { action: tabAction };
          if (params.url) body.url = params.url;
          if (params.tabId) body.tabId = params.tabId;
          return textResult(await pinchtabFetch(cfg, "/tab", { body }));
        }

        // --- screenshot ---
        if (action === "screenshot") {
          const query = new URLSearchParams();
          if (params.tabId) query.set("tabId", params.tabId);
          if (params.quality) query.set("quality", String(params.quality));
          const qs = query.toString();
          try {
            const res = await pinchtabFetch(
              cfg,
              `/screenshot${qs ? `?${qs}` : ""}`,
              { rawResponse: true },
            );
            if (res instanceof Response) {
              if (!res.ok) {
                return textResult({
                  error: `Screenshot failed: ${res.status} ${await res.text()}`,
                });
              }
              const buf = await res.arrayBuffer();
              const b64 = Buffer.from(buf).toString("base64");
              return {
                content: [{ type: "image", data: b64, mimeType: "image/jpeg" }],
              };
            }
            return textResult(res);
          } catch (err: any) {
            return textResult({ error: `Screenshot failed: ${err?.message}` });
          }
        }

        // --- evaluate ---
        if (action === "evaluate") {
          const body: any = { expression: params.expression };
          if (params.tabId) body.tabId = params.tabId;
          return textResult(await pinchtabFetch(cfg, "/evaluate", { body }));
        }

        // --- pdf ---
        if (action === "pdf") {
          const query = new URLSearchParams();
          if (params.tabId) query.set("tabId", params.tabId);
          if (params.landscape) query.set("landscape", "true");
          if (params.scale) query.set("scale", String(params.scale));
          const qs = query.toString();
          return textResult(
            await pinchtabFetch(cfg, `/pdf${qs ? `?${qs}` : ""}`),
          );
        }

        // --- health ---
        if (action === "health") {
          return textResult(await pinchtabFetch(cfg, "/health"));
        }

        return textResult({ error: `Unknown action: ${action}` });
      },
    },
    { optional: true },
  );
}
