import React from 'react';
import { StructuredText, TargetLanguage } from '../types';

interface TranscriptBubbleProps {
  content: StructuredText;
  targetLanguage: TargetLanguage;
}

const TranscriptBubble: React.FC<TranscriptBubbleProps> = ({ content, targetLanguage }) => {
  const originalTitle = `ORIGINAL (IN ${targetLanguage.toUpperCase()})`;
  const questionTitle = `QUESTION (IN ${targetLanguage.toUpperCase()})`;

  // si no se pudo parsear bien, muestra raw
  if (!content.original && !content.spanish && !content.question && content.raw) {
    return <p className="text-white whitespace-pre-wrap">{content.raw}</p>;
  }

  return (
    <div className="space-y-3 text-left">
      {content.original && (
        <div>
          <p className="font-bold text-sm text-indigo-300">{originalTitle}</p>
          <p className="text-white whitespace-pre-wrap">{content.original}</p>
        </div>
      )}

      {content.spanish && (
        <div>
          <p className="font-bold text-sm text-gray-400">ESPAÑOL (TRADUCCIÓN + CORRECCIÓN)</p>
          <p className="text-gray-300 italic whitespace-pre-wrap">{content.spanish}</p>
        </div>
      )}

      {content.question && (
        <div className="bg-indigo-900/50 p-3 rounded-lg mt-2">
          <p className="font-bold text-sm text-indigo-300">{questionTitle}</p>
          <p className="text-white font-medium whitespace-pre-wrap">{content.question}</p>
        </div>
      )}
    </div>
  );
};

export default TranscriptBubble;
