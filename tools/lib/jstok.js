/* tools/lib/jstok.js — owner: TOOLS */
(function (exports) {
  'use strict';
  // A small, robust JavaScript tokenizer for static checks. It understands comments,
  // strings, template literals (with nested ${} expressions), regex literals (by the usual
  // previous-token heuristic), numbers, identifiers and punctuators, and tracks line numbers
  // and bracket depth. It never executes code.
  //
  // token = {t, v, s, e, line, depth, cooked?}
  //   t: 'comment' | 'str' | 'tpl' | 'regex' | 'num' | 'ident' | 'punct'
  //   'tpl' tokens are template chunks; cooked is the literal text of the chunk; a template with
  //   interpolations yields several chunks with the expression tokens in between
  //   (tplPart: 'full' | 'head' | 'middle' | 'tail').

  const KEYWORD_BEFORE_REGEX = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
    'throw', 'case', 'do', 'else', 'yield', 'await']);
  const PUNCTS = ['>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=',
    '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '**', '<<', '>>'];

  function isIdStart(c) {
    return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 36 || c === 95 || c > 127 || c === 92;
  }
  function isIdPart(c) { return isIdStart(c) || (c >= 48 && c <= 57); }
  function isDigit(c) { return c >= 48 && c <= 57; }

  function cookString(raw) {
    // raw includes no quotes. Resolve common escapes (enough for name/GLSL extraction).
    return raw.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|\r\n|[\s\S])/g, function (m, e) {
      if (e[0] === 'u' && e[1] === '{') return String.fromCodePoint(parseInt(e.slice(2, -1), 16));
      if (e[0] === 'u' && e.length === 5) return String.fromCharCode(parseInt(e.slice(1), 16));
      if (e[0] === 'x' && e.length === 3) return String.fromCharCode(parseInt(e.slice(1), 16));
      switch (e) {
        case 'n': return '\n';
        case 't': return '\t';
        case 'r': return '\r';
        case 'b': return '\b';
        case 'f': return '\f';
        case 'v': return '\v';
        case '0': return '\0';
        case '\n': case '\r\n': case '\r': return '';
        default: return e;
      }
    });
  }

  function tokenize(src) {
    const toks = [];
    const n = src.length;
    let i = 0, line = 1, depth = 0;
    const stack = []; // '{' for blocks/objects, 'tpl' for template expressions
    let lastSig = null;
    let errors = [];

    function push(t, s, e, extra) {
      const tok = { t, v: src.slice(s, e), s, e, line, depth };
      if (extra) Object.assign(tok, extra);
      toks.push(tok);
      if (t !== 'comment') lastSig = tok;
      return tok;
    }
    function countLines(s, e) {
      for (let k = s; k < e; k++) if (src.charCodeAt(k) === 10) line++;
    }
    function regexAllowed() {
      if (!lastSig) return true;
      const t = lastSig.t, v = lastSig.v;
      if (t === 'num' || t === 'str' || t === 'regex') return false;
      if (t === 'tpl') return !(lastSig.tplPart === 'full' || lastSig.tplPart === 'tail');
      if (t === 'ident') return KEYWORD_BEFORE_REGEX.has(v);
      if (t === 'punct') return !(v === ')' || v === ']' || v === '}' || v === '++' || v === '--');
      return true;
    }
    function scanTemplateChunk(start, isHead) {
      // i points just after ` (head) or } (continuation)
      let j = i;
      let cooked = '';
      let rawStart = j;
      while (j < n) {
        const c = src.charCodeAt(j);
        if (c === 92) { j += 2; continue; }
        if (c === 96) { // `
          cooked = cookString(src.slice(rawStart, j));
          const startLine = line;
          countLines(start, j + 1);
          const tok = { t: 'tpl', v: src.slice(start, j + 1), s: start, e: j + 1, line: startLine, depth, cooked, tplPart: isHead ? 'full' : 'tail' };
          toks.push(tok); lastSig = tok;
          i = j + 1;
          return;
        }
        if (c === 36 && src.charCodeAt(j + 1) === 123) { // ${
          cooked = cookString(src.slice(rawStart, j));
          const startLine = line;
          countLines(start, j + 2);
          const tok = { t: 'tpl', v: src.slice(start, j + 2), s: start, e: j + 2, line: startLine, depth, cooked, tplPart: isHead ? 'head' : 'middle' };
          toks.push(tok); lastSig = tok;
          stack.push('tpl');
          i = j + 2;
          return;
        }
        j++;
      }
      errors.push({ line, msg: 'unterminated template literal' });
      countLines(start, n);
      const tok = { t: 'tpl', v: src.slice(start), s: start, e: n, line, depth, cooked: cookString(src.slice(rawStart)), tplPart: isHead ? 'full' : 'tail' };
      toks.push(tok); lastSig = tok;
      i = n;
    }

    while (i < n) {
      const c = src.charCodeAt(i);
      // whitespace
      if (c === 10) { line++; i++; continue; }
      if (c === 32 || c === 9 || c === 13 || c === 11 || c === 12 || c === 0xA0 || c === 0xFEFF || c === 0x2028 || c === 0x2029) { i++; continue; }
      // comments
      if (c === 47 && src.charCodeAt(i + 1) === 47) {
        let j = i + 2;
        while (j < n && src.charCodeAt(j) !== 10) j++;
        push('comment', i, j);
        i = j; continue;
      }
      if (c === 47 && src.charCodeAt(i + 1) === 42) {
        let j = src.indexOf('*/', i + 2);
        if (j < 0) { errors.push({ line, msg: 'unterminated block comment' }); j = n - 2; }
        const startLine = line;
        const tok = { t: 'comment', v: src.slice(i, j + 2), s: i, e: j + 2, line: startLine, depth };
        toks.push(tok);
        countLines(i, j + 2);
        i = j + 2; continue;
      }
      // strings
      if (c === 34 || c === 39) {
        let j = i + 1;
        while (j < n) {
          const d = src.charCodeAt(j);
          if (d === 92) { j += 2; continue; }
          if (d === c) break;
          if (d === 10) { errors.push({ line, msg: 'unterminated string' }); break; }
          j++;
        }
        const startLine = line;
        const tok = { t: 'str', v: src.slice(i, j + 1), s: i, e: j + 1, line: startLine, depth, cooked: cookString(src.slice(i + 1, j)) };
        toks.push(tok); lastSig = tok;
        countLines(i, Math.min(j + 1, n));
        i = j + 1; continue;
      }
      // template
      if (c === 96) {
        const start = i;
        i++;
        scanTemplateChunk(start, true);
        continue;
      }
      // numbers
      if (isDigit(c) || (c === 46 && isDigit(src.charCodeAt(i + 1)))) {
        let j = i + 1;
        while (j < n) {
          const d = src.charCodeAt(j);
          if (isIdPart(d) || d === 46) { j++; continue; }
          if ((d === 43 || d === 45) && (src[j - 1] === 'e' || src[j - 1] === 'E') && !/^0[xX]/.test(src.slice(i, j))) { j++; continue; }
          break;
        }
        push('num', i, j);
        i = j; continue;
      }
      // identifiers
      if (isIdStart(c)) {
        let j = i + 1;
        while (j < n && isIdPart(src.charCodeAt(j))) j++;
        push('ident', i, j);
        i = j; continue;
      }
      // regex
      if (c === 47 && regexAllowed()) {
        let j = i + 1, inClass = false;
        while (j < n) {
          const d = src.charCodeAt(j);
          if (d === 92) { j += 2; continue; }
          if (d === 10) { errors.push({ line, msg: 'unterminated regex' }); break; }
          if (inClass) { if (d === 93) inClass = false; }
          else if (d === 91) inClass = true;
          else if (d === 47) break;
          j++;
        }
        j++;
        while (j < n && isIdPart(src.charCodeAt(j))) j++;
        push('regex', i, j);
        i = j; continue;
      }
      // punctuators
      if (c === 123) { // {
        push('punct', i, i + 1);
        stack.push('{'); depth++;
        i++; continue;
      }
      if (c === 125) { // }
        if (stack.length && stack[stack.length - 1] === 'tpl') {
          stack.pop();
          const start = i;
          i++;
          scanTemplateChunk(start, false);
          continue;
        }
        if (stack.length) stack.pop();
        depth--;
        push('punct', i, i + 1);
        i++; continue;
      }
      if (c === 40 || c === 91) { push('punct', i, i + 1); depth++; i++; continue; }
      if (c === 41 || c === 93) { depth--; push('punct', i, i + 1); i++; continue; }
      let matched = null;
      for (const p of PUNCTS) {
        if (src.startsWith(p, i)) { matched = p; break; }
      }
      if (matched) { push('punct', i, i + matched.length); i += matched.length; continue; }
      push('punct', i, i + 1);
      i++;
    }
    return { tokens: toks, errors };
  }

  // Significant tokens (no comments).
  function significant(tokens) { return tokens.filter(t => t.t !== 'comment'); }

  // Source with comments blanked (newlines kept) and optionally string/template/regex contents
  // blanked too, so line-based regex scans can't match inside literals.
  function blank(src, tokens, opts) {
    opts = opts || {};
    const arr = src.split('');
    function wipe(s, e, keepEnds) {
      for (let k = s + (keepEnds ? 1 : 0); k < e - (keepEnds ? 1 : 0); k++) if (arr[k] !== '\n' && arr[k] !== '\r') arr[k] = ' ';
    }
    for (const t of tokens) {
      if (t.t === 'comment') wipe(t.s, t.e, false);
      else if (opts.strings && (t.t === 'str' || t.t === 'tpl')) wipe(t.s, t.e, true);
      else if (opts.regex && t.t === 'regex') wipe(t.s, t.e, true);
    }
    return arr.join('');
  }

  // Groups maximal runs of string-ish expressions: literals joined by '+', array elements of
  // [...].join(...), and identifiers (recorded as references). Returns
  // [{parts:[{lit}|{ref}], line, startTok, endTok}] for runs that contain at least one literal.
  function stringRuns(tokens) {
    const sig = significant(tokens);
    const runs = [];
    let i = 0;
    while (i < sig.length) {
      const t = sig[i];
      if (t.t !== 'str' && t.t !== 'tpl') { i++; continue; }
      // start of a run; walk backwards over "ident +" to include leading refs
      let start = i;
      while (start >= 2 && sig[start - 1].t === 'punct' && sig[start - 1].v === '+' && (sig[start - 2].t === 'ident' || sig[start - 2].t === 'str')) start -= 2;
      const parts = [];
      let j = start;
      let expectOperand = true;
      let tplDepth = 0;
      while (j < sig.length) {
        const u = sig[j];
        if (expectOperand) {
          if (u.t === 'str') { parts.push({ lit: u.cooked }); expectOperand = false; j++; continue; }
          if (u.t === 'tpl') {
            parts.push({ lit: u.cooked });
            if (u.tplPart === 'head' || u.tplPart === 'middle') {
              // collect interpolation tokens until the next chunk at the same template
              let k = j + 1, exprToks = [];
              let nest = 0;
              while (k < sig.length) {
                const w = sig[k];
                if (w.t === 'tpl' && nest === 0 && (w.tplPart === 'middle' || w.tplPart === 'tail')) break;
                if (w.t === 'tpl' && (w.tplPart === 'head')) nest++;
                if (w.t === 'tpl' && w.tplPart === 'tail' && nest > 0) nest--;
                exprToks.push(w);
                k++;
              }
              if (exprToks.length === 1 && exprToks[0].t === 'ident') parts.push({ ref: exprToks[0].v });
              else if (exprToks.length === 3 && exprToks[0].t === 'ident' && exprToks[1].v === '.' && exprToks[2].t === 'ident') parts.push({ ref: exprToks[0].v + '.' + exprToks[2].v });
              else parts.push({ expr: exprToks.map(w => w.v).join(' ') });
              j = k;
              expectOperand = true;
              tplDepth++;
              continue;
            }
            expectOperand = false; j++; continue;
          }
          if (u.t === 'ident' && parts.length && !(sig[j + 1] && sig[j + 1].v === '(')) {
            let name = u.v, k = j + 1;
            while (sig[k] && sig[k].v === '.' && sig[k + 1] && sig[k + 1].t === 'ident') { name += '.' + sig[k + 1].v; k += 2; }
            parts.push({ ref: name }); expectOperand = false; j = k; continue;
          }
          if (u.t === 'ident' && !parts.length) {
            let name = u.v, k = j + 1;
            while (sig[k] && sig[k].v === '.' && sig[k + 1] && sig[k + 1].t === 'ident') { name += '.' + sig[k + 1].v; k += 2; }
            parts.push({ ref: name }); expectOperand = false; j = k; continue;
          }
          break;
        } else {
          if (u.t === 'punct' && u.v === '+') { expectOperand = true; j++; continue; }
          break;
        }
      }
      const hasLit = parts.some(p => p.lit !== undefined);
      if (hasLit) runs.push({ parts, line: sig[start].line, startTok: sig[start], endTok: sig[Math.max(start, j - 1)] });
      i = Math.max(j, i + 1);
    }
    return runs;
  }

  // Array-of-strings joined: ['a', 'b'].join('\n') → one run with separator.
  function arrayJoinRuns(tokens) {
    const sig = significant(tokens);
    const runs = [];
    for (let i = 0; i < sig.length; i++) {
      if (!(sig[i].t === 'punct' && sig[i].v === '[')) continue;
      // find matching ]
      let d = 0, k = i, items = [], ok = true, expectItem = true;
      for (k = i; k < sig.length; k++) {
        const u = sig[k];
        if (u.t === 'punct' && (u.v === '[' || u.v === '(' || u.v === '{')) { d++; if (d > 1) { ok = false; } continue; }
        if (u.t === 'punct' && (u.v === ']' || u.v === ')' || u.v === '}')) { d--; if (d === 0) break; continue; }
        if (d !== 1) continue;
        if (u.t === 'str' || (u.t === 'tpl' && u.tplPart === 'full')) { if (!expectItem) { ok = false; } items.push({ lit: u.cooked }); expectItem = false; continue; }
        if (u.t === 'punct' && u.v === ',') { expectItem = true; continue; }
        if (u.t === 'punct' && u.v === '+') { expectItem = true; continue; }
        if (u.t === 'ident') { items.push({ ref: u.v }); expectItem = false; continue; }
        ok = false;
      }
      if (!ok || !items.length || k >= sig.length) continue;
      const after = sig[k + 1], after2 = sig[k + 2], after3 = sig[k + 3], after4 = sig[k + 4];
      if (after && after.v === '.' && after2 && after2.v === 'join' && after3 && after3.v === '(') {
        let sep = ',';
        if (after4 && after4.t === 'str') sep = after4.cooked;
        else if (after4 && after4.v === ')') sep = ',';
        const parts = [];
        items.forEach((it, idx) => { if (idx) parts.push({ lit: sep }); parts.push(it); });
        runs.push({ parts, line: sig[i].line, startTok: sig[i], endTok: sig[k], joined: true });
        i = k;
      }
    }
    return runs;
  }

  exports.tokenize = tokenize;
  exports.significant = significant;
  exports.blank = blank;
  exports.stringRuns = stringRuns;
  exports.arrayJoinRuns = arrayJoinRuns;
  exports.cookString = cookString;
})(module.exports);
