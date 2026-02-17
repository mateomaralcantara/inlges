import { StructuredText } from '../types';

export function parseStructuredText(text: string): StructuredText {
  const clean = (text || '').trim();
  if (!clean) return { raw: text };

  // intenta extraer secciones aunque el modelo meta variaciones
  const getSection = (labelA: RegExp, labelB?: RegExp) => {
    const start = clean.search(labelA);
    if (start < 0) return '';
    const rest = clean.slice(start);

    const nextIdx = labelB ? rest.search(labelB) : -1;
    const body = nextIdx > 0 ? rest.slice(0, nextIdx) : rest;

    // quita el header tipo "ORIGINAL (...):"
    return body.replace(labelA, '').trim();
  };

  // Headers tolerantes
  const reOriginal = /^ORIGINAL[\s\S]*?:/im;
  const reSpanish = /^ESPAÑOL[\s\S]*?:/im;
  const reQuestion = /^PREGUNTA[\s\S]*?:/im;

  const original = getSection(reOriginal, reSpanish || reQuestion) || '';
  const spanish = getSection(reSpanish, reQuestion) || '';
  const question = getSection(reQuestion) || '';

  // fallback: si no matcheó nada, devuelve texto crudo
  const any = (original || spanish || question).trim();
  if (!any) return { raw: clean };

  return {
    original: original.trim(),
    spanish: spanish.trim(),
    question: question.trim(),
    raw: clean,
  };
}
