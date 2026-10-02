import { Page } from '@playwright/test';

// Every place a user can read text: text nodes (incl. <option>), plus the attributes browsers surface.
// `authoredSelector`: user-authored document CONTENT (line descriptions, scope statements) is data, not product
// vocabulary - an issued document is immutable, so a synthetic fixture issued before the rename keeps its old words.
// Everything the APP produces (labels, buttons, headings, tooltips, options) is still checked.
// The OLD terms (Prompt 44 Stage 1c). One term each, everywhere a person reads: 'Deposit request' (the document),
// 'Commitment fee' (the charge it asks for), 'Credit balance' (money held for a client). These must not appear: the old
// 'Retainer', 'on account', 'unapplied credit', 'deposit credit', 'in credit', and a BARE 'credit' (a 'credit note' and a
// 'credit balance' are the legitimate uses; 'Credited' is a different word and is not matched).
export const OLD_TERMS_SOURCE = String.raw`retainer|on account|unapplied credit|deposit credit|in credit|\bcredit\b(?!\s+(note|balance))`;
export const retainerHits = (page: Page, authoredSelector?: string) => page.evaluate(({ authoredSelector, source }) => {
  const hits: string[] = [];
  const re = new RegExp(source, 'i');
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.textContent ?? '';
    if (re.test(t) && !['SCRIPT', 'STYLE'].includes((n.parentElement?.tagName ?? '')) && !(authoredSelector && n.parentElement?.closest(authoredSelector))) hits.push(`text: ${t.trim().slice(0, 80)}`);
  }
  document.querySelectorAll('[title],[placeholder],[aria-label],[alt]').forEach(el => {
    for (const a of ['title', 'placeholder', 'aria-label', 'alt']) {
      const v = el.getAttribute(a);
      if (v && re.test(v)) hits.push(`${a}: ${v.slice(0, 80)}`);
    }
  });
  return hits;
}, { authoredSelector, source: OLD_TERMS_SOURCE });
