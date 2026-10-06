"use client";

import { Children, isValidElement, useMemo, type ComponentPropsWithoutRef, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { Check, Copy } from "lucide-react";
import { MermaidDiagram } from "./mermaid-diagram";

interface MarkdownPreviewProps {
  content: string;
  repositoryId: string;
  documentPath: string;
  dark: boolean;
  onOpenDocument: (path: string) => void;
}

const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code || []), ["className", /^language-/]],
    span: [...(defaultSchema.attributes?.span || []), ["className", /^hljs-/]],
  },
};

function resolveRelativePath(documentPath: string, target: string) {
  const cleanTarget = target.split("#")[0].split("?")[0];
  const currentDirectory = documentPath.includes("/")
    ? documentPath.slice(0, documentPath.lastIndexOf("/") + 1)
    : "";
  const url = new URL(cleanTarget, `https://workspace.local/${currentDirectory.split("/").map(encodeURIComponent).join("/")}`);
  try { return decodeURIComponent(url.pathname.replace(/^\//, "")); }
  catch { return ""; }
}

function textFromChildren(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(textFromChildren).join("");
  if (value && typeof value === "object" && "props" in value) {
    return textFromChildren((value as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

function PreBlock({
  children,
  dark,
  ...props
}: ComponentPropsWithoutRef<"pre"> & { dark: boolean }) {
  const child = Children.toArray(children)[0];
  if (!isValidElement<ComponentPropsWithoutRef<"code">>(child)) {
    return <pre {...props}>{children}</pre>;
  }

  const language = /language-([\w-]+)/.exec(child.props.className || "")?.[1];
  const code = textFromChildren(child.props.children).replace(/\n$/, "");

  if (language === "mermaid") return <MermaidDiagram chart={code} dark={dark} />;

  return (
    <div className="code-block">
      <div className="code-toolbar">
        <span>{language || "Code"}</span>
        <CopyButton value={code} />
      </div>
      <pre {...props}>{children}</pre>
    </div>
  );
}

export function CopyButton({ value }: { value: string }) {
  const copy = async (event: React.MouseEvent<HTMLButtonElement>) => {
    const button = event.currentTarget;
    try { await navigator.clipboard.writeText(value); }
    catch { button.title = "Clipboard access is unavailable."; return; }
    button.dataset.copied = "true";
    window.setTimeout(() => delete button.dataset.copied, 1_400);
  };

  return (
    <button className="copy-button" onClick={copy} aria-label="Copy code">
      <Copy className="copy-icon" size={14} />
      <Check className="copied-icon" size={14} />
      <span className="copy-label">Copy</span>
      <span className="copied-label">Copied</span>
    </button>
  );
}

export function MarkdownPreview({
  content,
  repositoryId,
  documentPath,
  dark,
  onOpenDocument,
}: MarkdownPreviewProps) {
  const components = useMemo(
    () => ({
      pre: (props: ComponentPropsWithoutRef<"pre">) => <PreBlock {...props} dark={dark} />,
      a: ({ href = "", children, ...props }: ComponentPropsWithoutRef<"a">) => {
        if (!href) return <span>{children}</span>;
        if (href.startsWith("#") && !href.startsWith("#user-content-")) href = `#user-content-${href.slice(1)}`;
        const external = /^(https?:|mailto:|tel:)/i.test(href);
        const isWorkspaceDocument = /\.(?:md|mdown|mmd|mermaid)(?:[#?].*)?$/i.test(href);
        if (!external && isWorkspaceDocument) {
          const targetPath = resolveRelativePath(documentPath, href);
          return (
            <a
              href={href}
              {...props}
              onClick={(event) => {
                event.preventDefault();
                onOpenDocument(targetPath);
              }}
            >
              {children}
            </a>
          );
        }
        return (
          <a href={href} {...props} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}>
            {children}
          </a>
        );
      },
      img: ({ src = "", alt = "", ...props }: ComponentPropsWithoutRef<"img">) => {
        const sourceValue = typeof src === "string" ? src : "";
        const external = /^https?:\/\//i.test(sourceValue);
        const resolved = resolveRelativePath(documentPath, sourceValue);
        const source = external ? sourceValue : `/api/project-workspace?repositoryId=${encodeURIComponent(repositoryId)}&asset=${encodeURIComponent(resolved)}`;
        // eslint-disable-next-line @next/next/no-img-element -- Markdown can reference arbitrary external image dimensions.
        return <img src={source} alt={alt} {...props} loading="lazy" referrerPolicy="no-referrer" />;
      },
    }),
    [dark, documentPath, onOpenDocument, repositoryId],
  );

  return (
    <article className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          rehypeSlug,
          [rehypeAutolinkHeadings, { behavior: "wrap" }],
          [rehypeHighlight, { detect: false, plainText: ["mermaid"] }],
          [rehypeSanitize, schema],
        ]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </article>
  );
}
