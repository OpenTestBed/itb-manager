import React from 'react';
import ReactMarkdown from 'react-markdown';

interface Props {
  /** Raw markdown source. Empty/undefined renders nothing. */
  children?: string | null;
  /** Tailwind class for the wrapping span/div. */
  className?: string;
  /** Render inline (no block elements wrap in a single paragraph) vs block. Default block. */
  inline?: boolean;
}

/**
 * Tight, opinionated markdown rendering for test-plan / spec descriptions.
 *
 * - No raw HTML (react-markdown disables it by default).
 * - Links open in a new tab and use rel="noopener noreferrer". Only http/https/mailto schemes accepted.
 * - Inline code uses a subtle background. Bold/italic preserved. Lists collapsed
 *   to compact spacing (descriptions are short, not docs).
 * - When `inline=true`, paragraphs render as plain text with no top/bottom margin —
 *   useful inside list rows where a wrapping <p> would break the layout.
 */
export const Markdown: React.FC<Props> = ({ children, className, inline = false }) => {
  if (!children) return null;

  return (
    <div className={className}>
      <ReactMarkdown
        // No HTML, no script, no images-with-arbitrary-href — react-markdown's defaults.
        urlTransform={(uri) => {
          // Only allow safe schemes; drop anything weird.
          const lower = uri.toLowerCase().trim();
          if (lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('mailto:') || lower.startsWith('#')) {
            return uri;
          }
          return '';
        }}
        components={{
          a: ({ href, children: c }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">{c}</a>
          ),
          code: ({ children: c }) => (
            <code className="bg-gray-100 dark:bg-slate-800 text-[0.85em] px-1 py-0.5 rounded font-mono">{c}</code>
          ),
          pre: ({ children: c }) => (
            <pre className="bg-gray-100 dark:bg-slate-800 text-xs p-2 rounded my-1 overflow-x-auto">{c}</pre>
          ),
          // In inline mode, p collapses to a span-like span so we don't break flow.
          p: ({ children: c }) => inline
            ? <span>{c}</span>
            : <p className="my-1 first:mt-0 last:mb-0">{c}</p>,
          ul: ({ children: c }) => <ul className="list-disc ml-4 my-1 space-y-0.5">{c}</ul>,
          ol: ({ children: c }) => <ol className="list-decimal ml-4 my-1 space-y-0.5">{c}</ol>,
          li: ({ children: c }) => <li>{c}</li>,
          strong: ({ children: c }) => <strong className="font-semibold">{c}</strong>,
          em: ({ children: c }) => <em className="italic">{c}</em>,
          // Headings inside descriptions are usually not appropriate; render small.
          h1: ({ children: c }) => <div className="font-semibold text-base mt-2 mb-1">{c}</div>,
          h2: ({ children: c }) => <div className="font-semibold text-sm mt-2 mb-1">{c}</div>,
          h3: ({ children: c }) => <div className="font-semibold text-sm mt-1.5 mb-0.5">{c}</div>,
        }}>
        {children}
      </ReactMarkdown>
    </div>
  );
};
