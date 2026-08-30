"use client";

import {
  Children,
  cloneElement,
  isValidElement,
  type ReactNode
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

import {
  CALLOUT_MARKER,
  normalizeMarkdownCallouts,
  type MarkdownCalloutKind
} from "@/lib/markdownCallouts";

const CALLOUT_LABEL: Record<MarkdownCalloutKind, string> = {
  NOTE: "目前已知",
  QUESTION: "先停在這個缺口",
  IMPORTANT: "推導後的決定",
  TIP: "可以這樣記",
  WARNING: "常見錯誤",
  CAUTION: "邊界提醒"
};

function extractCallout(children: ReactNode): {
  kind: MarkdownCalloutKind | null;
  children: ReactNode;
} {
  let kind: MarkdownCalloutKind | null = null;

  const removeMarker = (child: ReactNode): ReactNode => {
    if (kind) return child;

    if (typeof child === "string") {
      const match = child.match(CALLOUT_MARKER);
      if (!match) return child;
      kind = match[1].toUpperCase() as MarkdownCalloutKind;
      return child.slice(match[0].length);
    }

    if (!isValidElement<{ children?: ReactNode }>(child)) {
      return child;
    }

    const nested = Children.map(
      child.props.children,
      removeMarker
    );
    return cloneElement(child, undefined, nested);
  };

  const transformedChildren = Children.map(children, removeMarker);
  return {
    kind,
    children: transformedChildren
  };
}

const MARKDOWN_COMPONENTS: Components = {
  blockquote({ children }) {
    const callout = extractCallout(children);
    if (!callout.kind) {
      return <blockquote>{children}</blockquote>;
    }

    const kind = callout.kind;
    return (
      <aside
        className={`markdown-callout markdown-callout-${kind.toLowerCase()}`}
        data-callout={kind}
      >
        <div className="markdown-callout-title">
          {CALLOUT_LABEL[kind]}
        </div>
        <div className="markdown-callout-body">
          {callout.children}
        </div>
      </aside>
    );
  }
};

export default function MarkdownBlock({ source }: { source: string }) {
  if (!source.trim()) {
    return <p className="muted">這一節目前沒有內容。</p>;
  }

  const normalizedSource = normalizeMarkdownCallouts(source);

  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={MARKDOWN_COMPONENTS}
      >
        {normalizedSource}
      </ReactMarkdown>
    </div>
  );
}
