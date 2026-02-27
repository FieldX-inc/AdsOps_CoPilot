"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Props = {
  content: string;
};

export function MarkdownContent({ content }: Props) {
  return (
    <div className="text-sm leading-6">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="my-2 leading-relaxed">{children}</p>,
          h1: ({ children }) => <h1 className="mt-3 text-base font-semibold">{children}</h1>,
          h2: ({ children }) => <h2 className="mt-3 text-base font-semibold">{children}</h2>,
          h3: ({ children }) => <h3 className="mt-2 text-sm font-semibold">{children}</h3>,
          ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
          li: ({ children }) => <li>{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-slate-300 pl-3 text-slate-700">
              {children}
            </blockquote>
          ),
          code: ({ className, children }) => {
            const isBlock = Boolean(className?.includes("language-"));
            if (isBlock) {
              return (
                <code className="block overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-white">
                  {children}
                </code>
              );
            }
            return <code className="rounded bg-slate-200 px-1 py-0.5 text-[12px]">{children}</code>;
          },
          a: ({ href, children }) => (
            <a
              href={href}
              target={href?.startsWith("http") ? "_blank" : undefined}
              rel={href?.startsWith("http") ? "noreferrer noopener" : undefined}
              className="underline"
            >
              {children}
            </a>
          ),
          hr: () => <hr className="my-3 border-slate-300" />,
          table: ({ children }) => <table className="my-2 w-full border-collapse text-xs">{children}</table>,
          th: ({ children }) => (
            <th className="border border-slate-300 bg-slate-100 px-2 py-1 text-left">{children}</th>
          ),
          td: ({ children }) => <td className="border border-slate-300 px-2 py-1">{children}</td>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
