import React from 'react';
import i18n from '@/i18n';
import { useTranslation } from 'react-i18next';
import '../i18n';
import '../translations/pages';

const ATTRIBUTES = ['placeholder', 'title', 'aria-label'] as const;

type TranslationPair = { ar: string; en: string };
type TemplatePair = TranslationPair & { arPattern: RegExp; enPattern: RegExp; arKeys: string[]; enKeys: string[] };

function flatten(value: unknown, prefix = '', target: Record<string, string> = {}) {
  if (!value || typeof value !== 'object') return target;
  Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'string') target[path] = child;
    else flatten(child, path, target);
  });
  return target;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compileTemplate(value: string) {
  const keys: string[] = [];
  const pattern = escapeRegExp(value).replace(/\\\{\\\{(\w+)\\\}\\\}/g, (_match, key: string) => {
    keys.push(key);
    return '(.+?)';
  });
  return { pattern: new RegExp(`^${pattern}$`), keys };
}

function applyTemplate(target: string, keys: string[], values: string[]) {
  return keys.reduce((result, key, index) => result.replace(`{{${key}}}`, values[index] ?? ''), target);
}

function buildPairs() {
  const ar = flatten(i18n.getResourceBundle('ar', 'hr'));
  const en = flatten(i18n.getResourceBundle('en', 'hr'));
  const exact: TranslationPair[] = [];
  const templates: TemplatePair[] = [];

  Object.entries(ar).forEach(([key, arValue]) => {
    const enValue = en[key];
    if (!enValue || arValue === enValue) return;
    if (arValue.includes('{{') || enValue.includes('{{')) {
      const arCompiled = compileTemplate(arValue);
      const enCompiled = compileTemplate(enValue);
      templates.push({
        ar: arValue,
        en: enValue,
        arPattern: arCompiled.pattern,
        enPattern: enCompiled.pattern,
        arKeys: arCompiled.keys,
        enKeys: enCompiled.keys,
      });
    } else {
      exact.push({ ar: arValue, en: enValue });
    }
  });

  return { exact, templates };
}

function translateValue(value: string, language: string, pairs: ReturnType<typeof buildPairs>) {
  const isArabic = language.startsWith('ar');
  const trimmed = value.trim();
  if (!trimmed) return value;

  const exact = pairs.exact.find((pair) => (isArabic ? pair.en === trimmed : pair.ar === trimmed));
  let translated = exact ? (isArabic ? exact.ar : exact.en) : undefined;

  if (!translated) {
    for (const pair of pairs.templates) {
      const pattern = isArabic ? pair.enPattern : pair.arPattern;
      const match = trimmed.match(pattern);
      if (!match) continue;
      translated = applyTemplate(
        isArabic ? pair.ar : pair.en,
        isArabic ? pair.arKeys : pair.enKeys,
        match.slice(1),
      );
      break;
    }
  }

  return translated ? value.replace(trimmed, translated) : value;
}

function localizeNode(root: Node, language: string, pairs: ReturnType<typeof buildPairs>) {
  if (root.nodeType === Node.TEXT_NODE && root.textContent) {
    root.textContent = translateValue(root.textContent, language, pairs);
    return;
  }

  if (!(root instanceof HTMLElement)) return;
  ATTRIBUTES.forEach((attribute) => {
    const value = root.getAttribute(attribute);
    if (value) root.setAttribute(attribute, translateValue(value, language, pairs));
  });

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (node.textContent) node.textContent = translateValue(node.textContent, language, pairs);
    node = walker.nextNode();
  }

  root.querySelectorAll<HTMLElement>('*').forEach((element) => {
    ATTRIBUTES.forEach((attribute) => {
      const value = element.getAttribute(attribute);
      if (value) element.setAttribute(attribute, translateValue(value, language, pairs));
    });
  });
}

export const HrLegacyLocalization: React.FC<{ rootRef: React.RefObject<HTMLDivElement> }> = ({ rootRef }) => {
  const { i18n: translation } = useTranslation('hr');
  const language = translation.resolvedLanguage ?? translation.language ?? 'ar';

  React.useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const pairs = buildPairs();
    let applying = false;

    const apply = (node: Node = root) => {
      if (applying) return;
      applying = true;
      localizeNode(node, language, pairs);
      queueMicrotask(() => { applying = false; });
    };

    apply();
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'characterData') apply(mutation.target);
        mutation.addedNodes.forEach((node) => apply(node));
        if (mutation.type === 'attributes') apply(mutation.target);
      });
    });
    observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: [...ATTRIBUTES] });
    return () => observer.disconnect();
  }, [language, rootRef]);

  return null;
};
