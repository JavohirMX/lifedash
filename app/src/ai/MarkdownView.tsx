import React from 'react';

interface MarkdownViewProps {
  content: string;
}

function renderInline(text: string): React.ReactNode[] {
  // Regex matches `code`, **bold**, *italic*
  const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return tokens.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code key={i} className="ai-md-code">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

export function MarkdownView({ content }: MarkdownViewProps) {
  if (!content) return null;

  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeBlockBuffer: string[] = [];
  let inList: 'ul' | 'ol' | null = null;
  let listItems: React.ReactNode[] = [];

  const flushList = () => {
    if (inList && listItems.length > 0) {
      const Tag = inList;
      elements.push(
        <Tag key={`list-${elements.length}`} className="ai-md-list">
          {listItems}
        </Tag>,
      );
      inList = null;
      listItems = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Code block toggle
    if (trimmed.startsWith('```')) {
      if (inCodeBlock) {
        elements.push(
          <pre key={`code-${elements.length}`} className="ai-md-pre">
            <code>{codeBlockBuffer.join('\n')}</code>
          </pre>,
        );
        codeBlockBuffer = [];
        inCodeBlock = false;
      } else {
        flushList();
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockBuffer.push(line);
      continue;
    }

    // Headings
    if (trimmed.startsWith('### ')) {
      flushList();
      elements.push(<h4 key={`h4-${elements.length}`}>{renderInline(trimmed.slice(4))}</h4>);
      continue;
    }
    if (trimmed.startsWith('## ')) {
      flushList();
      elements.push(<h3 key={`h3-${elements.length}`}>{renderInline(trimmed.slice(3))}</h3>);
      continue;
    }
    if (trimmed.startsWith('# ')) {
      flushList();
      elements.push(<h2 key={`h2-${elements.length}`}>{renderInline(trimmed.slice(2))}</h2>);
      continue;
    }

    // Bullet list
    const bulletMatch = trimmed.match(/^[-*]\s+(.*)$/);
    if (bulletMatch) {
      if (inList !== 'ul') {
        flushList();
        inList = 'ul';
      }
      listItems.push(<li key={`li-${listItems.length}`}>{renderInline(bulletMatch[1])}</li>);
      continue;
    }

    // Numbered list
    const numMatch = trimmed.match(/^\d+\.\s+(.*)$/);
    if (numMatch) {
      if (inList !== 'ol') {
        flushList();
        inList = 'ol';
      }
      listItems.push(<li key={`li-${listItems.length}`}>{renderInline(numMatch[1])}</li>);
      continue;
    }

    // Blank line
    if (!trimmed) {
      flushList();
      continue;
    }

    // Plain paragraph
    flushList();
    elements.push(<p key={`p-${elements.length}`}>{renderInline(trimmed)}</p>);
  }

  flushList();
  if (inCodeBlock && codeBlockBuffer.length > 0) {
    elements.push(
      <pre key={`code-${elements.length}`} className="ai-md-pre">
        <code>{codeBlockBuffer.join('\n')}</code>
      </pre>,
    );
  }

  return <div className="ai-markdown-view">{elements}</div>;
}
